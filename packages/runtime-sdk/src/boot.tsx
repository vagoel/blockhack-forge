// Iframe boot: exposes window.React / window.Runtime / window.RuntimeUI,
// waits for the parent's init handshake, then mounts window.GeneratedApp.
// Bundled to apps/shell/public/vendor/runtime.js by scripts/build-vendor.mjs.
import React from "react";
import { createRoot } from "react-dom/client";
import * as Runtime from "./index";
import * as RuntimeUI from "@app-builder/ui-kit";
import { baseCss } from "@app-builder/ui-kit";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { RuntimeInit, Theme } from "./index";

declare global {
  interface Window {
    React: typeof React;
    Runtime: typeof Runtime;
    RuntimeUI: typeof RuntimeUI;
    GeneratedApp?: unknown;
    __RT_BOOT__: () => void;
  }
}

window.React = React;
window.Runtime = Object.freeze(Runtime);
window.RuntimeUI = Object.freeze(RuntimeUI);

function applyThemeVars(theme: Theme | null | undefined) {
  const r = document.documentElement.style;
  const t = theme ?? {};
  r.setProperty("--rt-primary", t.primary ?? "#4f46e5");
  r.setProperty("--rt-secondary", t.secondary ?? "#818cf8");
  r.setProperty("--rt-background", t.background ?? "#0b0d14");
  r.setProperty("--rt-surface", t.surface ?? "#171a26");
  r.setProperty("--rt-text", t.text ?? "#f4f5f9");
  r.setProperty("--rt-accent", t.accent ?? "#f59e0b");
  r.setProperty("--rt-radius", t.radius ?? "14px");
  r.setProperty(
    "--rt-font",
    t.font ?? "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
  );
}

function ThemedApp(props: { init: RuntimeInit; App: React.ComponentType }) {
  const theme = Runtime.useTheme();
  React.useEffect(() => applyThemeVars(theme), [JSON.stringify(theme)]);
  const App = props.App;
  return <App />;
}

function Boundary(props: { onError: (msg: string) => void; children: React.ReactNode }) {
  return <ErrorBoundary onError={props.onError}>{props.children}</ErrorBoundary>;
}

class ErrorBoundary extends React.Component<
  { onError: (msg: string) => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: Error) {
    this.props.onError(String(err?.message ?? err));
  }
  render() {
    if (this.state.failed) {
      return (
        <div style={{ padding: 24, textAlign: "center", fontFamily: "var(--rt-font)" }}>
          <p>Something broke — reloading…</p>
        </div>
      );
    }
    return this.props.children;
  }
}

window.__RT_BOOT__ = () => {
  const style = document.createElement("style");
  style.textContent = baseCss;
  document.head.appendChild(style);

  let booted = false;
  const post = (msg: unknown) => window.parent.postMessage(msg, "*");

  window.addEventListener("message", (ev) => {
    if (ev.source !== window.parent) return;
    const d = ev.data;
    if (!d || d.type !== "init" || booted) return;
    booted = true;
    const init: RuntimeInit = {
      appId: d.appId,
      slug: d.slug,
      sessionId: d.sessionId,
      name: d.name,
      deploymentUrl: d.deploymentUrl,
      theme: d.theme ?? null,
      mode: d.mode === "projector" ? "projector" : "player",
      connectors: Array.isArray(d.connectors)
        ? d.connectors.filter((value: unknown) =>
            ["convex", "context", "openai", "vercel"].includes(String(value))
          )
        : undefined,
    };
    applyThemeVars(init.theme);

    const exported: any = window.GeneratedApp;
    const App: React.ComponentType | undefined =
      typeof exported === "function" ? exported : exported?.default;
    const rootEl = document.getElementById("root")!;

    const reportError = (message: string) => {
      post({ type: "error", message });
    };
    window.onerror = (_m, _s, _l, _c, err) => {
      reportError(String(err?.message ?? _m));
    };
    window.onunhandledrejection = (ev) => {
      reportError(String((ev as PromiseRejectionEvent).reason ?? "unhandled rejection"));
    };

    if (!App) {
      reportError("GeneratedApp missing");
      return;
    }

    const root = createRoot(rootEl);
    root.render(
      <Runtime.RuntimeProvider init={init}>
        <Boundary onError={reportError}>
          <ThemedApp init={init} App={App} />
        </Boundary>
      </Runtime.RuntimeProvider>
    );

    // announce player name for usePresence name resolution (best-effort)
    void (async () => {
      try {
        const c = new ConvexHttpClient(init.deploymentUrl);
        await c.mutation(anyApi.runtime.registerPlayerName as any, {
          appId: init.appId,
          sessionId: init.sessionId,
          name: init.name,
        });
      } catch {
        // non-fatal
      }
    })();

    post({ type: "ready" });
    setInterval(() => post({ type: "hb" }), 2000);
  });

  post({ type: "boot" });
};
