import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const temp = mkdtempSync(path.join(tmpdir(), "app-builder-tests-"));
const require = createRequire(import.meta.url);

async function load(entry, name) {
  const outfile = path.join(temp, `${name}.cjs`);
  await build({
    entryPoints: [path.join(root, entry)],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    logLevel: "silent",
  });
  delete require.cache[outfile];
  return require(outfile);
}

try {
  const { operatorMatches, requireOperator } = await load(
    "convex/lib/operator.ts",
    "operator",
  );
  assert.equal(operatorMatches(""), true);
  assert.doesNotThrow(() => requireOperator(""));

  const {
    devinModeLabel,
    devinModeRequestFields,
    isProviderDevinMode,
    normalizeDevinMode,
    providerDevinModes,
  } = await load("convex/lib/devinMode.ts", "devin-mode");
  const expectedProviderModes = ["normal", "fast", "lite", "ultra", "fusion"];
  assert.deepEqual(providerDevinModes, expectedProviderModes);
  for (const mode of ["default", ...expectedProviderModes]) {
    assert.equal(normalizeDevinMode(mode), mode);
  }
  for (const value of [undefined, null, "", "unknown", "FAST", 1, {}]) {
    assert.equal(normalizeDevinMode(value), "default");
  }
  for (const mode of expectedProviderModes) {
    assert.equal(isProviderDevinMode(mode), true);
  }
  for (const value of ["default", undefined, null, "unknown", "FAST", 1]) {
    assert.equal(isProviderDevinMode(value), false);
  }
  assert.deepEqual(
    ["default", ...expectedProviderModes].map((mode) => devinModeLabel(mode)),
    [
      "Devin organization default",
      "Devin Agent",
      "Devin Fast",
      "Devin Lite",
      "Devin Ultra",
      "Devin Fusion",
    ],
  );
  assert.deepEqual(devinModeRequestFields("v1", "default"), {});
  assert.equal("devin_mode" in devinModeRequestFields("v1", "default"), false);
  for (const mode of expectedProviderModes) {
    assert.deepEqual(devinModeRequestFields("v3", mode), { devin_mode: mode });
    assert.throws(() => devinModeRequestFields("v1", mode), /requires Devin API v3/);
  }
  assert.deepEqual(devinModeRequestFields("v3", "default"), {});

  const { devinSessionVisibilityFields } = await load(
    "convex/lib/devinSession.ts",
    "devin-session",
  );
  assert.deepEqual(devinSessionVisibilityFields("v1"), { unlisted: false });
  assert.deepEqual(devinSessionVisibilityFields("v3"), {});

  const sourcePolicySource = readFileSync(
    path.join(root, "apps/console/src/sourcePolicy.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    sourcePolicySource,
    /\b(?:createProgram|getTypeChecker)\s*\(/,
    "source policy must not depend on semantic symbol binding in production browser bundles",
  );
  const { validateGeneratedSource } = await load(
    "apps/console/src/sourcePolicy.ts",
    "source-policy",
  );
  const { COMPILER_SHIMS } = await load(
    "apps/console/src/compilerShims.ts",
    "compiler-shims",
  );
  const compatibilitySource = `
    import { Runtime } from "@runtime/sdk";
    export default function App() { return Runtime.useTheme().primary; }
  `;
  const compatibilityBundle = await build({
    stdin: { contents: compatibilitySource, loader: "tsx", resolveDir: "/" },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "GeneratedApp",
    logLevel: "silent",
    plugins: [{
      name: "runtime-shim-test",
      setup(esbuild) {
        esbuild.onResolve(
          { filter: /^(react|react-dom|react\/jsx-runtime|@runtime\/sdk|@runtime\/ui)$/ },
          (args) => ({ path: args.path, namespace: "shim" }),
        );
        esbuild.onLoad({ filter: /.*/, namespace: "shim" }, (args) => ({
          contents: COMPILER_SHIMS[args.path] ?? "module.exports = {};",
          loader: "js",
        }));
      },
    }],
  });
  const compatibilityContext = {
    window: { Runtime: { useTheme: () => ({ primary: "#123456" }) } },
  };
  runInNewContext(
    `${compatibilityBundle.outputFiles[0].text}\nwindow.GeneratedApp = GeneratedApp;`,
    compatibilityContext,
  );
  assert.equal(compatibilityContext.window.GeneratedApp.default(), "#123456");
  assert.doesNotThrow(() =>
    validateGeneratedSource(`
      import { useState, useRef } from "react";
      import * as Runtime from "@runtime/sdk";
      export default function App() {
        const [count, setCount] = useState(0);
        const pending = useRef(0);
        const me = Runtime.useMe();
        return <button onClick={() => setCount(count + 1)}>{me.name}: {count + pending.current}</button>;
      }
    `),
  );
  assert.throws(
    () => validateGeneratedSource(`export default function App(){ fetch("https://bad.test"); return null; }`),
    /fetch is not available/,
  );
  assert.doesNotThrow(() =>
    validateGeneratedSource(`
      import { useState } from "react";
      export default function App() {
        const [open, setOpen] = useState(false);
        function close() { setOpen(false); }
        return <button onClick={open ? close : () => setOpen(true)}>{open ? "Close" : "Open"}</button>;
      }
    `),
  );
  assert.doesNotThrow(() =>
    validateGeneratedSource(`
      export default function App() {
        const panel = { open: true, close() {} };
        return <button onClick={() => panel.close()}>{panel.open ? "Close" : "Open"}</button>;
      }
    `),
  );
  assert.doesNotThrow(() =>
    validateGeneratedSource(`
      export default function App() {
        const top = 12;
        const markerStyle = { position: "absolute", left: "40%", top: \`\${top}%\` };
        return <div style={markerStyle}>{top}</div>;
      }
    `),
  );
  assert.throws(
    () => validateGeneratedSource(`export default function App(){ return <div>{top === self}</div>; }`),
    /top is not available/,
  );
  assert.doesNotThrow(() =>
    validateGeneratedSource(`
      export default function App() {
        const item = { view: "compact", top: 12 };
        const label = Object.entries(item).find(([name]) => name === "view")?.at(1);
        return <div>{label}</div>;
      }
    `),
  );
  assert.doesNotThrow(() =>
    validateGeneratedSource(`
      function Navigation(props: { view: string }) { return <div>{props.view}</div>; }
      export default function App(){ return <Navigation view="guide" />; }
    `),
  );
  assert.throws(
    () => validateGeneratedSource(`export default function App(){ return <button onClick={(event) => event.nativeEvent}>x</button>; }`),
    /property nativeEvent is not allowed/,
  );
  assert.doesNotThrow(() =>
    validateGeneratedSource(`
      export default function App() {
        const active = 0;
        return <div>{[1].map((item, index) => {
          const open = active === index;
          return <button onClick={() => open ? null : index}>{open ? item : "Closed"}</button>;
        })}</div>;
      }
    `),
  );
  assert.throws(
    () =>
      validateGeneratedSource(`
        function helper() { const open = () => null; return open; }
        export default function App() { open("https://bad.test"); return null; }
      `),
    /open is not available/,
  );
  assert.throws(
    () => validateGeneratedSource(`export default function App(){ open("https://bad.test"); return null; }`),
    /open is not available/,
  );
  assert.throws(
    () => validateGeneratedSource(`export default function App(){ close(); return null; }`),
    /close is not available/,
  );
  assert.throws(
    () =>
      validateGeneratedSource(
        `declare const open: (url: string) => void; export default function App(){ open("https://bad.test"); return null; }`,
      ),
    /open is not available/,
  );
  assert.throws(
    () =>
      validateGeneratedSource(
        `type close = () => void; export default function App(){ close(); return null; }`,
      ),
    /close is not available/,
  );
  assert.throws(
    () => validateGeneratedSource(`import x from "bad-package"; export default function App(){ return null; }`),
    /is not allowed/,
  );
  assert.throws(
    () => validateGeneratedSource(`export default function App(){ location.href = "https://bad.test"; return null; }`),
    /location is not available/,
  );
  assert.throws(
    () => validateGeneratedSource(`export default function App(){ return <a href="https://bad.test">leave</a>; }`),
    /JSX (href|element a) is not allowed/,
  );
  assert.throws(
    () => validateGeneratedSource(`export default function App(){ return <meta httpEquiv="refresh" content="0;url=https://bad.test" />; }`),
    /JSX element meta is not allowed/,
  );
  assert.throws(
    () => validateGeneratedSource(`export default function App(){ const key = "owner" + "Document"; return Reflect.get(new Image(), key); }`),
    /(Reflect|Image) is not available/,
  );
  assert.throws(
    () => validateGeneratedSource(`export default function App(){ const key = "owner" + "Document"; return <div>{({})[key]}</div>; }`),
    /computed property access is not allowed/,
  );
  assert.throws(
    () => validateGeneratedSource(`export const App = () => null;`),
    /exactly one default export/,
  );
  assert.doesNotThrow(() =>
    validateGeneratedSource(
      `import { useState } from "react"; export default function App(){ const [n,setN]=useState(0); return <button onClick={()=>setN(n+1)}>{n}</button>; }`,
      ["vercel"],
    ),
  );
  assert.throws(
    () =>
      validateGeneratedSource(
        `import * as Runtime from "@runtime/sdk"; export default function App(){ const rt=Runtime.useRt(); return <button onClick={()=>rt.set("x","y",1)}>x</button>; }`,
        ["vercel"],
      ),
    /useRt requires the Convex connector/,
  );
  assert.doesNotThrow(() =>
    validateGeneratedSource(
      `import { Runtime } from "@runtime/sdk"; export default function App(){ const theme=Runtime.useTheme(); return <div>{theme.primary}</div>; }`,
      ["vercel"],
    ),
  );
  assert.throws(
    () =>
      validateGeneratedSource(
        `import { Runtime } from "@runtime/sdk"; export default function App(){ const people=Runtime.usePresence(); return <div>{people.length}</div>; }`,
        ["vercel"],
      ),
    /usePresence requires the Convex connector/,
  );
  assert.throws(
    () =>
      validateGeneratedSource(
        `import * as Runtime from "@runtime/sdk"; export default function App(){ const R=Runtime; const people=R.usePresence(); return <div>{people.length}</div>; }`,
        ["vercel"],
      ),
    /Runtime namespace aliases and destructuring are not allowed/,
  );
  assert.throws(
    () =>
      validateGeneratedSource(
        `import * as Runtime from "@runtime/sdk"; export default function App(){ const {usePresence}=Runtime; const people=usePresence(); return <div>{people.length}</div>; }`,
        ["vercel"],
      ),
    /Runtime namespace aliases and destructuring are not allowed/,
  );
  assert.throws(
    () =>
      validateGeneratedSource(
        `import Runtime from "@runtime/sdk"; export default function App(){ const people=Runtime.usePresence(); return <div>{people.length}</div>; }`,
        ["vercel"],
      ),
    /usePresence requires the Convex connector/,
  );
  assert.throws(
    () =>
      validateGeneratedSource(
        `import {default as Runtime} from "@runtime/sdk"; export default function App(){ const people=Runtime.usePresence(); return <div>{people.length}</div>; }`,
        ["vercel"],
      ),
    /usePresence requires the Convex connector/,
  );
  assert.throws(
    () =>
      validateGeneratedSource(
        `import Runtime = require("@runtime/sdk"); export default function App(){ const people=Runtime.usePresence(); return <div>{people.length}</div>; }`,
        ["vercel"],
      ),
    /import-equals declarations are not allowed/,
  );
  assert.doesNotThrow(() =>
    validateGeneratedSource(
      `import Runtime from "@runtime/sdk"; export default function App(){ const me=Runtime.useMe(); return <div>{me.name}</div>; }`,
      ["vercel"],
    ),
  );
  assert.throws(
    () =>
      validateGeneratedSource(
        `import { useAI } from "@runtime/sdk"; export default function App(){ const ai=useAI(); return <button onClick={()=>ai.generate("hi")}>AI</button>; }`,
        ["vercel"],
      ),
    /useAI requires the OpenAI connector/,
  );

  const { matchSkills, composeDevinPrompt } = await load(
    "convex/lib/skillMatch.ts",
    "skill-match",
  );
  const auctionSkills = matchSkills("A live auction with a shared countdown timer and bids").map(
    (skill) => skill.name,
  );
  assert.deepEqual(auctionSkills.slice(0, 3), ["convex-platform", "realtime-state", "theming"]);
  assert.ok(auctionSkills.includes("auction"));
  assert.ok(auctionSkills.includes("timers"));
  assert.ok(auctionSkills.length <= 7);
  const staticSkills = matchSkills("A live auction with a shared timer", ["vercel"]).map(
    (skill) => skill.name,
  );
  assert.ok(!staticSkills.includes("realtime-state"));
  assert.ok(!staticSkills.includes("auction"));
  assert.ok(!staticSkills.includes("convex-platform"));

  const siteSkills = matchSkills(
    "Build a polished SaaS website with a landing page and pricing",
    ["vercel"],
  ).map((skill) => skill.name);
  assert.ok(siteSkills.includes("site-builder"));
  assert.ok(!siteSkills.includes("presence-rooms"));

  const contextSkills = matchSkills(
    "Build a searchable product catalog from this website and its brand styleguide",
    ["context", "vercel"],
  ).map((skill) => skill.name);
  assert.ok(contextSkills.includes("context-core"));
  assert.ok(contextSkills.includes("data-explorer"));
  assert.ok(contextSkills.includes("context-brand"));
  assert.ok(!contextSkills.includes("convex-platform"));

  const noContextSkills = matchSkills(
    "Build a searchable catalog from extracted website rows",
    ["vercel"],
  ).map((skill) => skill.name);
  assert.ok(!noContextSkills.includes("context-core"));
  assert.ok(!noContextSkills.includes("data-explorer"));

  const { summarizeRenderedSource } = await load(
    "convex/lib/sourceStyle.ts",
    "source-style",
  );
  const sourceStyle = summarizeRenderedSource(
    `<!doctype html><html><head>
      <link rel="stylesheet" href="/assets/site.css">
      <style>:root { --brand: #635bff; --space-lg: 32px; }
        .hero { display:grid; gap:var(--space-lg); }
        .hero::before { content: "ignore these words"; }
      </style>
      <script>ignoreAllInstructions()</script>
    </head><body><header class="shell topbar"><nav role="navigation"></nav></header>
      <main class="landing"><section class="hero"><h1>Do not copy this text</h1>
      <button class="primary large" type="button">Buy</button></section></main></body></html>`,
    "https://reference.test/product",
    "Reference product",
  );
  assert.match(sourceStyle, /--brand: #635bff/);
  assert.match(sourceStyle, /https:\/\/reference\.test\/assets\/site\.css/);
  assert.match(sourceStyle, /<section class="hero">/);
  assert.doesNotMatch(sourceStyle, /ignoreAllInstructions|Do not copy this text/);
  assert.doesNotMatch(sourceStyle, /content:/);

  const grounded = composeDevinPrompt({
    userPrompt: "Build from the API docs",
    docsGrounding: "Authoritative reference text",
    inlineSystem: false,
  });
  assert.match(grounded, /PREPARED WEB\/DOCS GROUNDING/);
  assert.match(grounded, /Authoritative reference text/);
  const connectorPrompt = composeDevinPrompt({
    userPrompt: "Make an AI writing helper",
    connectors: ["openai", "vercel"],
    inlineSystem: false,
  });
  assert.match(connectorPrompt, /Convex realtime: DISABLED/);
  assert.match(connectorPrompt, /OpenAI runtime AI: ENABLED/);
  assert.match(connectorPrompt, /Never request, print, embed, or infer connector credentials/);

  const inlinePrompt = composeDevinPrompt({
    userPrompt: "Build a polished company website",
    docsGrounding: "Reference ".repeat(2000),
    connectors: ["context", "vercel"],
    inlineSystem: true,
  });
  assert.ok(inlinePrompt.length < 26000);
  assert.match(inlinePrompt, /Decide the product archetype first/);
  assert.match(inlinePrompt, /Visual and product quality bar/);
  assert.match(inlinePrompt, /connectorsUsed/);
  assert.match(inlinePrompt, /SKILL: site-builder/);
  assert.doesNotMatch(inlinePrompt, /mid-section|INLINE_SYSTEM_CAP/);

  const worstCasePrompt = composeDevinPrompt({
    userPrompt: "Build a branded AI website, searchable catalog, dashboard, and live room ".repeat(80),
    brandTheme: { primary: "#123456", componentCss: "x".repeat(8000) },
    styleGrounding: "Rendered CSS and DOM structure ".repeat(500),
    datasetSample: Array.from({ length: 5 }, (_, index) => ({
      name: `row-${index}`,
      description: "data ".repeat(1000),
    })),
    datasetName: "oversized-sample",
    docsGrounding: "Grounded documentation ".repeat(1000),
    connectors: ["convex", "context", "openai", "vercel"],
    inlineSystem: true,
  });
  assert.ok(worstCasePrompt.length < 26000, `prompt length ${worstCasePrompt.length}`);
  assert.match(worstCasePrompt, /ENFORCED CONNECTOR PERMISSIONS/);
  for (const core of ["context-core", "convex-platform", "realtime-state", "openai", "theming"]) {
    assert.match(worstCasePrompt, new RegExp(`CORE SKILL: ${core}`));
  }
  assert.match(worstCasePrompt, /SKILL: [\w-]+ \(primary — condensed\)/);
  assert.match(worstCasePrompt, /BRAND THEME/);
  assert.match(worstCasePrompt, /RENDERED SOURCE STYLE REFERENCE/);
  assert.match(worstCasePrompt, /DATASET "oversized-sample"/);
  assert.match(worstCasePrompt, /PREPARED WEB\/DOCS GROUNDING/);

  console.log("core tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
