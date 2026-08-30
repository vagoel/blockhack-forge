import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { requireOperator } from "./lib/operator";
import { slugify } from "./lib/appSpec";
import {
  appConnectors,
  connectorsValidator,
  normalizeConnectors,
  type ConnectorId,
} from "./lib/connectors";
import {
  devinModeLabel,
  devinModeValidator,
  normalizeDevinMode,
} from "./lib/devinMode";
import { shouldAutomaticallyRepairCompile } from "./lib/compileRepair";

declare const process: { env: Record<string, string | undefined> };

const MAX_PROMPT_LENGTH = 8000;
const MAX_BUNDLE_LENGTH = 600_000;

function buildShape(b: Doc<"builds">) {
  return {
    _id: b._id,
    prompt: b.prompt,
    styleUrl: b.styleUrl,
    devinMode: normalizeDevinMode(b.devinMode),
    status: b.status,
    appId: b.appId,
    appSlug: b.appSlug,
    error: b.error,
    retried: b.retried,
    connectors: [...appConnectors(b)],
    deploymentStatus: b.deploymentStatus,
    productionUrl: b.productionUrl,
    createdAt: b.createdAt,
  };
}

const buildValidator = v.object({
  _id: v.id("builds"),
  prompt: v.string(),
  styleUrl: v.optional(v.string()),
  devinMode: devinModeValidator,
  status: v.string(),
  appId: v.optional(v.id("apps")),
  appSlug: v.optional(v.string()),
  error: v.optional(v.string()),
  retried: v.optional(v.boolean()),
  connectors: connectorsValidator,
  deploymentStatus: v.optional(v.string()),
  productionUrl: v.optional(v.string()),
  createdAt: v.number(),
});

function envPresent(...values: Array<string | undefined>): boolean {
  return values.some((value) => Boolean(value?.trim()));
}

function requireConnectorConfiguration(connectors: readonly ConnectorId[]): void {
  if (!connectors.includes("vercel")) {
    throw new Error("Vercel publishing is required for every new app");
  }
  if (
    connectors.includes("context") &&
    !envPresent(process.env.CONTEXT_DEV_API_KEY, process.env.CONTEXT)
  ) {
    throw new Error("Context is selected but its credential is not configured");
  }
  if (
    connectors.includes("openai") &&
    !envPresent(process.env.OPENAI_API_KEY, process.env.OPENAI_KEY)
  ) {
    throw new Error("Intelligence is selected but its credential is not configured");
  }
  if (
    connectors.includes("vercel") &&
    !envPresent(process.env.VERCEL_TOKEN, process.env.VERCEL)
  ) {
    throw new Error("Vercel is selected but its credential is not configured");
  }
}

export const request = mutation({
  args: {
    prompt: v.string(),
    styleUrl: v.optional(v.string()),
    devinMode: v.optional(devinModeValidator),
    connectors: connectorsValidator,
    operatorKey: v.string(),
  },
  returns: v.object({ buildId: v.id("builds"), appSlug: v.string() }),
  handler: async (ctx, args) => {
    requireOperator(args.operatorKey);
    const prompt = args.prompt.trim();
    if (!prompt) throw new Error("Prompt is required");
    if (prompt.length > MAX_PROMPT_LENGTH) throw new Error("Prompt is too long");
    const connectors = normalizeConnectors(args.connectors);
    const devinMode = normalizeDevinMode(args.devinMode);
    if (devinMode !== "default" && !process.env.DEVIN?.trim().startsWith("cog_")) {
      throw new Error(
        `${devinModeLabel(devinMode)} requires a current cog_ API key, DEVIN_ORG_ID, and Devin API v3`,
      );
    }
    requireConnectorConfiguration(connectors);
    const styleUrl = args.styleUrl?.trim();
    if (styleUrl && !connectors.includes("context")) {
      throw new Error("Enable Context to use a style or reference URL");
    }
    if (styleUrl) {
      let parsed: URL;
      try {
        parsed = new URL(styleUrl);
      } catch {
        throw new Error("Style URL is invalid");
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("Style URL must use http or https");
      }
    }
    const buildId = await ctx.db.insert("builds", {
      prompt,
      styleUrl: styleUrl ? styleUrl : undefined,
      devinMode,
      connectors,
      status: "queued",
      createdAt: Date.now(),
    });

    // Reserve a stable audience URL immediately so people can join the waiting
    // room while Devin is still working.
    const provisionalName = prompt.replace(/https?:\/\/\S+/g, "").trim().slice(0, 60) || "New app";
    const base = slugify(provisionalName);
    let appSlug = base;
    for (let i = 2; i <= 50; i++) {
      const hit = await ctx.db
        .query("apps")
        .withIndex("by_slug", (q) => q.eq("slug", appSlug))
        .first();
      if (!hit) break;
      appSlug = i === 50 ? `${base}-${Date.now().toString(36)}` : `${base}-${i}`;
    }
    const appId = await ctx.db.insert("apps", {
      slug: appSlug,
      name: provisionalName,
      prompt,
      status: "generating",
      spec: { name: provisionalName, description: "Being generated" },
      connectors,
      createdAt: Date.now(),
    });
    await ctx.db.patch(buildId, { appId, appSlug });
    await ctx.db.insert("buildEvents", {
      buildId,
      ts: Date.now(),
      kind: "info",
      message: `build queued with ${connectors.join(", ")} · ${devinModeLabel(devinMode)}`,
    });
    await ctx.scheduler.runAfter(0, internal.devinActions.start, { buildId });
    return { buildId, appSlug };
  },
});

