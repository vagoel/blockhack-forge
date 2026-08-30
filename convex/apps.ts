import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { appSpecSchema, slugify, themeSchema } from "./lib/appSpec";
import { requireOperator } from "./lib/operator";
import { appConnectors, connectorsValidator } from "./lib/connectors";

const MAX_TSX_SOURCE_LENGTH = 120_000;

export const getBySlug = query({
  args: { slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      app: v.object({
        _id: v.id("apps"),
        slug: v.string(),
        name: v.string(),
        status: v.string(),
        theme: v.any(),
        spec: v.any(),
        connectors: connectorsValidator,
        productionUrl: v.optional(v.string()),
      }),
      version: v.union(
        v.null(),
        v.object({
          _id: v.id("appVersions"),
          version: v.number(),
          bundle: v.optional(v.string()),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    const app = await ctx.db
      .query("apps")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!app) return null;
    let version: { _id: Id<"appVersions">; version: number; bundle?: string } | null = null;
    if (app.currentVersionId) {
      const ver = await ctx.db.get(app.currentVersionId);
      if (ver) version = { _id: ver._id, version: ver.version, bundle: ver.bundle };
    }
    return {
      app: {
        _id: app._id,
        slug: app.slug,
        name: app.name,
        status: app.status,
        theme: app.theme ?? null,
        spec: app.spec ?? null,
        connectors: [...appConnectors(app)],
        productionUrl: app.productionUrl,
      },
      version,
    };
  },
});

/** Internal full row lookup for connector authorization in actions. */
export const getInternalBySlug = internalQuery({
  args: { slug: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("apps")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
  },
});

export const list = query({
  args: { operatorKey: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("apps"),
      slug: v.string(),
      name: v.string(),
      status: v.string(),
      createdAt: v.number(),
      prompt: v.string(),
      connectors: connectorsValidator,
      productionUrl: v.optional(v.string()),
      buildId: v.optional(v.id("builds")),
    })
  ),
  handler: async (ctx, args) => {
    requireOperator(args.operatorKey);
    const apps = (await ctx.db.query("apps").order("desc").take(100))
      .filter((app) => app.hiddenAt === undefined)
      .slice(0, 50);
    const builds = await ctx.db.query("builds").order("desc").take(200);
    const buildIdByApp = new Map<string, Id<"builds">>();
    for (const build of builds) {
      if (build.appId && !buildIdByApp.has(build.appId)) {
        buildIdByApp.set(build.appId, build._id);
      }
    }
    return apps.map((a) => ({
      _id: a._id,
      slug: a.slug,
      name: a.name,
      status: a.status,
      createdAt: a.createdAt,
      prompt: a.prompt,
      connectors: [...appConnectors(a)],
      productionUrl: a.productionUrl,
      buildId: buildIdByApp.get(a._id),
    }));
  },
});

export const getStage = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "stage"))
      .first();
    return row && typeof row.value === "string" ? row.value : null;
  },
});

export const setStage = mutation({
  args: { slug: v.string(), operatorKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireOperator(args.operatorKey);
    const app = await ctx.db
      .query("apps")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!app) throw new Error(`No app with slug "${args.slug}"`);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "stage"))
      .first();
    if (row) {
      await ctx.db.patch(row._id, { value: args.slug });
    } else {
      await ctx.db.insert("settings", { key: "stage", value: args.slug });
    }
    return null;
  },
});

export const setTheme = mutation({
  args: { slug: v.string(), theme: v.any(), operatorKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireOperator(args.operatorKey);
    const app = await ctx.db
      .query("apps")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!app) throw new Error(`No app with slug "${args.slug}"`);
    const prev =
      app.theme && typeof app.theme === "object" && !Array.isArray(app.theme) ? app.theme : {};
    const parsed = themeSchema.safeParse(args.theme);
    if (!parsed.success) throw new Error("Invalid theme");
    const next = parsed.data;
    await ctx.db.patch(app._id, { theme: { ...prev, ...next } });
    return null;
  },
});

/** Removes an app from the Projects gallery without deleting its deployment or build data. */
export const removeFromProjects = mutation({
  args: { slug: v.string(), operatorKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireOperator(args.operatorKey);
    const app = await ctx.db
      .query("apps")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (app) await ctx.db.patch(app._id, { hiddenAt: Date.now() });
    return null;
  },
});

