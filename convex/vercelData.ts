import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { appConnectors, hasAppConnector, normalizeConnectors } from "./lib/connectors";
import { requireOperator } from "./lib/operator";

async function queueVersion(
  ctx: MutationCtx,
  versionId: Id<"appVersions">,
  forceEnable: boolean
): Promise<Id<"deployments"> | null> {
  const version = await ctx.db.get(versionId);
  if (!version?.bundle) throw new Error("Version is not compiled");
  const app = await ctx.db.get(version.appId);
  if (!app) throw new Error("Unknown app");

  if (!hasAppConnector(version, "vercel")) {
    if (!forceEnable) return null;
    const connectors = normalizeConnectors([...appConnectors(version), "vercel"]);
    await ctx.db.patch(version._id, { connectors });
    await ctx.db.patch(app._id, { connectors });
    if (version.buildId) await ctx.db.patch(version.buildId, { connectors });
  }

  const existing = await ctx.db
    .query("deployments")
    .withIndex("by_version_provider", (q) =>
      q.eq("versionId", versionId).eq("provider", "vercel")
    )
    .first();
  if (existing) {
    if (existing.status === "error") {
      await ctx.db.patch(existing._id, {
        status: "queued",
        error: undefined,
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.vercel.deploy, { deploymentId: existing._id });
    }
    return existing._id;
  }

  const now = Date.now();
  const deploymentId = await ctx.db.insert("deployments", {
    buildId: version.buildId,
    appId: app._id,
    versionId: version._id,
    provider: "vercel",
    status: "queued",
    createdAt: now,
    updatedAt: now,
  });
  if (version.buildId) {
    await ctx.db.patch(version.buildId, { deploymentStatus: "queued" });
    await ctx.db.insert("buildEvents", {
      buildId: version.buildId,
      ts: now,
      kind: "deploy",
      message: "Vercel deployment queued",
    });
  }
  await ctx.scheduler.runAfter(0, internal.vercel.deploy, { deploymentId });
  return deploymentId;
}

/** Scheduled as an exactly-once mutation after compilation. */
export const queueForVersion = internalMutation({
  args: { versionId: v.id("appVersions") },
  returns: v.union(v.id("deployments"), v.null()),
  handler: async (ctx, args) => queueVersion(ctx, args.versionId, false),
});

export const queueForOperator = internalMutation({
  args: { versionId: v.id("appVersions") },
  returns: v.union(v.id("deployments"), v.null()),
  handler: async (ctx, args) => queueVersion(ctx, args.versionId, true),
});

/** Operator retry/backfill path; useful for versions created before Vercel support. */
export const deployCurrent = mutation({
  args: { slug: v.string(), operatorKey: v.string() },
  returns: v.object({ deploymentId: v.id("deployments") }),
  handler: async (ctx, args) => {
    requireOperator(args.operatorKey);
    const app = await ctx.db
      .query("apps")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!app?.currentVersionId) throw new Error("App has no compiled live version");
    const deploymentId = await queueVersion(ctx, app.currentVersionId, true);
    if (!deploymentId) throw new Error("Could not queue deployment");

    // An explicit operator deploy is also the maintenance path for refreshing
    // the static host/runtime without creating a new generated app version.
    // Automatic compilation remains idempotent in queueForVersion above.
    const deployment = await ctx.db.get(deploymentId);
    if (deployment?.status === "ready") {
      const now = Date.now();
      await ctx.db.patch(deployment._id, {
        status: "queued",
        error: undefined,
        updatedAt: now,
      });
      if (deployment.buildId) {
        await ctx.db.patch(deployment.buildId, { deploymentStatus: "queued" });
        await ctx.db.insert("buildEvents", {
          buildId: deployment.buildId,
          ts: now,
          kind: "deploy",
          message: "Vercel redeployment queued",
        });
      }
      await ctx.scheduler.runAfter(0, internal.vercel.deploy, { deploymentId });
    }
    return { deploymentId };
  },
});

export const claim = internalMutation({
  args: { deploymentId: v.id("deployments") },
  returns: v.union(
    v.object({
      lease: v.number(),
      previousDeploymentId: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deploymentId);
    if (!row || row.status !== "queued") return null;
    const now = Date.now();
    const previousDeploymentId = row.deploymentId;
    await ctx.db.patch(row._id, {
      status: "deploying",
      deploymentId: undefined,
      url: undefined,
      updatedAt: now,
    });
    if (row.buildId) await ctx.db.patch(row.buildId, { deploymentStatus: "deploying" });
    return {
      lease: now,
      ...(typeof previousDeploymentId === "string" ? { previousDeploymentId } : {}),
    };
  },
});

/**
 * Extends an unidentified deployment's lease immediately before a remote-side
 * effect. A worker whose lease was requeued cannot create a second deployment.
 */
export const renewClaim = internalMutation({
  args: { deploymentId: v.id("deployments"), lease: v.number() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deploymentId);
    if (
      !row ||
      row.status !== "deploying" ||
      row.deploymentId !== undefined ||
      row.updatedAt !== args.lease
    ) {
      return null;
    }
    const lease = Math.max(Date.now(), row.updatedAt + 1);
    await ctx.db.patch(row._id, { updatedAt: lease });
    return lease;
  },
});

