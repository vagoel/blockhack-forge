import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal, components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { DEFAULT_GUARDS } from "./lib/appSpec";
import { hasAppConnector } from "./lib/connectors";

const limiter = new RateLimiter(components.rateLimiter, {});

const MAX_SESSION_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 60;
const MAX_COLLECTION_LENGTH = 64;
const MAX_KEY_LENGTH = 256;
const MAX_FIELD_LENGTH = 64;
const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

type Guards = {
  rateLimitPerMin: number;
  maxLen: number;
  maxItems: number;
  monotonicMaxField?: string;
  uniqueBy?: string;
};

async function loadApp(ctx: QueryCtx | MutationCtx, appId: Id<"apps">): Promise<Doc<"apps">> {
  const app = await ctx.db.get(appId);
  if (!app) throw new Error("Invalid appId");
  return app;
}

function requireRealtime(app: Doc<"apps">): void {
  if (!hasAppConnector(app, "convex")) {
    throw new Error("Convex realtime is not enabled for this app");
  }
}

function checkCollection(collection: string): void {
  if (!collection || collection.length > MAX_COLLECTION_LENGTH || collection.startsWith("_")) {
    throw new Error("Invalid collection");
  }
}

function checkReadableCollection(collection: string): void {
  if (!collection || collection.length > MAX_COLLECTION_LENGTH) {
    throw new Error("Invalid collection");
  }
}

function checkKey(key: string): void {
  if (!key || key.length > MAX_KEY_LENGTH) throw new Error("Invalid key");
}

function checkField(field: string): void {
  if (!field || field.length > MAX_FIELD_LENGTH) throw new Error("Invalid field");
}

function checkSessionId(sessionId: string): void {
  if (!sessionId || sessionId.length > MAX_SESSION_ID_LENGTH) {
    throw new Error("Invalid sessionId");
  }
}

function normalizeName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH) || "Guest";
}

function checkFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`Invalid ${label}`);
}

function guardsFor(app: Doc<"apps">, collection: string): Guards {
  const spec = app.spec && typeof app.spec === "object" ? app.spec : {};
  const g =
    spec.collections && typeof spec.collections === "object"
      ? spec.collections[collection] ?? {}
      : {};
  return {
    rateLimitPerMin:
      typeof g.rateLimitPerMin === "number" ? g.rateLimitPerMin : DEFAULT_GUARDS.rateLimitPerMin,
    maxLen: typeof g.maxLen === "number" ? g.maxLen : DEFAULT_GUARDS.maxLen,
    maxItems: typeof g.maxItems === "number" ? g.maxItems : DEFAULT_GUARDS.maxItems,
    monotonicMaxField: typeof g.monotonicMaxField === "string" ? g.monotonicMaxField : undefined,
    uniqueBy: typeof g.uniqueBy === "string" ? g.uniqueBy : undefined,
  };
}

function jsonLen(data: unknown): number {
  const s = JSON.stringify(data);
  return typeof s === "string" ? s.length : 0;
}

function valueAt(obj: unknown, field: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[field] : undefined;
}

async function allowWrite(
  ctx: MutationCtx,
  appId: Id<"apps">,
  collection: string,
  sessionId: string,
  rate: number
): Promise<boolean> {
  const { ok } = await limiter.limit(ctx, `write:${appId}:${collection}`, {
    key: sessionId,
    config: { kind: "fixed window", rate, period: MINUTE },
  });
  return ok;
}

async function getDocRow(
  ctx: QueryCtx | MutationCtx,
  appId: Id<"apps">,
  collection: string,
  key: string
): Promise<Doc<"documents"> | null> {
  return await ctx.db
    .query("documents")
    .withIndex("by_app_collection_key", (q) =>
      q.eq("appId", appId).eq("collection", collection).eq("key", key)
    )
    .first();
}

