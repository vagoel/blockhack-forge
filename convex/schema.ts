import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  apps: defineTable({
    slug: v.string(),
    name: v.string(),
    prompt: v.string(),
    status: v.string(), // "generating" | "awaiting_compile" | "live" | "error"
    spec: v.any(),
    theme: v.optional(v.any()),
    currentVersionId: v.optional(v.id("appVersions")),
    connectors: v.optional(
      v.array(
        v.union(
          v.literal("convex"),
          v.literal("context"),
          v.literal("openai"),
          v.literal("vercel")
        )
      )
    ),
    productionUrl: v.optional(v.string()),
    hiddenAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  appVersions: defineTable({
    appId: v.id("apps"),
    buildId: v.optional(v.id("builds")),
    // A Devin session can produce multiple versions through follow-up chat.
    // This pair makes each conversation turn idempotent without collapsing
    // later revisions into the first build output.
    devinSessionDocId: v.optional(v.id("devinSessions")),
    devinGeneration: v.optional(v.number()),
    version: v.number(),
    tsxSource: v.string(),
    specJson: v.any(),
    bundle: v.optional(v.string()),
    status: v.string(), // "awaiting_compile" | "live" | "error"
    connectors: v.optional(
      v.array(
        v.union(
          v.literal("convex"),
          v.literal("context"),
          v.literal("openai"),
          v.literal("vercel")
        )
      )
    ),
    createdAt: v.number(),
  })
    .index("by_app", ["appId", "version"])
    .index("by_build", ["buildId"])
    .index("by_devin_generation", ["devinSessionDocId", "devinGeneration"])
    .index("by_status", ["status"]),

  documents: defineTable({
    appId: v.id("apps"),
    collection: v.string(),
    key: v.string(),
    data: v.any(),
    updatedBy: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_app_collection_key", ["appId", "collection", "key"]),

  items: defineTable({
    appId: v.id("apps"),
    collection: v.string(),
    data: v.any(),
    sessionId: v.string(),
    ts: v.number(),
  }).index("by_app_collection", ["appId", "collection"]),

  scores: defineTable({
    appId: v.id("apps"),
    sessionId: v.string(),
    name: v.string(),
    points: v.number(),
  })
    .index("by_app_session", ["appId", "sessionId"])
    .index("by_app_points", ["appId", "points"]),

  builds: defineTable({
    prompt: v.string(),
    styleUrl: v.optional(v.string()),
    devinMode: v.optional(
      v.union(
        v.literal("default"),
        v.literal("normal"),
        v.literal("fast"),
        v.literal("lite"),
        v.literal("ultra"),
        v.literal("fusion")
      )
    ),
    status: v.string(), // "queued" | "grounding" | "generating" | "awaiting_compile" | "live" | "error"
    appId: v.optional(v.id("apps")),
    appSlug: v.optional(v.string()),
    error: v.optional(v.string()),
    retried: v.optional(v.boolean()),
    compileRepairAttempts: v.optional(v.number()),
    connectors: v.optional(
      v.array(
        v.union(
          v.literal("convex"),
          v.literal("context"),
          v.literal("openai"),
          v.literal("vercel")
        )
      )
    ),
    deploymentStatus: v.optional(v.string()),
    productionUrl: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_status", ["status"]),

  deployments: defineTable({
    buildId: v.optional(v.id("builds")),
    appId: v.id("apps"),
    versionId: v.id("appVersions"),
    provider: v.literal("vercel"),
    status: v.string(), // "queued" | "deploying" | "ready" | "error"
    deploymentId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    url: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_version_provider", ["versionId", "provider"])
    .index("by_app", ["appId", "createdAt"])
    .index("by_status", ["status"]),

  buildEvents: defineTable({
    buildId: v.id("builds"),
    ts: v.number(),
    kind: v.string(), // pipeline kinds plus "devin-user" and "devin-message" chat turns
    message: v.string(),
  }).index("by_build", ["buildId", "ts"]),

  devinSessions: defineTable({
    buildId: v.id("builds"),
    devinSessionId: v.string(),
    // Optional for backwards compatibility with sessions created before the
    // v3 adapter. New sessions always persist the selected API version.
    apiVersion: v.optional(v.union(v.literal("v1"), v.literal("v3"))),
    devinMode: v.optional(
      v.union(
        v.literal("default"),
        v.literal("normal"),
        v.literal("fast"),
        v.literal("lite"),
        v.literal("ultra"),
        v.literal("fusion")
      )
    ),
    resolvedDevinMode: v.optional(
      v.union(
        v.literal("normal"),
        v.literal("fast"),
        v.literal("lite"),
        v.literal("ultra"),
        v.literal("fusion")
      )
    ),
    orgId: v.optional(v.string()),
    url: v.optional(v.string()),
    status: v.string(), // v1 status_enum or v3 top-level status
    statusDetail: v.optional(v.string()), // v3 status_detail
    acus: v.optional(v.number()),
    prUrl: v.optional(v.string()),
    structuredOutput: v.optional(v.any()),
    generation: v.optional(v.number()),
    awaitingResume: v.optional(v.boolean()),
    lastOutputFingerprint: v.optional(v.string()),
    terminal: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_terminal", ["terminal"])
    .index("by_build", ["buildId"]),

  datasets: defineTable({
    appId: v.optional(v.id("apps")),
    buildId: v.optional(v.id("builds")),
    name: v.string(),
    rows: v.array(v.any()),
    sourceUrl: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_app", ["appId"]),

  contextCache: defineTable({
    cacheKey: v.string(), // `${kind}:${url}`
    value: v.any(),
    createdAt: v.number(),
  }).index("by_key", ["cacheKey"]),

  telemetry: defineTable({
    appId: v.id("apps"),
    versionId: v.optional(v.id("appVersions")),
    sessionId: v.string(),
    message: v.string(),
    ts: v.number(),
  }).index("by_app", ["appId", "ts"]),

  settings: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),
});
