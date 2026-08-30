// Creates/updates the Devin playbook that carries the master system prompt
// (skills/DEVIN_SYSTEM.md). The playbook id is stored in scripts/.playbook-id
// and exported to the Convex deployment as DEVIN_PLAYBOOK_ID by deploy.sh.
// Devin v3's documented session contract carries the master prompt inline;
// playbooks are synced only for legacy v1 sessions.
// Uses curl: node's fetch cannot reach api.devin.ai on some local resolvers.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const idFile = path.join(root, "scripts/.playbook-id");
const body = readFileSync(path.join(root, "skills/DEVIN_SYSTEM.md"), "utf8");
const key = process.env.DEVIN;
if (!key) {
  console.error("DEVIN env var not set");
  process.exit(1);
}
const isV3 = key.startsWith("cog_");
if (!isV3 && !key.startsWith("apk_")) {
  console.error("DEVIN must be an apk_ legacy key or cog_ service-user token");
  process.exit(1);
}
if (isV3) {
  console.log("Devin v3 uses the inline system prompt; playbook sync skipped");
  process.exit(0);
}
const playbooksUrl = "https://api.devin.ai/v1/playbooks";

const tmp = mkdtempSync(path.join(tmpdir(), "playbook-"));
const payloadFile = path.join(tmp, "payload.json");
writeFileSync(payloadFile, JSON.stringify({ title: "app-generator-system", body }));

function call(method, url) {
  const out = execFileSync("curl", [
    "-s",
    "-w", "\n%{http_code}",
    "-X", method,
    url,
    "-H", `Authorization: Bearer ${key}`,
    "-H", "Content-Type: application/json",
    "--data-binary", `@${payloadFile}`,
    "--max-time", "30",
  ]).toString();
  const idx = out.lastIndexOf("\n");
  return { status: Number(out.slice(idx + 1)), text: out.slice(0, idx) };
}

try {
  let id = existsSync(idFile) ? readFileSync(idFile, "utf8").trim() : "";
  if (id) {
    const res = call("PUT", `${playbooksUrl}/${encodeURIComponent(id)}`);
    if (res.status >= 200 && res.status < 300) {
      console.log("playbook updated:", id);
      process.exit(0);
    }
    console.warn("playbook update failed", res.status, "- creating a new one");
  }
  const res = call("POST", playbooksUrl);
  if (res.status < 200 || res.status >= 300) {
    console.error("playbook create failed:", res.status, res.text.slice(0, 200));
    process.exit(1);
  }
  id = JSON.parse(res.text).playbook_id;
  writeFileSync(idFile, id + "\n");
  console.log("playbook created:", id);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