async function upsertDoc(
  ctx: MutationCtx,
  appId: Id<"apps">,
  collection: string,
  key: string,
  data: unknown,
  sessionId?: string
): Promise<void> {
  const existing = await getDocRow(ctx, appId, collection, key);
  if (existing) {
    await ctx.db.patch(existing._id, { data, updatedBy: sessionId, updatedAt: Date.now() });
  } else {
    await ctx.db.insert("documents", {
      appId,
      collection,
      key,
      data,
      updatedBy: sessionId,
      updatedAt: Date.now(),
    });
  }
}

// ---------------------------------------------------------------------------
// Queries (all room-scoped: keyed by appId only, never by session)
// ---------------------------------------------------------------------------

export const getDoc = query({
  args: { appId: v.id("apps"), collection: v.string(), key: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const app = await loadApp(ctx, args.appId);
    requireRealtime(app);
    checkReadableCollection(args.collection);
    checkKey(args.key);
    const row = await getDocRow(ctx, args.appId, args.collection, args.key);
    return row ? row.data ?? null : null;
  },
});

export const listDocs = query({
  args: { appId: v.id("apps"), collection: v.string() },
  returns: v.array(v.object({ key: v.string(), data: v.any() })),
  handler: async (ctx, args) => {
    const app = await loadApp(ctx, args.appId);
    requireRealtime(app);
    checkReadableCollection(args.collection);
    const rows = await ctx.db
      .query("documents")
      .withIndex("by_app_collection_key", (q) =>
        q.eq("appId", args.appId).eq("collection", args.collection)
      )
      .take(500);
    return rows.map((r) => ({ key: r.key, data: r.data ?? null }));
  },
});

export const listItems = query({
  args: { appId: v.id("apps"), collection: v.string() },
  returns: v.array(
    v.object({ _id: v.id("items"), data: v.any(), sessionId: v.string(), ts: v.number() })
  ),
  handler: async (ctx, args) => {
    const app = await loadApp(ctx, args.appId);
    requireRealtime(app);
    checkReadableCollection(args.collection);
    const rows = await ctx.db
      .query("items")
      .withIndex("by_app_collection", (q) =>
        q.eq("appId", args.appId).eq("collection", args.collection)
      )
      .order("desc")
      .take(300);
    rows.reverse(); // newest-last
    return rows.map((r) => ({ _id: r._id, data: r.data ?? null, sessionId: r.sessionId, ts: r.ts }));
  },
});

export const leaderboard = query({
  args: { appId: v.id("apps"), top: v.optional(v.number()) },
  returns: v.array(v.object({ sessionId: v.string(), name: v.string(), points: v.number() })),
  handler: async (ctx, args) => {
    const app = await loadApp(ctx, args.appId);
    requireRealtime(app);
    const requestedTop = args.top === undefined || !Number.isFinite(args.top) ? 10 : args.top;
    const top = Math.max(1, Math.min(Math.floor(requestedTop), 100));
    const rows = await ctx.db
      .query("scores")
      .withIndex("by_app_points", (q) => q.eq("appId", args.appId))
      .order("desc")
      .take(top);
    return rows.map((r) => ({ sessionId: r.sessionId, name: r.name, points: r.points }));
  },
});

export const getDataset = query({
  args: { appId: v.id("apps") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const app = await loadApp(ctx, args.appId);
    const spec = app.spec && typeof app.spec === "object" ? app.spec : {};
    const name: unknown = spec.dataset?.name;
    if (typeof name !== "string" || !name) return [];
    const rows = await ctx.db
      .query("datasets")
      .withIndex("by_app", (q) => q.eq("appId", args.appId))
      .collect();
    const match = rows.find((d) => d.name === name) ?? rows[0];
    return match ? match.rows : [];
  },
});

// ---------------------------------------------------------------------------
// Mutations (sessionId required; guard rejections do not throw)
// ---------------------------------------------------------------------------

export const setDoc = mutation({
  args: {
    appId: v.id("apps"),
    collection: v.string(),
    key: v.string(),
    data: v.any(),
    sessionId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const app = await loadApp(ctx, args.appId);
    requireRealtime(app);
    checkCollection(args.collection);
    checkKey(args.key);
    checkSessionId(args.sessionId);
    const g = guardsFor(app, args.collection);
    if (jsonLen(args.data) > g.maxLen) return null;
    if (!(await allowWrite(ctx, args.appId, args.collection, args.sessionId, g.rateLimitPerMin))) {
      return null;
    }
    await upsertDoc(ctx, args.appId, args.collection, args.key, args.data, args.sessionId);
    return null;
  },
});