export const feed = query({
  args: { buildId: v.id("builds"), operatorKey: v.string() },
  returns: v.object({
    build: buildValidator,
    events: v.array(v.object({ ts: v.number(), kind: v.string(), message: v.string() })),
  }),
  handler: async (ctx, args) => {
    requireOperator(args.operatorKey);
    const build = await ctx.db.get(args.buildId);
    if (!build) throw new Error("Unknown build");
    const events = await ctx.db
      .query("buildEvents")
      .withIndex("by_build", (q) => q.eq("buildId", args.buildId))
      .order("asc")
      .take(500);
    return {
      build: buildShape(build),
      events: events.map((e) => ({ ts: e.ts, kind: e.kind, message: e.message })),
    };
  },
});

export const listRecent = query({
  args: { operatorKey: v.string() },
  returns: v.array(buildValidator),
  handler: async (ctx, args) => {
    requireOperator(args.operatorKey);
    const builds = await ctx.db.query("builds").order("desc").take(20);
    return builds.map(buildShape);
  },
});

export const awaitingCompile = query({
  args: { operatorKey: v.string() },
  returns: v.array(
    v.object({
      versionId: v.id("appVersions"),
      appId: v.id("apps"),
      tsxSource: v.string(),
      buildId: v.optional(v.id("builds")),
      connectors: connectorsValidator,
    })
  ),
  handler: async (ctx, args) => {
    requireOperator(args.operatorKey);
    const versions = await ctx.db
      .query("appVersions")
      .withIndex("by_status", (q) => q.eq("status", "awaiting_compile"))
      .take(10);
    return versions.map((ver) => ({
      versionId: ver._id,
      appId: ver.appId,
      tsxSource: ver.tsxSource,
      buildId: ver.buildId,
      connectors: [...appConnectors(ver)],
    }));
  },
});

export const submitCompiled = mutation({
  args: { versionId: v.id("appVersions"), bundle: v.string(), operatorKey: v.string() },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, args) => {
    requireOperator(args.operatorKey);
    if (!args.bundle.trim() || args.bundle.length > MAX_BUNDLE_LENGTH) {
      throw new Error("Compiled bundle is empty or too large");
    }
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new Error("Unknown version");
    const app = await ctx.db.get(version.appId);
    if (!app) throw new Error("Unknown app for version");
    if (version.status === "live") return { slug: app.slug };
    if (version.status !== "awaiting_compile") throw new Error("Version is not awaiting compile");
    await ctx.db.patch(version._id, { bundle: args.bundle, status: "live" });
    // Only advance the app pointer if this is not an out-of-date version.
    const current = app.currentVersionId ? await ctx.db.get(app.currentVersionId) : null;
    if (!current || version.version >= current.version) {
      await ctx.db.patch(app._id, { currentVersionId: version._id, status: "live" });
    }
    if (version.buildId) {
      await ctx.db.patch(version.buildId, {
        status: "live",
        appId: version.appId,
        appSlug: app.slug,
        compileRepairAttempts: 0,
      });
      await ctx.db.insert("buildEvents", {
        buildId: version.buildId,
        ts: Date.now(),
        kind: "compile",
        message: `compiled and live at /${app.slug}`,
      });
    }
    // Queue publishing through an exactly-once scheduled mutation. The
    // connector snapshot on the version decides whether a job is created.
    await ctx.scheduler.runAfter(0, internal.vercelData.queueForVersion, {
      versionId: version._id,
    });
    return { slug: app.slug };
  },
});

