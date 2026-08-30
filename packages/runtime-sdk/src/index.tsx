// Runtime SDK — lives inside the sandboxed iframe as window.Runtime.
// Generated apps import ONLY from "react", "@runtime/sdk", "@runtime/ui".
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

export type Theme = {
  primary?: string;
  secondary?: string;
  background?: string;
  surface?: string;
  text?: string;
  accent?: string;
  radius?: string;
  font?: string;
  logoUrl?: string;
};

export type ConnectorId = "convex" | "context" | "openai" | "vercel";

export type RuntimeInit = {
  appId: string;
  slug: string;
  sessionId: string;
  name: string;
  deploymentUrl: string;
  theme: Theme | null;
  mode: "player" | "projector";
  connectors?: ConnectorId[];
};

type Transport = {
  ws: ConvexClient;
  http: ConvexHttpClient;
  degraded: boolean;
  markAlive: () => void;
};

type Ctx = RuntimeInit & { client: ConvexClient; transport: Transport };

const RuntimeCtx = createContext<Ctx | null>(null);

// Some networks (and some embedded browsers) silently drop WebSockets from
// sandboxed iframes. If the socket produces nothing shortly after boot, the
// SDK degrades to HTTP polling so the app still works — just a bit less live.
const DEGRADE_AFTER_MS = 4000;
const POLL_INTERVAL_MS = 2000;

export function RuntimeProvider(props: { init: RuntimeInit; children: ReactNode }) {
  const ws = useMemo(() => new ConvexClient(props.init.deploymentUrl), [props.init.deploymentUrl]);
  const http = useMemo(
    () => new ConvexHttpClient(props.init.deploymentUrl),
    [props.init.deploymentUrl]
  );
  const [degraded, setDegraded] = useState(false);
  const aliveRef = useRef(false);

  const transport = useMemo<Transport>(
    () => ({
      ws,
      http,
      degraded,
      markAlive: () => {
        aliveRef.current = true;
      },
    }),
    [ws, http, degraded]
  );

  // Probe: any WS query result marks the socket alive; silence -> degrade.
  useEffect(() => {
    const unsub = ws.onUpdate(anyApi.apps.getBySlug as any, { slug: props.init.slug }, () => {
      aliveRef.current = true;
    });
    const t = setTimeout(() => {
      if (!aliveRef.current) setDegraded(true);
    }, DEGRADE_AFTER_MS);
    return () => {
      unsub();
      clearTimeout(t);
    };
  }, [ws, props.init.slug]);

  const value = useMemo(
    () => ({ ...props.init, client: ws, transport }),
    [props.init, ws, transport]
  );
  useEffect(() => () => void ws.close(), [ws]);
  return <RuntimeCtx.Provider value={value}>{props.children}</RuntimeCtx.Provider>;
}

function useCtx(): Ctx {
  const ctx = useContext(RuntimeCtx);
  if (!ctx) throw new Error("Runtime hooks must be used inside the generated app");
  return ctx;
}

function fnRef(fnPath: string): any {
  const parts = fnPath.split(".");
  let ref: any = anyApi;
  for (const p of parts) ref = ref[p];
  return ref;
}

