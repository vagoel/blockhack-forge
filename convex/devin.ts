import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOperator } from "./lib/operator";
import { sourceFingerprint } from "./lib/sourceFingerprint";
import { compileRepairPrompt } from "./lib/compileRepair";
import {
  devinModeValidator,
  normalizeDevinMode,
  providerDevinModeValidator,
  type DevinMode,
} from "./lib/devinMode";

// Convex runtimes expose process.env; @types/node is not part of this tsconfig.
declare const process: { env: Record<string, string | undefined> };

type DevinApiVersion = "v1" | "v3";

export const capabilities = query({
  args: { operatorKey: v.string() },
  returns: v.object({
    apiVersion: v.union(v.literal("v1"), v.literal("v3")),
    supportedModes: v.array(devinModeValidator),
  }),
  handler: async (_ctx, args) => {
    requireOperator(args.operatorKey);
    const key = process.env.DEVIN?.trim();
    if (!key) throw new Error("DEVIN is not configured");
    if (key.startsWith("cog_")) {
      const supportedModes: DevinMode[] = [
        "default",
        "normal",
        "fast",
        "lite",
        "ultra",
        "fusion",
      ];
      return { apiVersion: "v3" as const, supportedModes };
    }
    if (key.startsWith("apk_")) {
      const supportedModes: DevinMode[] = ["default"];
      return { apiVersion: "v1" as const, supportedModes };
    }
    throw new Error("DEVIN credential format is unsupported");
  },
});

function sessionApiVersion(session: { apiVersion?: DevinApiVersion }): DevinApiVersion {
  // Rows created before API versioning used v1 exclusively.
  return session.apiVersion ?? "v1";
}

function storedDevinMode(session: {
  apiVersion?: DevinApiVersion;
  devinMode?: DevinMode;
}): DevinMode {
  if (session.devinMode !== undefined) return normalizeDevinMode(session.devinMode);
  // The pre-picker v3 adapter always requested Fast. Pre-versioned rows were v1.
  return session.apiVersion === "v3" ? "fast" : "default";
}

function devinKeyFor(version: DevinApiVersion): string {
  const key = process.env.DEVIN?.trim();
  if (!key) throw new Error("DEVIN is not configured");
  if (version === "v3" && !key.startsWith("cog_")) {
    throw new Error("This Devin v3 session requires a cog_ service-user token");
  }
  if (version === "v1" && !key.startsWith("apk_")) {
    throw new Error("This Devin v1 session requires an apk_ legacy API key");
  }
  return key;
}

export const listSessions = query({
  args: { operatorKey: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("devinSessions"),
      buildId: v.id("builds"),
      devinSessionId: v.string(),
      apiVersion: v.optional(v.union(v.literal("v1"), v.literal("v3"))),
      devinMode: devinModeValidator,
      resolvedDevinMode: v.optional(providerDevinModeValidator),
      status: v.string(),
      statusDetail: v.optional(v.string()),
      acus: v.optional(v.number()),
      url: v.optional(v.string()),
      prUrl: v.optional(v.string()),
      terminal: v.boolean(),
      generation: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    requireOperator(args.operatorKey);
    const rows = await ctx.db.query("devinSessions").order("desc").take(20);
    return rows.map((r) => ({
      _id: r._id,
      buildId: r.buildId,
      devinSessionId: r.devinSessionId,
      apiVersion: r.apiVersion,
      devinMode: storedDevinMode(r),
      resolvedDevinMode: r.resolvedDevinMode,
      status: r.terminal && r.structuredOutput !== undefined ? "completed" : r.status,
      statusDetail:
        r.terminal && r.structuredOutput !== undefined ? "output_ready" : r.statusDetail,
      acus: r.acus,
      url: r.url,
      prUrl: r.prUrl,
      terminal: r.terminal,
      generation: r.generation ?? 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  },
});

/** Build-scoped lookup keeps old projects chat-capable beyond the global top 20. */
export const sessionsForBuild = query({
  args: { buildId: v.id("builds"), operatorKey: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("devinSessions"),
      buildId: v.id("builds"),
      devinSessionId: v.string(),
      apiVersion: v.optional(v.union(v.literal("v1"), v.literal("v3"))),
      devinMode: devinModeValidator,
      resolvedDevinMode: v.optional(providerDevinModeValidator),
      status: v.string(),
      statusDetail: v.optional(v.string()),
      acus: v.optional(v.number()),
      url: v.optional(v.string()),
      prUrl: v.optional(v.string()),
      terminal: v.boolean(),
      generation: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    requireOperator(args.operatorKey);
    const rows = await ctx.db
      .query("devinSessions")
      .withIndex("by_build", (q) => q.eq("buildId", args.buildId))
      .order("desc")
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      buildId: r.buildId,
      devinSessionId: r.devinSessionId,
      apiVersion: r.apiVersion,
      devinMode: storedDevinMode(r),
      resolvedDevinMode: r.resolvedDevinMode,
      status: r.terminal && r.structuredOutput !== undefined ? "completed" : r.status,
      statusDetail:
        r.terminal && r.structuredOutput !== undefined ? "output_ready" : r.statusDetail,
      acus: r.acus,
      url: r.url,
      prUrl: r.prUrl,
      terminal: r.terminal,
      generation: r.generation ?? 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  },
});

export const pending = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("devinSessions"),
      buildId: v.id("builds"),
      devinSessionId: v.string(),
      apiVersion: v.optional(v.union(v.literal("v1"), v.literal("v3"))),
      devinMode: devinModeValidator,
      orgId: v.optional(v.string()),
      status: v.string(),
      statusDetail: v.optional(v.string()),
      generation: v.number(),
      awaitingResume: v.boolean(),
      lastOutputFingerprint: v.optional(v.string()),
    })
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("devinSessions")
      .withIndex("by_terminal", (q) => q.eq("terminal", false))
      .take(50);
    return rows.map((r) => ({
      _id: r._id,
      buildId: r.buildId,
      devinSessionId: r.devinSessionId,
      apiVersion: r.apiVersion,
      devinMode: storedDevinMode(r),
      orgId: r.orgId,
      status: r.status,
      statusDetail: r.statusDetail,
      generation: r.generation ?? 0,
      awaitingResume: r.awaitingResume ?? false,
      lastOutputFingerprint: r.lastOutputFingerprint,
    }));
  },
});