export const compileFailed = mutation({
  args: { versionId: v.id("appVersions"), error: v.string(), operatorKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireOperator(args.operatorKey);
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new Error("Unknown version");
    if (version.status === "live" || version.status === "error") return null;
    await ctx.db.patch(version._id, { status: "error" });
    const app = await ctx.db.get(version.appId);
    const build = version.buildId ? await ctx.db.get(version.buildId) : null;
    const canRepair = shouldAutomaticallyRepairCompile(
      build?.compileRepairAttempts,
      Boolean(version.devinSessionDocId),
    );

    if (build && version.buildId && version.devinSessionDocId && canRepair) {
      await ctx.db.patch(build._id, {
        status: "generating",
        error: undefined,
        compileRepairAttempts: (build.compileRepairAttempts ?? 0) + 1,
      });
      if (app) {
        await ctx.db.patch(app._id, {
          status: app.currentVersionId ? "live" : "generating",
        });
      }
      await ctx.db.insert("buildEvents", {
        buildId: build._id,
        ts: Date.now(),
        kind: "compile",
        message: "compile preflight found a source-contract issue — Devin is correcting it automatically",
      });
      await ctx.scheduler.runAfter(0, internal.devin.repairCompile, {
        sessionDocId: version.devinSessionDocId,
        error: args.error.slice(0, 1_200),
      });
      return null;
    }

    if (app && app.status === "awaiting_compile") {
      await ctx.db.patch(app._id, { status: "error" });
    }
    if (version.buildId) {
      const message = `compile failed: ${args.error.slice(0, 400)}`;
      await ctx.db.patch(version.buildId, { status: "error", error: message });
      await ctx.db.insert("buildEvents", {
        buildId: version.buildId,
        ts: Date.now(),
        kind: "error",
        message,
      });
    }
    return null;
  },
});

export const compileRepairFailed = internalMutation({
  args: { buildId: v.id("builds"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const build = await ctx.db.get(args.buildId);
    if (!build) return null;
    const message = `Automatic compile correction failed: ${args.error.slice(0, 400)}`;
    await ctx.db.patch(build._id, { status: "error", error: message });
    if (build.appId) {
      const app = await ctx.db.get(build.appId);
      if (app && !app.currentVersionId) await ctx.db.patch(app._id, { status: "error" });
    }
    await ctx.db.insert("buildEvents", {
      buildId: build._id,
      ts: Date.now(),
      kind: "error",
      message,
    });
    return null;
  },
});

/** Retry the compiler against source Devin already generated (no new session/ACU). */
export const retryCompile = mutation({
  args: { buildId: v.id("builds"), operatorKey: v.string() },
  returns: v.object({ versionId: v.id("appVersions") }),
  handler: async (ctx, args) => {
    requireOperator(args.operatorKey);
    const build = await ctx.db.get(args.buildId);
    if (!build) throw new Error("Unknown build");
    const versions = await ctx.db
      .query("appVersions")
      .withIndex("by_build", (q) => q.eq("buildId", args.buildId))
      .collect();
    const version = versions
      .filter((candidate) => candidate.status === "error")
      .sort((a, b) => b.version - a.version)[0];
    if (!version) throw new Error("This build has no failed generated source to recompile");
    const app = await ctx.db.get(version.appId);
    if (!app) throw new Error("Unknown app for version");

    await ctx.db.patch(version._id, { status: "awaiting_compile" });
    await ctx.db.patch(build._id, { status: "awaiting_compile", error: undefined });
    await ctx.db.patch(app._id, {
      status: app.currentVersionId ? "live" : "awaiting_compile",
    });
    await ctx.db.insert("buildEvents", {
      buildId: build._id,
      ts: Date.now(),
      kind: "compile",
      message: "retrying the existing generated source — no new Devin session",
    });
    return { versionId: version._id };
  },
});

export const logEvent = internalMutation({
  args: { buildId: v.id("builds"), kind: v.string(), message: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("buildEvents", {
      buildId: args.buildId,
      ts: Date.now(),
      kind: args.kind,
      message: args.message,
    });
    return null;
  },
});

export const getBuild = internalQuery({
  args: { buildId: v.id("builds") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.buildId);
  },
});