/** Subscribe to a Convex query; returns undefined until first result. */
function useSub<T>(fnPath: string, args: Record<string, unknown> | null): T | undefined {
  const { transport } = useCtx();
  const [val, setVal] = useState<T | undefined>(undefined);
  const argsKey = JSON.stringify(args);

  // Primary: WebSocket subscription.
  useEffect(() => {
    if (args === null) return;
    const unsub = transport.ws.onUpdate(fnRef(fnPath), args as any, (v: T) => {
      transport.markAlive();
      setVal(v);
    });
    return unsub;
  }, [transport.ws, fnPath, argsKey]);

  // Fallback: HTTP polling while degraded.
  useEffect(() => {
    if (args === null || !transport.degraded) return;
    let stop = false;
    const tick = async () => {
      try {
        const v = await transport.http.query(fnRef(fnPath), args as any);
        if (!stop) setVal(v as T);
      } catch {
        // transient polling errors are fine
      }
    };
    void tick();
    const iv = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [transport.degraded, transport.http, fnPath, argsKey]);

  return val;
}

async function mutateVia(transport: Transport, fnPath: string, args: Record<string, unknown>) {
  // Writes use exactly one transport. A timed-out WebSocket mutation cannot
  // safely be retried over HTTP because the first request may still commit.
  return transport.http.mutation(fnRef(fnPath), args as any);
}

// ---------- hooks ----------

export function useDoc(collection: string, key: string): any | null {
  const { appId } = useCtx();
  return useSub<any>("runtime.getDoc", { appId, collection, key }) ?? null;
}

export function useDocs(collection: string): Array<{ key: string; data: any }> {
  const { appId } = useCtx();
  return useSub<Array<{ key: string; data: any }>>("runtime.listDocs", { appId, collection }) ?? [];
}

export function useList(
  collection: string
): Array<{ _id: string; data: any; sessionId: string; ts: number }> {
  const { appId } = useCtx();
  return (
    useSub<Array<{ _id: string; data: any; sessionId: string; ts: number }>>("runtime.listItems", {
      appId,
      collection,
    }) ?? []
  );
}

export function useLeaderboard(top?: number): Array<{ sessionId: string; name: string; points: number }> {
  const { appId } = useCtx();
  return (
    useSub<Array<{ sessionId: string; name: string; points: number }>>("runtime.leaderboard", {
      appId,
      ...(top ? { top } : {}),
    }) ?? []
  );
}

export function useDataset(): any[] {
  const { appId } = useCtx();
  return useSub<any[]>("runtime.getDataset", { appId }) ?? [];
}

export function useMe(): { sessionId: string; name: string } {
  const { sessionId, name } = useCtx();
  return { sessionId, name };
}

export function useMode(): "player" | "projector" {
  return useCtx().mode;
}

export function useTheme(): Theme {
  const { slug, theme } = useCtx();
  const live = useSub<{ app: { theme?: Theme } | null } | null>("apps.getBySlug", { slug });
  return live?.app?.theme ?? theme ?? {};
}

export function useConnectors(): readonly ConnectorId[] {
  return useCtx().connectors ?? ["convex"];
}

/** Server-side, quota-bounded AI. Available only when OpenAI was selected for this build. */
export function useAI(): {
  available: boolean;
  generate: (input: string) => Promise<string>;
} {
  const { transport, appId, sessionId, connectors } = useCtx();
  const available = Boolean(connectors?.includes("openai"));
  return useMemo(
    () => ({
      available,
      generate: async (input: string) => {
        if (!available) throw new Error("OpenAI is not enabled for this app");
        return (await transport.http.action(fnRef("ai.generate"), {
          appId,
          sessionId,
          input,
        } as any)) as string;
      },
    }),
    [available, transport.http, appId, sessionId]
  );
}

export function usePresence(): Array<{ userId: string; name: string; online: boolean }> {
  const { transport, appId, slug, sessionId } = useCtx();
  const [roomToken, setRoomToken] = useState<string | null>(null);
  const tabId = useRef(
    globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2)
  ).current;

  useEffect(() => {
    let stop = false;
    let sessionToken: string | null = null;
    const beat = async () => {
      try {
        const res: any = await mutateVia(transport, "presence.heartbeat", {
          appId,
          roomId: slug,
          userId: sessionId,
          sessionId: tabId,
          interval: 10000,
        });
        if (!stop && res) {
          setRoomToken(res.roomToken);
          sessionToken = res.sessionToken;
        }
      } catch {
        // presence is best-effort
      }
    };
    void beat();
    const iv = setInterval(beat, 10000);
    return () => {
      stop = true;
      clearInterval(iv);
      if (sessionToken) void mutateVia(transport, "presence.disconnect", { sessionToken });
    };
  }, [transport, appId, slug, sessionId, tabId]);

  const list = useSub<Array<{ userId: string; online: boolean }>>(
    "presence.list",
    roomToken ? { roomToken } : null
  );
  const players = useDocs("_players");
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.key, p.data?.name ?? "Guest");
    return m;
  }, [players]);

  return (list ?? []).map((e) => ({
    userId: e.userId,
    name: names.get(e.userId) ?? "Guest",
    online: e.online,
  }));
}

export function useTimer(key: string): { endsAt: number | null; fired: boolean; remainingMs: number } {
  const data = useDoc("timers", key);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, []);
  const endsAt = data?.endsAt ?? null;
  return {
    endsAt,
    fired: Boolean(data?.fired),
    remainingMs: endsAt ? Math.max(0, endsAt - now) : 0,
  };
}

// ---------- imperative API ----------

export function useRt() {
  const { transport, appId, sessionId, name } = useCtx();
  return useMemo(
    () => ({
      set: (collection: string, key: string, data: unknown) =>
        mutateVia(transport, "runtime.setDoc", { appId, collection, key, data, sessionId }),
      claim: (collection: string, key: string, data: unknown) =>
        mutateVia(transport, "runtime.claimDoc", { appId, collection, key, data, sessionId }) as Promise<{
          claimed: boolean;
          data: any;
        }>,
      cas: (collection: string, key: string, expect: unknown, data: unknown) =>
        mutateVia(transport, "runtime.casDoc", { appId, collection, key, expect, data, sessionId }) as Promise<{
          ok: boolean;
          data: any;
        }>,
      push: (collection: string, data: unknown) =>
        mutateVia(transport, "runtime.pushItem", { appId, collection, data, sessionId }) as Promise<{
          ok: boolean;
          reason?: string;
        }>,
      increment: (collection: string, key: string, field: string, by: number) =>
        mutateVia(transport, "runtime.incrementField", {
          appId,
          collection,
          key,
          field,
          by,
          sessionId,
        }) as Promise<number>,
      setScore: (displayName: string, points: number) =>
        mutateVia(transport, "runtime.setScore", { appId, sessionId, name: displayName || name, points }),
      addScore: (displayName: string, delta: number) =>
        mutateVia(transport, "runtime.addScore", {
          appId,
          sessionId,
          name: displayName || name,
          delta,
        }) as Promise<number>,
      startTimer: (key: string, ms: number) =>
        mutateVia(transport, "runtime.startTimer", { appId, key, ms, sessionId }),
      reportError: (message: string) =>
        mutateVia(transport, "runtime.reportError", { appId, sessionId, message }).catch(() => {}),
    }),
    [transport, appId, sessionId, name]
  );
}