export const getSession = internalQuery({
  args: { id: v.id("devinSessions") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Atomically claim the right to start a billable Devin session for a build.
 * Convex actions and scheduled functions may be delivered more than once, so
 * checking only inside the action can race. A terminal session plus a build
 * explicitly reset to queued is the one supported retry path.
 */
export const claimStart = internalMutation({
  args: { buildId: v.id("builds") },
  returns: v.boolean(),
  handler: async (ctx, { buildId }) => {
    const build = await ctx.db.get(buildId);
    if (!build || build.status !== "queued") return false;

    const sessions = await ctx.db
      .query("devinSessions")
      .withIndex("by_build", (q) => q.eq("buildId", buildId))
      .collect();
    if (sessions.some((session) => !session.terminal)) return false;

    await ctx.db.patch(buildId, { status: "grounding" });
    return true;
  },
});

export const createSession = internalMutation({
  args: {
    buildId: v.id("builds"),
    devinSessionId: v.string(),
    apiVersion: v.union(v.literal("v1"), v.literal("v3")),
    devinMode: devinModeValidator,
    resolvedDevinMode: v.optional(providerDevinModeValidator),
    orgId: v.optional(v.string()),
    status: v.optional(v.string()),
    statusDetail: v.optional(v.string()),
    acus: v.optional(v.number()),
    url: v.optional(v.string()),
  },
  returns: v.id("devinSessions"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("devinSessions", {
      buildId: args.buildId,
      devinSessionId: args.devinSessionId,
      apiVersion: args.apiVersion,
      devinMode: args.devinMode,
      resolvedDevinMode: args.resolvedDevinMode,
      orgId: args.orgId,
      url: args.url,
      status: args.status ?? (args.apiVersion === "v3" ? "new" : "working"),
      statusDetail: args.statusDetail,
      acus: args.acus,
      terminal: false,
      generation: 0,
      awaitingResume: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const upsertFromPoll = internalMutation({
  args: {
    id: v.id("devinSessions"),
    status: v.optional(v.string()),
    statusDetail: v.optional(v.string()),
    acus: v.optional(v.number()),
    url: v.optional(v.string()),
    prUrl: v.optional(v.string()),
    structuredOutput: v.optional(v.any()),
    lastOutputFingerprint: v.optional(v.string()),
    awaitingResume: v.optional(v.boolean()),
    terminal: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const update: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(fields)) {
      if (val !== undefined) update[k] = val;
    }
    await ctx.db.patch(id, update);
    return null;
  },
});

export const markResumed = internalMutation({
  args: { id: v.id("devinSessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { awaitingResume: false, updatedAt: Date.now() });
    return null;
  },
});

/** Reopen one accepted conversation turn and poll it immediately. */
export const resumeAfterReply = internalMutation({
  args: {
    id: v.id("devinSessions"),
    status: v.string(),
    acus: v.optional(v.number()),
    url: v.optional(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error("Unknown session");
    let lastOutputFingerprint = session.lastOutputFingerprint;
    if (!lastOutputFingerprint) {
      const versions = await ctx.db
        .query("appVersions")
        .withIndex("by_build", (q) => q.eq("buildId", session.buildId))
        .collect();
      const latest = versions.sort((a, b) => b.version - a.version)[0];
      if (latest) lastOutputFingerprint = sourceFingerprint(latest.tsxSource);
    }
    const generation = (session.generation ?? 0) + 1;
    await ctx.db.patch(args.id, {
      terminal: false,
      generation,
      awaitingResume: true,
      lastOutputFingerprint,
      status: args.status,
      statusDetail: undefined,
      structuredOutput: undefined,
      acus: args.acus ?? session.acus,
      url: args.url ?? session.url,
      updatedAt: Date.now(),
    });
    // Update the build workspace without downgrading the already-live app.
    // Preserve the previous error value so an unchanged conversational answer
    // can return to the exact prior state. It is only displayed while status
    // is `error`, and successful compilation supersedes it.
    await ctx.db.patch(session.buildId, { status: "generating" });
    await ctx.scheduler.runAfter(0, internal.devinActions.poll, {});
    return generation;
  },
});

export const reply = action({
  args: {
    sessionDocId: v.id("devinSessions"),
    message: v.string(),
    operatorKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireOperator(args.operatorKey);
    const session = await ctx.runQuery(internal.devin.getSession, { id: args.sessionDocId });
    if (!session) throw new Error("Unknown session");
    const message = args.message.trim();
    if (!message) throw new Error("Reply message is required");

    const apiVersion = sessionApiVersion(session);
    const key = devinKeyFor(apiVersion);
    let url: string;
    if (apiVersion === "v3") {
      if (!session.orgId) throw new Error("Devin v3 session is missing its organization ID");
      url = `https://api.devin.ai/v3/organizations/${encodeURIComponent(session.orgId)}/sessions/${encodeURIComponent(session.devinSessionId)}/messages`;
    } else {
      url = `https://api.devin.ai/v1/sessions/${encodeURIComponent(session.devinSessionId)}/message`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const responseText = await res.text();
    if (!res.ok) {
      const detail = responseText.slice(0, 200);
      throw new Error(`Devin ${apiVersion} reply failed: ${res.status} ${detail}`.trim());
    }
    let responseBody: any = null;
    if (responseText.trim()) {
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        // v1 commonly returns an empty body; the next GET is authoritative.
      }
    }
    await ctx.runMutation(internal.devin.resumeAfterReply, {
      id: session._id,
      status:
        apiVersion === "v3" && typeof responseBody?.status === "string"
          ? responseBody.status
          : apiVersion === "v3"
            ? "resuming"
            : "resume_requested",
      acus:
        apiVersion === "v3" && typeof responseBody?.acus_consumed === "number"
          ? responseBody.acus_consumed
          : undefined,
      url:
        apiVersion === "v3" && typeof responseBody?.url === "string"
          ? responseBody.url
          : undefined,
    });
    await ctx.runMutation(internal.builds.logEvent, {
      buildId: session.buildId,
      kind: "devin-user",
      message: message.slice(0, 2_000),
    });
    return null;
  },
});

export const repairCompile = internalAction({
  args: {
    sessionDocId: v.id("devinSessions"),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.runQuery(internal.devin.getSession, { id: args.sessionDocId });
    if (!session) return null;
    const message = compileRepairPrompt(args.error);

    try {
      const apiVersion = sessionApiVersion(session);
      const key = devinKeyFor(apiVersion);
      let url: string;
      if (apiVersion === "v3") {
        if (!session.orgId) throw new Error("Devin v3 session is missing its organization ID");
        url = `https://api.devin.ai/v3/organizations/${encodeURIComponent(session.orgId)}/sessions/${encodeURIComponent(session.devinSessionId)}/messages`;
      } else {
        url = `https://api.devin.ai/v1/sessions/${encodeURIComponent(session.devinSessionId)}/message`;
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const responseText = await res.text();
      if (!res.ok) {
        throw new Error(`Devin ${apiVersion} correction failed: ${res.status} ${responseText.slice(0, 200)}`.trim());
      }
      let responseBody: any = null;
      if (responseText.trim()) {
        try {
          responseBody = JSON.parse(responseText);
        } catch {
          // The legacy endpoint commonly returns an empty or non-JSON body.
        }
      }
      await ctx.runMutation(internal.devin.resumeAfterReply, {
        id: session._id,
        status:
          apiVersion === "v3" && typeof responseBody?.status === "string"
            ? responseBody.status
            : apiVersion === "v3"
              ? "resuming"
              : "resume_requested",
        acus:
          apiVersion === "v3" && typeof responseBody?.acus_consumed === "number"
            ? responseBody.acus_consumed
            : undefined,
        url:
          apiVersion === "v3" && typeof responseBody?.url === "string"
            ? responseBody.url
            : undefined,
      });
      await ctx.runMutation(internal.builds.logEvent, {
        buildId: session.buildId,
        kind: "compile",
        message: "Devin correction pass started",
      });
    } catch (error) {
      await ctx.runMutation(internal.builds.compileRepairFailed, {
        buildId: session.buildId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  },
});