export const claimDoc = mutation({
  args: {
    appId: v.id("apps"),
    collection: v.string(),
    key: v.string(),
    data: v.any(),
    sessionId: v.string(),
  },
  returns: v.object({ claimed: v.boolean(), data: v.any() }),
  handler: async (ctx, args) => {
    const app = await loadApp(ctx, args.appId);
    requireRealtime(app);
    checkCollection(args.collection);
    checkKey(args.key);
    checkSessionId(args.sessionId);
    const existing = await getDocRow(ctx, args.appId, args.collection, args.key);
    if (existing) return { claimed: false, data: existing.data ?? null };
    const g = guardsFor(app, args.collection);
    if (jsonLen(args.data) > g.maxLen) return { claimed: false, data: null };
    if (!(await allowWrite(ctx, args.appId, args.collection, args.sessionId, g.rateLimitPerMin))) {
      return { claimed: false, data: null };
    }
    await ctx.db.insert("documents", {
      appId: args.appId,
      collection: args.collection,
      key: args.key,
      data: args.data,
      updatedBy: args.sessionId,
      updatedAt: Date.now(),
    });
    return { claimed: true, data: args.data ?? null };
  },
});

export const casDoc = mutation({
  args: {
    appId: v.id("apps"),
    collection: v.string(),
    key: v.string(),
    expect: v.any(),
    data: v.any(),
    sessionId: v.string(),
  },
  returns: v.object({ ok: v.boolean(), data: v.any() }),
  handler: async (ctx, args) => {
    const app = await loadApp(ctx, args.appId);
    requireRealtime(app);
    checkCollection(args.collection);
    checkKey(args.key);
    checkSessionId(args.sessionId);
    const existing = await getDocRow(ctx, args.appId, args.collection, args.key);
    const current = existing ? existing.data ?? null : null;
    if (JSON.stringify(current) !== JSON.stringify(args.expect ?? null)) {
      return { ok: false, data: current };
    }
    const g = guardsFor(app, args.collection);
    if (jsonLen(args.data) > g.maxLen) return { ok: false, data: current };
    if (!(await allowWrite(ctx, args.appId, args.collection, args.sessionId, g.rateLimitPerMin))) {
      return { ok: false, data: current };
    }
    await upsertDoc(ctx, args.appId, args.collection, args.key, args.data, args.sessionId);
    return { ok: true, data: args.data ?? null };
  },
});

