// Sandboxed iframe host for a live generated app.
// Builds the srcdoc (vendor runtime + compiled bundle), runs the init
// handshake, and watches heartbeats — remounting the frame if it stalls.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";

export type ShellApp = {
  _id: string;
  slug: string;
  name: string;
  status: string;
  theme?: unknown;
  spec?: unknown;
  connectors?: Array<"convex" | "context" | "openai" | "vercel">;
  productionUrl?: string;
};

export type ShellVersion = {
  _id: string;
  version: number;
  bundle?: string | null;
};

export type LiveVersion = {
  _id: string;
  version: number;
  bundle: string;
};

export type Mode = "player" | "projector";

const HB_TIMEOUT_MS = 7000;
const WATCHDOG_TICK_MS = 2000;
const MAX_REMOUNTS = 3;
const ERROR_REPORT_MIN_INTERVAL_MS = 5000;

// Module-level cache: the vendor runtime is fetched once per page load.
let runtimeJsPromise: Promise<string> | null = null;
function loadRuntimeJs(): Promise<string> {
  if (!runtimeJsPromise) {
    runtimeJsPromise = fetch("/vendor/runtime.js").then((res) => {
      if (!res.ok) throw new Error(`runtime.js fetch failed (${res.status})`);
      return res.text();
    });
    runtimeJsPromise.catch(() => {
      runtimeJsPromise = null; // allow retry after a failed fetch
    });
  }
  return runtimeJsPromise;
}

function sanitizeScript(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script");
}

function networkOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

function contentSecurityPolicy(app: ShellApp): string {
  const deploymentOrigin = networkOrigin(import.meta.env.VITE_CONVEX_URL as string);
  const wsOrigin = deploymentOrigin?.replace(/^http/, "ws") ?? null;
  const theme = app.theme && typeof app.theme === "object" ? (app.theme as any) : null;
  const logoOrigin = networkOrigin(theme?.logoUrl);
  const connectSources = [deploymentOrigin, wsOrigin].filter(Boolean).join(" ") || "'none'";
  const imageSources = ["data:", "blob:", logoOrigin].filter(Boolean).join(" ");
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "form-action 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `connect-src ${connectSources}`,
    `img-src ${imageSources}`,
    "font-src data:",
    "media-src 'none'",
  ].join("; ");
}

export function AppFrame(props: {
  app: ShellApp;
  version: LiveVersion;
  sessionId: string;
  name: string;
  mode: Mode;
}) {
  const { app, version } = props;
  const reportError = useMutation(anyApi.runtime.reportError);

  const [runtimeJs, setRuntimeJs] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [failed, setFailed] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const lastHbRef = useRef(Date.now());
  const remountsRef = useRef(0);
  const lastErrorReportRef = useRef(0);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    let cancelled = false;
    loadRuntimeJs()
      .then((js) => {
        if (!cancelled) setRuntimeJs(js);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // New version hot-swap: fresh watchdog budget.
  useEffect(() => {
    remountsRef.current = 0;
    lastHbRef.current = Date.now();
    setFailed(false);
    setEpoch(0);
  }, [version._id]);

  // Handshake + heartbeat/error tracking.
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || ev.source !== frameWindow) return;
      const data = ev.data as { type?: unknown; message?: unknown } | null;
      if (!data || typeof data.type !== "string") return;
      const { app: a, sessionId, name, mode } = latest.current;

      if (data.type === "boot") {
        lastHbRef.current = Date.now();
        frameWindow.postMessage(
          {
            type: "init",
            appId: a._id,
            slug: a.slug,
            sessionId,
            name,
            deploymentUrl: import.meta.env.VITE_CONVEX_URL as string,
            theme: a.theme ?? null,
            mode,
            connectors: a.connectors ?? ["convex"],
          },
          "*"
        );
      } else if (data.type === "ready" || data.type === "hb") {
        lastHbRef.current = Date.now();
        if (data.type === "ready") remountsRef.current = 0;
      } else if (data.type === "error") {
        const now = Date.now();
        if (now - lastErrorReportRef.current >= ERROR_REPORT_MIN_INTERVAL_MS) {
          lastErrorReportRef.current = now;
          void reportError({
            appId: a._id,
            sessionId,
            message: String(data.message ?? "unknown iframe error"),
          }).catch(() => {
            // telemetry is best-effort
          });
        }
        // Errors deliberately do NOT refresh lastHb: they only lead to a
        // remount when heartbeats have stopped too (watchdog below).
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [reportError]);

  // Watchdog: >7s without a heartbeat -> remount the iframe (max 3 times).
  useEffect(() => {
    if (failed || !runtimeJs) return;
    const iv = setInterval(() => {
      // Hidden tabs throttle timers (both ours and the iframe's heartbeat);
      // treat hidden time as alive so re-focusing never triggers a remount.
      if (document.hidden) {
        lastHbRef.current = Date.now();
        return;
      }
      if (Date.now() - lastHbRef.current <= HB_TIMEOUT_MS) return;
      if (remountsRef.current >= MAX_REMOUNTS) {
        setFailed(true);
        return;
      }
      remountsRef.current += 1;
      lastHbRef.current = Date.now();
      setEpoch((e) => e + 1);
    }, WATCHDOG_TICK_MS);
    return () => clearInterval(iv);
  }, [failed, runtimeJs]);

  const srcdoc = useMemo(() => {
    if (!runtimeJs) return null;
    const csp = contentSecurityPolicy(app);
    return (
      "<!doctype html><html><head>" +
      '<meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">' +
      '<meta name="referrer" content="no-referrer">' +
      `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
      "<style>html,body,#root{height:100%;margin:0}</style>" +
      "</head><body>" +
      '<div id="root"></div>' +
      `<script>${sanitizeScript(runtimeJs)}</script>` +
      `<script>${sanitizeScript(version.bundle)}</script>` +
      "<script>window.__RT_BOOT__()</script>" +
      "</body></html>"
    );
  }, [app, runtimeJs, version.bundle]);

  if (loadError || failed) {
    return (
      <div className="screen">
        <div className="card">
          <h1>Connection lost</h1>
          <p className="muted">
            {loadError ? "The app runtime could not be loaded." : "The app stopped responding."}
          </p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }

  if (!srcdoc) {
    return (
      <div className="screen">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  return (
    <iframe
      key={`${version._id}:${epoch}:${props.mode}`}
      ref={iframeRef}
      title={app.name || app.slug}
      sandbox="allow-scripts"
      srcDoc={srcdoc}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0 }}
    />
  );
}