export const getPayload = internalQuery({
  args: { deploymentId: v.id("deployments") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const deployment = await ctx.db.get(args.deploymentId);
    if (!deployment) return null;
    const app = await ctx.db.get(deployment.appId);
    const version = await ctx.db.get(deployment.versionId);
    if (!app || !version) return null;
    return { deployment, app, version };
  },
});

export const getReconcileTarget = internalQuery({
  args: { slug: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const app = await ctx.db
      .query("apps")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!app?.currentVersionId) return null;
    const version = await ctx.db.get(app.currentVersionId);
    if (!version?.bundle) return null;
    const deployment = await ctx.db
      .query("deployments")
      .withIndex("by_version_provider", (q) =>
        q.eq("versionId", version._id).eq("provider", "vercel")
      )
      .first();
    return { app, version, deployment };
  },
});

export const pending = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const queued = await ctx.db
      .query("deployments")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .take(20);
    const deploying = await ctx.db
      .query("deployments")
      .withIndex("by_status", (q) => q.eq("status", "deploying"))
      .take(20);
    return [...queued, ...deploying];
  },
});

export const recordProject = internalMutation({
  args: { deploymentId: v.id("deployments"), projectId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deploymentId);
    if (!row || row.status === "ready") return null;
    await ctx.db.patch(row._id, { projectId: args.projectId });
    return null;
  },
});

export const recordCreated = internalMutation({
  args: {
    deploymentId: v.id("deployments"),
    vercelDeploymentId: v.string(),
    projectId: v.string(),
    url: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deploymentId);
    if (!row || row.status === "ready") return null;
    await ctx.db.patch(row._id, {
      deploymentId: args.vercelDeploymentId,
      projectId: args.projectId,
      url: args.url,
      status: "deploying",
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Reclaims an action lease only after the caller has reconciled Vercel by
 * project/version metadata and found no remote deployment. The mutation
 * rechecks the lease atomically so a healthy action cannot be requeued.
 */
export const requeueExpiredClaim = internalMutation({
  args: { deploymentId: v.id("deployments"), cutoff: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deploymentId);
    if (
      !row ||
      row.status !== "deploying" ||
      row.deploymentId !== undefined ||
      row.updatedAt > args.cutoff
    ) {
      return false;
    }
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "queued",
      error: undefined,
      updatedAt: now,
    });
    if (row.buildId) await ctx.db.patch(row.buildId, { deploymentStatus: "queued" });
    await ctx.scheduler.runAfter(0, internal.vercel.deploy, { deploymentId: row._id });
    return true;
  },
});

/** Operator-only caller has already reconciled the remote project. */
export const requeueUnidentified = internalMutation({
  args: { deploymentId: v.id("deployments") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deploymentId);
    if (!row || row.status === "ready" || row.deploymentId !== undefined) return false;
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "queued",
      error: undefined,
      updatedAt: now,
    });
    if (row.buildId) await ctx.db.patch(row.buildId, { deploymentStatus: "queued" });
    await ctx.scheduler.runAfter(0, internal.vercel.deploy, { deploymentId: row._id });
    return true;
  },
});

export const complete = internalMutation({
  args: { deploymentId: v.id("deployments"), url: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deploymentId);
    if (!row) return null;
    const changed = row.status !== "ready" || row.url !== args.url;
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "ready",
      url: args.url,
      error: undefined,
      updatedAt: now,
    });
    const app = await ctx.db.get(row.appId);
    if (app?.currentVersionId === row.versionId) {
      await ctx.db.patch(app._id, { productionUrl: args.url });
    }
    if (row.buildId) {
      await ctx.db.patch(row.buildId, {
        deploymentStatus: "ready",
        productionUrl: args.url,
      });
      if (changed) {
        await ctx.db.insert("buildEvents", {
          buildId: row.buildId,
          ts: now,
          kind: "deploy",
          message: `deployed to Vercel at ${args.url}`,
        });
      }
    }
    return null;
  },
});

export const fail = internalMutation({
  args: { deploymentId: v.id("deployments"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deploymentId);
    if (!row || row.status === "ready") return null;
    const message = args.error.slice(0, 300);
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "error", error: message, updatedAt: now });
    if (row.buildId) {
      await ctx.db.patch(row.buildId, { deploymentStatus: "error" });
      await ctx.db.insert("buildEvents", {
        buildId: row.buildId,
        ts: now,
        kind: "error",
        message: `Vercel deployment failed: ${message}`,
      });
    }
    return null;
  },
});