export const pushItem = mutation({
  args: { appId: v.id("apps"), collection: v.string(), data: v.any(), sessionId: v.string() },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const app = await loadApp(ctx, args.appId);
    requireRealtime(app);
    checkCollection(args.collection);
    checkSessionId(args.sessionId);
    const g = guardsFor(app, args.collection);

    if (jsonLen(args.data) > g.maxLen) return { ok: false, reason: "too_large" };
    if (!(await allowWrite(ctx, args.appId, args.collection, args.sessionId, g.rateLimitPerMin))) {
      return { ok: false, reason: "rate_limited" };
    }

    const existing = await ctx.db
      .query("items")
      .withIndex("by_app_collection", (q) =>
        q.eq("appId", args.appId).eq("collection", args.collection)
      )
      .take(g.maxItems + 1);
    if (existing.length >= g.maxItems) return { ok: false, reason: "collection_full" };

    if (g.uniqueBy) {
      checkField(g.uniqueBy);
      const val = valueAt(args.data, g.uniqueBy);
      if (val !== undefined) {
        const want = JSON.stringify(val);
        const dup = existing.some((it) => {
          const other = valueAt(it.data, g.uniqueBy!);
          return other !== undefined && JSON.stringify(other) === want;
        });
        if (dup) return { ok: false, reason: "duplicate" };
      }
    }

    if (g.monotonicMaxField) {
      const field = g.monotonicMaxField;
      checkField(field);
      const val = valueAt(args.data, field);
      if (typeof val !== "number" || !Number.isFinite(val)) {
        return { ok: false, reason: "not_monotonic" };
      }
      const metaKey = `_max:${args.collection}:${field}`;
      const maxRow = await getDocRow(ctx, args.appId, "_meta", metaKey);
      const storedMax = maxRow ? valueAt(maxRow.data, "max") : null;
      let max: number | null =
        typeof storedMax === "number" && Number.isFinite(storedMax) ? storedMax : null;
      if (max === null) {
        // First push with this guard: derive max from existing items.
        for (const it of existing) {
          const x = valueAt(it.data, field);
          if (typeof x === "number" && Number.isFinite(x) && (max === null || x > max)) max = x;
        }
      }
      if (max !== null && val <= max) return { ok: false, reason: "not_monotonic" };
      // Maintain the max transactionally so future checks are O(1).
      if (maxRow) {
        await ctx.db.patch(maxRow._id, { data: { max: val }, updatedAt: Date.now() });
      } else {
        await ctx.db.insert("documents", {
          appId: args.appId,
          collection: "_meta",
          key: metaKey,
          data: { max: val },
          updatedAt: Date.now(),
        });
      }
    }

    await ctx.db.insert("items", {
      appId: args.appId,
      collection: args.collection,
      data: args.data,
      sessionId: args.sessionId,
      ts: Date.now(),
    });
    return { ok: true };
  },
});

