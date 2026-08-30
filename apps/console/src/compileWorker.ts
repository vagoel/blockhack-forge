import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import * as esbuild from "esbuild-wasm";
import wasmURL from "esbuild-wasm/esbuild.wasm?url";
import { api } from "./convexClient";
import { COMPILER_SHIMS } from "./compilerShims";
import { useOperatorKey } from "./operator";

export type CompileWorkerStatus = {
  state: "idle" | "compiling";
  pending: number;
  compiled: number;
  failed: number;
  lastError: string | null;
};

type AwaitingVersion = {
  versionId: string;
  appId: string;
  tsxSource: string;
  buildId?: string;
  connectors: Array<"convex" | "context" | "openai" | "vercel">;
};

let esbuildInit: Promise<void> | null = null;
let sourcePolicyInit: Promise<typeof import("./sourcePolicy")> | null = null;

class CompilerInitializationError extends Error {
  override name = "CompilerInitializationError";
}

function ensureEsbuild(): Promise<void> {
  if (!esbuildInit) {
    esbuildInit = esbuild.initialize({ wasmURL }).catch((error: unknown) => {
      esbuildInit = null;
      const message = error instanceof Error ? error.message : String(error);
      throw new CompilerInitializationError(message);
    });
  }
  return esbuildInit;
}

function ensureSourcePolicy(): Promise<typeof import("./sourcePolicy")> {
  if (!sourcePolicyInit) {
    sourcePolicyInit = import("./sourcePolicy").catch((error: unknown) => {
      sourcePolicyInit = null;
      const message = error instanceof Error ? error.message : String(error);
      throw new CompilerInitializationError(`source policy failed to load: ${message}`);
    });
  }
  return sourcePolicyInit;
}

// Module-level so re-renders (and StrictMode double effects) never double-compile
// the same version.
const inFlight = new Set<string>();

const shimPlugin: esbuild.Plugin = {
  name: "runtime-shims",
  setup(build) {
    build.onResolve(
      { filter: /^(react|react-dom|react\/jsx-runtime|@runtime\/sdk|@runtime\/ui)$/ },
      (args) => ({ path: args.path, namespace: "shim" }),
    );
    build.onLoad({ filter: /.*/, namespace: "shim" }, (args) => ({
      contents: COMPILER_SHIMS[args.path] ?? "module.exports = {};",
      loader: "js",
    }));
  },
};

async function compileTsx(
  tsxSource: string,
  connectors: Array<"convex" | "context" | "openai" | "vercel">,
): Promise<string> {
  const { validateGeneratedSource } = await ensureSourcePolicy();
  validateGeneratedSource(tsxSource, connectors);
  await ensureEsbuild();
  const result = await esbuild.build({
    stdin: { contents: tsxSource, loader: "tsx", resolveDir: "/" },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "GeneratedApp",
    // "automatic" JSX imports react/jsx-runtime, which the shim plugin maps
    // onto window.React — handles fragments without jsxFactory settings.
    jsx: "automatic",
    plugins: [shimPlugin],
  });
  const text = result.outputFiles?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("esbuild produced no output");
  }
  const bundle = text + "\nwindow.GeneratedApp = GeneratedApp;";
  if (bundle.length > 600_000) throw new Error("compiled bundle exceeds the 600k safety limit");
  return bundle;
}

export function useCompileWorker(): CompileWorkerStatus {
  const operatorKey = useOperatorKey();
  const awaiting = useQuery(api.builds.awaitingCompile, { operatorKey }) as
    | AwaitingVersion[]
    | undefined;
  const submitCompiled = useMutation(api.builds.submitCompiled);
  const compileFailed = useMutation(api.builds.compileFailed);

  const [active, setActive] = useState(0);
  const [compiled, setCompiled] = useState(0);
  const [failed, setFailed] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!awaiting) return;
    for (const version of awaiting) {
      if (inFlight.has(version.versionId)) continue;
      inFlight.add(version.versionId);
      setActive((n) => n + 1);
      void (async () => {
        let bundle: string;
        try {
          bundle = await compileTsx(version.tsxSource, version.connectors);
        } catch (err) {
          if (err instanceof CompilerInitializationError) {
            const message = `compiler initialization retry pending: ${err.message}`.slice(0, 2000);
            setLastError(message);
            window.setTimeout(() => {
              inFlight.delete(version.versionId);
              setRetryNonce((n) => n + 1);
            }, 2500);
            setActive((n) => n - 1);
            return;
          }
          const message = (
            err instanceof Error ? err.message : String(err)
          ).slice(0, 2000);
          setLastError(message);
          setFailed((n) => n + 1);
          try {
            await compileFailed({ versionId: version.versionId, error: message, operatorKey });
          } catch {
            // A transport failure is not a permanent compile failure. Leave
            // the version pending and retry from this tab shortly.
            window.setTimeout(() => {
              inFlight.delete(version.versionId);
              setRetryNonce((n) => n + 1);
            }, 2500);
          }
          setActive((n) => n - 1);
          return;
        }

        try {
          await submitCompiled({ versionId: version.versionId, bundle, operatorKey });
          setCompiled((n) => n + 1);
        } catch (err) {
          const message = `publish retry pending: ${
            err instanceof Error ? err.message : String(err)
          }`.slice(0, 2000);
          setLastError(message);
          window.setTimeout(() => {
            inFlight.delete(version.versionId);
            setRetryNonce((n) => n + 1);
          }, 2500);
        } finally {
          setActive((n) => n - 1);
        }
      })();
    }
  }, [awaiting, submitCompiled, compileFailed, operatorKey, retryNonce]);

  return {
    state: active > 0 ? "compiling" : "idle",
    pending: awaiting?.length ?? 0,
    compiled,
    failed,
    lastError,
  };
}
