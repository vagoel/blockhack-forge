import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

assert.doesNotMatch(
  packageJson.scripts.dev,
  /\bconvex\b/,
  "pnpm dev must not start the Convex CLI or require interactive authentication",
);
assert.equal(
  packageJson.scripts.convex,
  undefined,
  "local development must not expose an interactive Convex CLI script",
);

console.log("local development startup test passed");