export const incrementField = mutation({
  args: {
    appId: v.id("apps"),
    collection: v.string(),
    key: v.string(),
    field: v.string(),
    by: v.number(),
    sessionId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const app = await loadApp(ctx, args.appId);
    requireRealtime(app);
    checkCollection(args.collection);
    checkKey(args.key);
    checkField(args.field);
    checkSessionId(args.sessionId);
    checkFinite(args.by, "increment");
    const g = guardsFor(app, args.collection);
    const existing = await getDocRow(ctx, args.appId, args.collection, args.key);
    const base =
      existing && existing.data && typeof existing.data === "object" && !Array.isArray(existing.data)
        ? (existing.data as Record<string, unknown>)
        : {};
    const stored = base[args.field];
    const cur = typeof stored === "number" && Number.isFinite(stored) ? stored : 0;
    if (!(await allowWrite(ctx, args.appId, args.collection, args.sessionId, g.rateLimitPerMin))) {
      return cur; // rate-limited: no-op, report current value
    }
    const next = cur + args.by;
    checkFinite(next, "increment result");
    const data = { ...base, [args.field]: next };
    if (existing) {
      await ctx.db.patch(existing._id, { data, updatedBy: args.sessionId, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("documents", {
        appId: args.appId,
        collection: args.collection,
        key: args.key,
        data,
        updatedBy: args.sessionId,
        updatedAt: Date.now(),
      });
    }
    return next;
  },
});

async function scoreWriteAllowed(
  ctx: MutationCtx,
  appId: Id<"apps">,
  sessionId: string
): Promise<boolean> {
  const { ok } = await limiter.limit(ctx, `score:${appId}`, {
    key: sessionId,
    config: { kind: "fixed window", rate: 120, period: MINUTE },
  });
  return ok;
}

async function getScoreRow(
  ctx: MutationCtx,
  appId: Id<"apps">,
  sessionId: string
): Promise<Doc<"scores"> | null> {
  return await ctx.db
    .query("scores")
    .withIndex("by_app_session", (q) => q.eq("appId", appId).eq("sessionId", sessionId))
    .first();
}

export const setScore = mutation({
  args: {
    appId: v.id("apps"),
    sessionId: v.string(),
    name: v.string(),
    points: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const app = await loadApp(ctx, args.appId);
    requireRealtime(app);
    checkSessionId(args.sessionId);
    checkFinite(args.points, "score");
    if (!(await scoreWriteAllowed(ctx, args.appId, args.sessionId))) return null;
    const name = normalizeName(args.name);
    const existing = await getScoreRow(ctx, args.appId, args.sessionId);
    if (existing) {
      await ctx.db.patch(existing._id, { name, points: args.points });
    } else {
      await ctx.db.insert("scores", {
        appId: args.appId,
        sessionId: args.sessionId,
        name,
        points: args.points,
      });
    }
    return null;
  },
});

export const addScore = mutation({
  args: {
    appId: v.id("apps"),
    sessionId: v.string(),
    name: v.string(),
    delta: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const app = await loadApp(ctx, args.appId);
    requireRealtime(app);
    checkSessionId(args.sessionId);
    checkFinite(args.delta, "score delta");
    const existing = await getScoreRow(ctx, args.appId, args.sessionId);
    const cur = existing && Number.isFinite(existing.points) ? existing.points : 0;
    if (!(await scoreWriteAllowed(ctx, args.appId, args.sessionId))) return cur;
    const name = normalizeName(args.name);
    const next = cur + args.delta;
    checkFinite(next, "score");
    if (existing) {
      await ctx.db.patch(existing._id, { name, points: next });
    } else {
      await ctx.db.insert("scores", {
        appId: args.appId,
        sessionId: args.sessionId,
        name,
        points: next,
      });
    }
    return next;
  },
});

export const startTimer = mutation({
  args: { appId: v.id("apps"), key: v.string(), ms: v.number(), sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const app = await loadApp(ctx, args.appId);
    requireRealtime(app);
    checkKey(args.key);
    checkSessionId(args.sessionId);
    checkFinite(args.ms, "timer duration");
    const g = guardsFor(app, "timers");
    if (!(await allowWrite(ctx, args.appId, "timers", args.sessionId, g.rateLimitPerMin))) {
      return null;
    }
    const ms = Math.max(0, Math.min(Math.floor(args.ms), MAX_TIMER_MS));
    const endsAt = Date.now() + ms;
    await upsertDoc(ctx, args.appId, "timers", args.key, { endsAt, fired: false }, args.sessionId);
    await ctx.scheduler.runAfter(ms, internal.runtime.fireTimer, {
      appId: args.appId,
      key: args.key,
    });
    return null;
  },
});

export const fireTimer = internalMutation({
  args: { appId: v.id("apps"), key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    checkKey(args.key);
    const row = await getDocRow(ctx, args.appId, "timers", args.key);
    if (!row) return null;
    const data =
      row.data && typeof row.data === "object" && !Array.isArray(row.data)
        ? (row.data as Record<string, unknown>)
        : {};
    if (data.fired === true) return null;
    // If the timer was restarted with a later endsAt, this (stale) fire is a no-op.
    if (typeof data.endsAt === "number" && Date.now() < data.endsAt - 250) return null;
    await ctx.db.patch(row._id, { data: { ...data, fired: true }, updatedAt: Date.now() });
    return null;
  },
});

export const reportError = mutation({
  args: {
    appId: v.id("apps"),
    sessionId: v.string(),
    message: v.string(),
    versionId: v.optional(v.id("appVersions")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await loadApp(ctx, args.appId);
    checkSessionId(args.sessionId);
    const { ok } = await limiter.limit(ctx, `reportError:${args.appId}`, {
      key: args.sessionId,
      config: { kind: "fixed window", rate: 10, period: MINUTE },
    });
    if (!ok) return null;
    await ctx.db.insert("telemetry", {
      appId: args.appId,
      versionId: args.versionId,
      sessionId: args.sessionId,
      message: args.message.slice(0, 2000),
      ts: Date.now(),
    });
    return null;
  },
});

export const registerPlayerName = mutation({
  args: {
    appId: v.id("apps"),
    sessionId: v.string(),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await loadApp(ctx, args.appId);
    checkSessionId(args.sessionId);
    if (!(await allowWrite(ctx, args.appId, "_players", args.sessionId, 30))) return null;
    await upsertDoc(
      ctx,
      args.appId,
      "_players",
      args.sessionId,
      { name: normalizeName(args.name) },
      args.sessionId
    );
    return null;
  },
});