// Generic internal patch used by the Devin pipeline.
export const patch = internalMutation({
  args: {
    buildId: v.id("builds"),
    status: v.optional(v.string()),
    error: v.optional(v.string()),
    appId: v.optional(v.id("apps")),
    appSlug: v.optional(v.string()),
    retried: v.optional(v.boolean()),
    deploymentStatus: v.optional(v.string()),
    productionUrl: v.optional(v.string()),
    styleUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { buildId, ...fields } = args;
    const build = await ctx.db.get(buildId);
    if (!build) return null;
    const update: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(fields)) {
      if (val !== undefined) update[k] = val;
    }
    if (Object.keys(update).length > 0) await ctx.db.patch(buildId, update);
    const appId = args.appId ?? build.appId;
    if (appId && args.status) {
      const app = await ctx.db.get(appId);
      const isRevisionInFlight =
        args.status === "queued" ||
        args.status === "grounding" ||
        args.status === "generating" ||
        args.status === "awaiting_compile";
      const appStatus = app?.currentVersionId && isRevisionInFlight
        ? "live"
        : args.status === "queued" || args.status === "grounding" || args.status === "generating"
          ? "generating"
          : args.status;
      await ctx.db.patch(appId, { status: appStatus });
    }
    return null;
  },
});

export const saveDataset = internalMutation({
  args: {
    buildId: v.id("builds"),
    name: v.string(),
    rows: v.array(v.any()),
    sourceUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("datasets")
      .filter((q) => q.and(q.eq(q.field("buildId"), args.buildId), q.eq(q.field("name"), args.name)))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { rows: args.rows, sourceUrl: args.sourceUrl });
    } else {
      await ctx.db.insert("datasets", {
        buildId: args.buildId,
        name: args.name,
        rows: args.rows,
        sourceUrl: args.sourceUrl,
        createdAt: Date.now(),
      });
    }
    return null;
  },
});

// contextCache access for the "use node" contextdev actions.
export const cacheGet = internalQuery({
  args: { cacheKey: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("contextCache")
      .withIndex("by_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first();
    return row ? row.value : null;
  },
});

export const cachePut = internalMutation({
  args: { cacheKey: v.string(), value: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("contextCache")
      .withIndex("by_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first();
    if (row) {
      await ctx.db.patch(row._id, { value: args.value, createdAt: Date.now() });
    } else {
      await ctx.db.insert("contextCache", {
        cacheKey: args.cacheKey,
        value: args.value,
        createdAt: Date.now(),
      });
    }
    return null;
  },
});

// Two distributed Context.dev slots. Leases expire automatically so a killed
// action cannot permanently stall future grounding requests.
export const acquireContextSlot = internalMutation({
  args: { owner: v.string(), leaseMs: v.number() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { owner, leaseMs }) => {
    const now = Date.now();
    const until = now + Math.max(10_000, Math.min(leaseMs, 5 * 60_000));
    for (let slot = 0; slot < 2; slot++) {
      const key = `context-slot-${slot}`;
      const row = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
      const value = row?.value && typeof row.value === "object" ? row.value : null;
      const busyUntil = typeof value?.busyUntil === "number" ? value.busyUntil : 0;
      if (!row) {
        await ctx.db.insert("settings", { key, value: { owner, busyUntil: until } });
        return slot;
      }
      if (busyUntil <= now || value?.owner === owner) {
        await ctx.db.patch(row._id, { value: { owner, busyUntil: until } });
        return slot;
      }
    }
    return null;
  },
});

export const releaseContextSlot = internalMutation({
  args: { owner: v.string(), slot: v.number() },
  returns: v.null(),
  handler: async (ctx, { owner, slot }) => {
    if (slot !== 0 && slot !== 1) return null;
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", `context-slot-${slot}`))
      .first();
    const value = row?.value && typeof row.value === "object" ? row.value : null;
    if (row && value?.owner === owner) {
      await ctx.db.patch(row._id, { value: { owner: "", busyUntil: 0 } });
    }
    return null;
  },
});