// Creates the app row for a finished build; ensures a unique slug.
export const createForBuild = internalMutation({
  args: {
    buildId: v.id("builds"),
    name: v.string(),
    spec: v.any(),
    theme: v.optional(v.any()),
    prompt: v.string(),
  },
  returns: v.object({ appId: v.id("apps"), slug: v.string() }),
  handler: async (ctx, args) => {
    const build = await ctx.db.get(args.buildId);
    if (!build) throw new Error("Unknown build");
    const base = slugify(args.name);
    let slug = base;
    for (let i = 2; i <= 50; i++) {
      const hit = await ctx.db
        .query("apps")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (!hit) break;
      slug = i === 50 ? `${base}-${Date.now().toString(36)}` : `${base}-${i}`;
    }
    const appId = await ctx.db.insert("apps", {
      slug,
      name: args.name,
      prompt: args.prompt,
      status: "awaiting_compile",
      spec: args.spec,
      theme: args.theme,
      connectors: [...appConnectors(build)],
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.buildId, { appId, appSlug: slug });
    return { appId, slug };
  },
});

export const updateForBuild = internalMutation({
  args: {
    appId: v.id("apps"),
    name: v.string(),
    spec: v.any(),
    theme: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const app = await ctx.db.get(args.appId);
    if (!app) throw new Error("Unknown app");
    const spec = appSpecSchema.parse(args.spec);
    await ctx.db.patch(args.appId, {
      name: args.name.trim().slice(0, 80) || spec.name,
      spec,
      theme: args.theme ?? app.theme,
    });
    return null;
  },
});

export const publishVersion = internalMutation({
  args: {
    appId: v.id("apps"),
    tsxSource: v.string(),
    specJson: v.any(),
    bundle: v.optional(v.string()),
    buildId: v.optional(v.id("builds")),
    devinSessionDocId: v.optional(v.id("devinSessions")),
    devinGeneration: v.optional(v.number()),
  },
  returns: v.object({
    versionId: v.id("appVersions"),
    created: v.boolean(),
    status: v.string(),
  }),
  handler: async (ctx, args) => {
    if (!args.tsxSource.trim() || args.tsxSource.length > MAX_TSX_SOURCE_LENGTH) {
      throw new Error("Generated TSX is empty or too large");
    }
    if (args.devinSessionDocId !== undefined && args.devinGeneration !== undefined) {
      const existing = await ctx.db
        .query("appVersions")
        .withIndex("by_devin_generation", (q) =>
          q
            .eq("devinSessionDocId", args.devinSessionDocId)
            .eq("devinGeneration", args.devinGeneration),
        )
        .first();
      if (existing) return { versionId: existing._id, created: false, status: existing.status };

      // A conversational answer may contain no source change. Reuse the exact
      // source in that case; only a genuinely changed app becomes a version.
      if (args.buildId) {
        const buildVersions = await ctx.db
          .query("appVersions")
          .withIndex("by_build", (q) => q.eq("buildId", args.buildId))
          .collect();
        const sameSource = buildVersions.find((version) => version.tsxSource === args.tsxSource);
        if (sameSource) {
          return {
            versionId: sameSource._id,
            created: false,
            status: sameSource.status,
          };
        }
      }
    } else if (args.buildId) {
      // Legacy/non-Devin callers remain idempotent by exact source rather than
      // incorrectly collapsing all revisions for a build into one version.
      const existingVersions = await ctx.db
        .query("appVersions")
        .withIndex("by_build", (q) => q.eq("buildId", args.buildId))
        .collect();
      const existing = existingVersions.find((version) => version.tsxSource === args.tsxSource);
      if (existing) return { versionId: existing._id, created: false, status: existing.status };
    }
    const app = await ctx.db.get(args.appId);
    if (!app) throw new Error("Unknown app");
    const latest = await ctx.db
      .query("appVersions")
      .withIndex("by_app", (q) => q.eq("appId", args.appId))
      .order("desc")
      .first();
    const version = (latest?.version ?? 0) + 1;
    const status = args.bundle ? "live" : "awaiting_compile";
    const versionId = await ctx.db.insert("appVersions", {
      appId: args.appId,
      buildId: args.buildId,
      devinSessionDocId: args.devinSessionDocId,
      devinGeneration: args.devinGeneration,
      version,
      tsxSource: args.tsxSource,
      specJson: args.specJson,
      bundle: args.bundle,
      status,
      connectors: [...appConnectors(app)],
      createdAt: Date.now(),
    });
    const patch: Record<string, unknown> = {
      spec: args.specJson,
      // Keep a currently published app available while its next conversational
      // revision is compiling.
      status: app.currentVersionId && !args.bundle ? "live" : status,
    };
    if (args.bundle) patch.currentVersionId = versionId;
    const specTheme =
      args.specJson && typeof args.specJson === "object" ? args.specJson.theme : undefined;
    if (!app.theme && specTheme) patch.theme = specTheme;
    await ctx.db.patch(args.appId, patch);
    // Link any datasets captured during this build to the app.
    if (args.buildId) {
      const datasets = await ctx.db
        .query("datasets")
        .filter((q) => q.eq(q.field("buildId"), args.buildId))
        .collect();
      for (const d of datasets) {
        if (!d.appId) await ctx.db.patch(d._id, { appId: args.appId });
      }
    }
    return { versionId, created: true, status };
  },
});
