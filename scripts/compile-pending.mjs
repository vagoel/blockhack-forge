// Headless companion to the console's esbuild-wasm worker. Useful for deploys,
// CI, and recovery when no operator console tab is open.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { validateGeneratedSource } from "../apps/console/src/sourcePolicy.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function envValue(file, name) {
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} is missing from ${file}`);
  return line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

const operatorKey = readFileSync(path.join(root, ".operator-key"), "utf8").trim();
const deploymentUrl = envValue(
  path.join(root, "apps/console/.env.local"),
  "VITE_CONVEX_URL",
);
const client = new ConvexHttpClient(deploymentUrl);

const shims = {
  react: "module.exports = window.React;",
  "react-dom": "module.exports = window.ReactDOM || {};",
  "react/jsx-runtime":
    "const R=window.React; exports.jsx=(t,p,k)=>R.createElement(t,k===undefined?p:{...p,key:k}); exports.jsxs=exports.jsx; exports.Fragment=R.Fragment;",
  "@runtime/sdk": "module.exports = window.Runtime;",
  "@runtime/ui": "module.exports = window.RuntimeUI;",
};

const shimPlugin = {
  name: "runtime-shims",
  setup(esbuild) {
    esbuild.onResolve(
      { filter: /^(react|react-dom|react\/jsx-runtime|@runtime\/sdk|@runtime\/ui)$/ },
      (args) => ({ path: args.path, namespace: "shim" }),
    );
    esbuild.onLoad({ filter: /.*/, namespace: "shim" }, (args) => ({
      contents: shims[args.path] ?? "module.exports = {};",
      loader: "js",
    }));
  },
};

async function compile(source, connectors) {
  validateGeneratedSource(source, connectors);
  const result = await build({
    stdin: { contents: source, loader: "tsx", resolveDir: "/" },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "GeneratedApp",
    jsx: "automatic",
    plugins: [shimPlugin],
    logLevel: "silent",
  });
  const text = result.outputFiles?.[0]?.text;
  if (!text) throw new Error("esbuild produced no output");
  const bundle = `${text}\nwindow.GeneratedApp = GeneratedApp;`;
  if (bundle.length > 600_000) throw new Error("compiled bundle exceeds the 600k safety limit");
  return bundle;
}

const pending = await client.query(anyApi.builds.awaitingCompile, { operatorKey });
if (!Array.isArray(pending) || pending.length === 0) {
  console.log("no versions awaiting compile");
  process.exit(0);
}

let failed = 0;
for (const version of pending) {
  let bundle;
  try {
    bundle = await compile(version.tsxSource, version.connectors);
  } catch (error) {
    failed += 1;
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    await client.mutation(anyApi.builds.compileFailed, {
      versionId: version.versionId,
      error: message,
      operatorKey,
    });
    console.error(`compile failed for ${version.versionId}: ${message}`);
    continue;
  }

  try {
    const result = await client.mutation(anyApi.builds.submitCompiled, {
      versionId: version.versionId,
      bundle,
      operatorKey,
    });
    console.log(`published ${result.slug}`);
  } catch (error) {
    failed += 1;
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    // A publish transport failure says nothing about source validity. Keep the
    // version pending so the next invocation can retry idempotently.
    console.error(`publish retry pending for ${version.versionId}: ${message}`);
  }
}

if (failed > 0) process.exitCode = 1;
