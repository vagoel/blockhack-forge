"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { composeDevinPrompt } from "./lib/skillMatch";
import { appSpecSchema } from "./lib/appSpec";
import { appConnectors } from "./lib/connectors";
import { sourceFingerprint } from "./lib/sourceFingerprint";
import { devinSessionVisibilityFields } from "./lib/devinSession";
import { resolveContextSourceUrl } from "./lib/contextSource";
import {
  devinModeLabel,
  devinModeRequestFields,
  isProviderDevinMode,
  normalizeDevinMode,
  type DevinMode,
} from "./lib/devinMode";

// Convex runtimes expose process.env; @types/node is not part of this tsconfig.
declare const process: { env: Record<string, string | undefined> };

const DEVIN_ORIGIN = "https://api.devin.ai";
const DEFAULT_MAX_ACU_LIMIT = 2;
const HARD_MAX_ACU_LIMIT = 3;
const MAX_GENERATED_TSX_LENGTH = 120_000;

type DevinApiVersion = "v1" | "v3";

type DevinConfig =
  | { apiVersion: "v1"; key: string }
  | { apiVersion: "v3"; key: string; orgId: string };

// Structured output contract (CONTRACT.md §3), JSON Schema draft-7.
const SCHEMA = {
  type: "object",
  required: ["status", "appName", "appSpec", "appTsx"],
  properties: {
    status: { type: "string", enum: ["success", "failed"] },
    appName: { type: "string" },
    appSpec: { type: "object" },
    appTsx: { type: "string" },
    notes: { type: "string" },
  },
} as const;

const EXTRACT_SCHEMA = {
  type: "object",
  properties: { items: { type: "array", items: { type: "object" } } },
} as const;

const DATA_WORDS_RE = /\b(items?|products?|data|list|listing|catalog|inventory|menu|rows|entries)\b/i;
const DOCS_WORDS_RE =
  /\b(docs?|documentation|api docs?|sdk docs?|reference guide|according to|based on)\b/i;
const RESEARCH_WORDS_RE =
  /\b(research|researcher|sources?|facts?|information|open data|knowledge|evidence|directory|lookup|findings?)\b/i;

function readDevinConfig(): DevinConfig {
  const key = process.env.DEVIN?.trim();
  if (!key) throw new Error("DEVIN env var is not set");
  if (key.startsWith("cog_")) {
    const orgId = process.env.DEVIN_ORG_ID?.trim();
    if (!orgId) throw new Error("DEVIN_ORG_ID is required for a cog_ Devin v3 token");
    if (!orgId.startsWith("org-")) throw new Error("DEVIN_ORG_ID must start with org-");
    return { apiVersion: "v3", key, orgId };
  }
  if (key.startsWith("apk_")) return { apiVersion: "v1", key };
  throw new Error("DEVIN must be an apk_ legacy key or cog_ service-user token");
}

function devinKeyFor(apiVersion: DevinApiVersion): string {
  const key = process.env.DEVIN?.trim();
  if (!key) throw new Error("DEVIN env var is not set");
  if (apiVersion === "v3" && !key.startsWith("cog_")) {
    throw new Error("Stored Devin v3 session requires a cog_ service-user token");
  }
  if (apiVersion === "v1" && !key.startsWith("apk_")) {
    throw new Error("Stored Devin v1 session requires an apk_ legacy API key");
  }
  return key;
}

function devinHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function maxAcuLimit(): number {
  const configured = process.env.DEVIN_MAX_ACU_LIMIT?.trim();
  if (!configured) return DEFAULT_MAX_ACU_LIMIT;
  const parsed = Number(configured);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_ACU_LIMIT;
  return Math.min(HARD_MAX_ACU_LIMIT, Math.max(1, Math.trunc(parsed)));
}

function maxAutomaticRetries(): number {
  const parsed = Number(process.env.DEVIN_MAX_RETRIES ?? "0");
  return Number.isFinite(parsed) && parsed >= 1 ? 1 : 0;
}

function sessionApiVersion(session: { apiVersion?: DevinApiVersion }): DevinApiVersion {
  // Rows created before this adapter were all v1 sessions.
  return session.apiVersion ?? "v1";
}

function sessionUrl(session: PendingSession): string {
  const id = encodeURIComponent(session.devinSessionId);
  if (sessionApiVersion(session) === "v3") {
    if (!session.orgId) throw new Error("Stored Devin v3 session is missing orgId");
    return `${DEVIN_ORIGIN}/v3/organizations/${encodeURIComponent(session.orgId)}/sessions/${id}`;
  }
  return `${DEVIN_ORIGIN}/v1/sessions/${id}`;
}

function firstNumber(...candidates: unknown[]): number | undefined {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
  }
  return undefined;
}

function lastMessage(body: any): string | null {
  const messages = Array.isArray(body?.messages) ? body.messages : body?.items;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const last = messages[messages.length - 1];
  const text = last?.message ?? last?.content ?? last?.text;
  return typeof text === "string" && text.trim() ? text : null;
}

export const start = internalAction({
  args: { buildId: v.id("builds") },
  returns: v.null(),
  handler: async (ctx, { buildId }) => {
    const claimed = await ctx.runMutation(internal.devin.claimStart, { buildId });
    if (!claimed) return null;

    const build = await ctx.runQuery(internal.builds.getBuild, { buildId });
    if (!build) return null;
    const log = (kind: string, message: string) =>
      ctx.runMutation(internal.builds.logEvent, { buildId, kind, message });
    try {
      const config = readDevinConfig();
      const acuLimit = maxAcuLimit();
      // Before model selection existed, v3 sessions were always created in Fast.
      // Keep that behavior for an already-queued legacy row while new requests
      // explicitly persist the "default" sentinel.
      const devinMode: DevinMode =
        build.devinMode === undefined && config.apiVersion === "v3"
          ? "fast"
          : normalizeDevinMode(build.devinMode);
      if (devinMode !== "default" && config.apiVersion !== "v3") {
        throw new Error(
          `${devinModeLabel(devinMode)} requires API v3; update the configured Devin credential`,
        );
      }
      const connectors = [...appConnectors(build)];
      const contextEnabled = connectors.includes("context");
      let contextUrl: string | null = contextEnabled
        ? resolveContextSourceUrl(build.prompt, build.styleUrl)
        : null;
      const needsContextDiscovery = contextEnabled && !contextUrl;
      const needsResearchGrounding =
        contextEnabled &&
        (DATA_WORDS_RE.test(build.prompt) ||
          DOCS_WORDS_RE.test(build.prompt) ||
          RESEARCH_WORDS_RE.test(build.prompt));
      const shouldCrawlContext = needsContextDiscovery || needsResearchGrounding;
      let theme: unknown | null = null;
      let rows: unknown[] | null = null;
      let dataUrl: string | null = null;
      let docsGrounding: string | null = null;
      let styleGrounding: string | null = null;

      if (contextEnabled) {
        await ctx.runMutation(internal.builds.patch, { buildId, status: "grounding" });
      }

      if (needsContextDiscovery) {
        const discovered = await ctx.runAction(internal.contextdev.discover, {
          query: build.prompt,
        });
        if (!discovered?.url || !discovered?.grounding) {
          throw new Error(
            "Context.dev could not discover an authoritative research source. Add a reference URL or retry the build.",
          );
        }
        contextUrl = discovered.url;
        docsGrounding = discovered.grounding;
        await ctx.runMutation(internal.builds.patch, { buildId, styleUrl: contextUrl });
        await log("context", `authoritative research source discovered: ${contextUrl}`);
      }

      if (contextUrl) {
        const [themeResult, sourceResult] = await Promise.all([
          ctx.runAction(internal.contextdev.styleguide, { url: contextUrl }).catch(() => null),
          ctx.runAction(internal.contextdev.sourceStyle, { url: contextUrl }).catch(() => null),
        ]);
        theme = themeResult;
        styleGrounding = typeof sourceResult === "string" ? sourceResult : null;
        await log(
          "context",
          theme
            ? `brand styleguide extracted from ${contextUrl}`
            : `styleguide unavailable for ${contextUrl} (skipped)`
        );
        await log(
          "context",
          styleGrounding
            ? `rendered source style extracted from ${contextUrl}`
            : `rendered source unavailable for ${contextUrl} (skipped)`
        );
      }

      if (shouldCrawlContext && contextUrl) {
        const crawled = await ctx.runAction(internal.contextdev.crawl, { url: contextUrl });
        if (crawled) {
          docsGrounding = [docsGrounding, crawled].filter(Boolean).join("\n\n=== VERIFIED SOURCE CRAWL ===\n");
          await log("context", `research source crawled and grounded: ${contextUrl}`);
        } else if (!docsGrounding) {
          throw new Error(
            `Context.dev could not ground the research source ${contextUrl}. Try another source URL.`,
          );
        } else {
          await log("context", `source crawl unavailable for ${contextUrl}; using verified search content`);
        }
      }

      const fromMatch = contextEnabled ? build.prompt.match(/from (https?:\/\/\S+)/i) : null;
      dataUrl =
        fromMatch?.[1] ?? (contextUrl && DATA_WORDS_RE.test(build.prompt) ? contextUrl : null);
      if (dataUrl) {
        let extracted: unknown = null;
        try {
          extracted = await ctx.runAction(internal.contextdev.extract, {
            url: dataUrl,
            schema: EXTRACT_SCHEMA,
          });
        } catch {
          extracted = null;
        }
        if (Array.isArray(extracted) && extracted.length > 0) {
          rows = extracted.slice(0, 200);
          await ctx.runMutation(internal.builds.saveDataset, {
            buildId,
            name: "data",
            rows,
            sourceUrl: dataUrl,
          });
          await log("context", `extracted ${rows.length} rows from ${dataUrl}`);
        } else {
          await log("context", `data extraction unavailable for ${dataUrl} (skipped)`);
        }
      }

      if (
        contextEnabled &&
        !theme &&
        !styleGrounding &&
        !docsGrounding &&
        (!rows || rows.length === 0)
      ) {
        throw new Error(
          "Context.dev returned no usable grounding. The builder stopped instead of publishing an ungrounded app; retry or provide a different source URL.",
        );
      }

      const playbookId = process.env.DEVIN_PLAYBOOK_ID || null;
      const prompt = composeDevinPrompt({
        userPrompt: build.prompt,
        brandTheme: theme,
        datasetSample: rows ? rows.slice(0, 5) : null,
        datasetName: rows ? "data" : null,
        docsGrounding,
        styleGrounding,
        connectors,
        // v3's documented create contract has no playbook_id field, so carry
        // the master prompt inline there. Legacy v1 may use the synced playbook.
        inlineSystem: config.apiVersion === "v3" || !playbookId,
      });

      const createUrl =
        config.apiVersion === "v3"
          ? `${DEVIN_ORIGIN}/v3/organizations/${encodeURIComponent(config.orgId)}/sessions`
          : `${DEVIN_ORIGIN}/v1/sessions`;
      const commonBody = {
        prompt,
        title: "app: " + build.prompt.slice(0, 60),
        max_acu_limit: acuLimit,
        structured_output_schema: SCHEMA,
        ...(config.apiVersion === "v1" && playbookId ? { playbook_id: playbookId } : {}),
      };
      const requestBody =
        config.apiVersion === "v3"
          ? {
              ...commonBody,
              ...devinModeRequestFields(config.apiVersion, devinMode),
              structured_output_required: true,
            }
          : {
              ...commonBody,
              ...devinModeRequestFields(config.apiVersion, devinMode),
              ...devinSessionVisibilityFields(config.apiVersion),
              idempotent: true,
            };

      const res = await fetch(createUrl, {
        method: "POST",
        headers: devinHeaders(config.key),
        body: JSON.stringify(requestBody),
      });
      if (!res.ok) {
        const text = (await res.text()).slice(0, 200);
        throw new Error(`Devin ${config.apiVersion} session create failed: ${res.status} ${text}`);
      }
      const body: any = await res.json();
      const sessionId = body?.session_id ?? body?.sessionId ?? body?.id;
      if (!sessionId) throw new Error("Devin response missing session_id");
      await ctx.runMutation(internal.devin.createSession, {
        buildId,
        devinSessionId: String(sessionId),
        apiVersion: config.apiVersion,
        devinMode,
        resolvedDevinMode:
          config.apiVersion === "v3" && isProviderDevinMode(body?.devin_mode)
            ? body.devin_mode
            : devinMode === "default"
              ? undefined
              : devinMode,
        orgId: config.apiVersion === "v3" ? config.orgId : undefined,
        status: typeof body?.status === "string" ? body.status : undefined,
        statusDetail: typeof body?.status_detail === "string" ? body.status_detail : undefined,
        acus:
          config.apiVersion === "v3" ? firstNumber(body?.acus_consumed) : undefined,
        url: typeof body?.url === "string" ? body.url : undefined,
      });
      await ctx.runMutation(internal.builds.patch, { buildId, status: "generating" });
      await log(
        "devin",
        `session created via ${config.apiVersion} with ${devinModeLabel(devinMode)} (${acuLimit} ACU cap)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.builds.patch, { buildId, status: "error", error: message });
      await log("error", message);
    }
    return null;
  },
});

type PendingSession = {
  _id: Id<"devinSessions">;
  buildId: Id<"builds">;
  devinSessionId: string;
  apiVersion?: DevinApiVersion;
  orgId?: string;
  status: string;
  statusDetail?: string;
  generation: number;
  awaitingResume: boolean;
  lastOutputFingerprint?: string;
};

export const poll = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const pending = await ctx.runQuery(internal.devin.pending, {});
    if (pending.length === 0) return null;
    for (const session of pending) {
      try {
        const apiVersion = sessionApiVersion(session);
        const headers = devinHeaders(devinKeyFor(apiVersion));
        const res = await fetch(sessionUrl(session), { headers });
        if (!res.ok) continue;
        const body: any = await res.json();
        await handleSession(ctx, session, body);
      } catch {
        // per-session errors are non-fatal; next tick retries
      }
    }
    return null;
  },
});

async function handleSession(ctx: ActionCtx, session: PendingSession, body: any): Promise<void> {
  if (sessionApiVersion(session) === "v3") {
    await handleV3Session(ctx, session, body);
  } else {
    await handleV1Session(ctx, session, body);
  }
}

async function handleV1Session(ctx: ActionCtx, session: PendingSession, body: any): Promise<void> {
  const statusEnum = String(body?.status_enum ?? body?.status ?? "unknown");
  const prUrl = typeof body?.pull_request?.url === "string" ? body.pull_request.url : undefined;
  await ctx.runMutation(internal.devin.upsertFromPoll, {
    id: session._id,
    status: statusEnum,
    prUrl,
    url: typeof body?.url === "string" ? body.url : undefined,
  });

  if (
    session.awaitingResume &&
    (statusEnum === "working" || statusEnum === "resume_requested" || statusEnum === "resumed")
  ) {
    await ctx.runMutation(internal.devin.markResumed, { id: session._id });
  }

  if (statusEnum === "finished") {
    if (awaitingStaleOutput(session, body)) {
      await keepWaitingForResume(ctx, session);
      return;
    }
    await onFinished(ctx, session, body);
  } else if (statusEnum === "blocked") {
    // Devin v1 sessions often deliver the result and then sit "blocked"
    // awaiting further instructions — valid structured output means done.
    if (awaitingStaleOutput(session, body)) {
      await keepWaitingForResume(ctx, session);
    } else if (extractOutput(body)) {
      await onFinished(ctx, session, body);
    } else {
      if (session.awaitingResume) {
        await ctx.runMutation(internal.devin.markResumed, { id: session._id });
      }
      if (session.status !== "blocked" && session.status !== "waiting_for_user") {
        const msg = lastMessage(body) ?? "I need your input before I can continue.";
        await ctx.runMutation(internal.builds.logEvent, {
          buildId: session.buildId,
          kind: "devin-message",
          message: msg.slice(0, 2_000),
        });
      }
      // "Blocked" is Devin's provider state for a conversation turn waiting
      // on the human. Present it as such instead of treating it as a failure.
      await ctx.runMutation(internal.devin.upsertFromPoll, {
        id: session._id,
        status: "waiting_for_user",
        terminal: false,
      });
    }
  } else if (statusEnum === "expired") {
    await failSession(ctx, session, "Devin session expired");
  } else if (statusEnum === "error") {
    await failSession(ctx, session, "Devin session errored");
  }
}

const V3_FAILURE_DETAILS = new Set([
  "usage_limit_exceeded",
  "out_of_credits",
  "out_of_quota",
  "no_quota_allocation",
  "payment_declined",
  "org_usage_limit_exceeded",
  "user_usage_limit_exceeded",
  "total_session_limit_exceeded",
  "error",
]);

async function handleV3Session(ctx: ActionCtx, session: PendingSession, body: any): Promise<void> {
  const status = String(body?.status ?? "unknown");
  const statusDetail =
    typeof body?.status_detail === "string" ? body.status_detail : undefined;
  const acus = firstNumber(body?.acus_consumed);
  const pullRequests = Array.isArray(body?.pull_requests) ? body.pull_requests : [];
  const prUrl =
    typeof pullRequests[0]?.pr_url === "string" ? pullRequests[0].pr_url : undefined;

  await ctx.runMutation(internal.devin.upsertFromPoll, {
    id: session._id,
    status,
    statusDetail,
    acus,
    prUrl,
    url: typeof body?.url === "string" ? body.url : undefined,
  });

  if (
    session.awaitingResume &&
    (status === "resuming" ||
      (status === "running" && statusDetail !== "finished"))
  ) {
    await ctx.runMutation(internal.devin.markResumed, { id: session._id });
  }

  if (statusDetail === "finished") {
    if (awaitingStaleOutput(session, body)) {
      await keepWaitingForResume(ctx, session);
      return;
    }
    await onFinished(ctx, session, body);
    return;
  }

  if (statusDetail === "waiting_for_user") {
    // Keep the v1 blocked-with-output behavior for the equivalent v3 state.
    if (awaitingStaleOutput(session, body)) {
      await keepWaitingForResume(ctx, session);
    } else if (extractOutput(body)) {
      await onFinished(ctx, session, body);
    } else {
      if (session.awaitingResume) {
        await ctx.runMutation(internal.devin.markResumed, { id: session._id });
      }
      if (session.statusDetail !== "waiting_for_user") {
        const msg = lastMessage(body) ?? "I need your input before I can continue.";
        await ctx.runMutation(internal.builds.logEvent, {
          buildId: session.buildId,
          kind: "devin-message",
          message: msg.slice(0, 2_000),
        });
      }
      await ctx.runMutation(internal.devin.upsertFromPoll, {
        id: session._id,
        status: "waiting_for_user",
        statusDetail: "waiting_for_user",
        terminal: false,
      });
    }
    return;
  }

  if (statusDetail === "waiting_for_approval") {
    if (session.statusDetail !== "waiting_for_approval") {
      await ctx.runMutation(internal.builds.logEvent, {
        buildId: session.buildId,
        kind: "devin-message",
        message: "Devin is waiting for an approval",
      });
    }
    await ctx.runMutation(internal.devin.upsertFromPoll, {
      id: session._id,
      status: "waiting_for_approval",
      statusDetail: "waiting_for_approval",
      terminal: false,
    });
    return;
  }

  if (status === "exit") {
    if (awaitingStaleOutput(session, body)) {
      await keepWaitingForResume(ctx, session);
      return;
    }
    await onFinished(ctx, session, body);
    return;
  }

  if (status === "error" || (statusDetail && V3_FAILURE_DETAILS.has(statusDetail))) {
    await failSession(
      ctx,
      session,
      statusDetail ? `Devin v3 session stopped: ${statusDetail}` : "Devin v3 session errored"
    );
    return;
  }

  if (
    status === "suspended" &&
    (statusDetail === "inactivity" || statusDetail === "user_request")
  ) {
    if (extractOutput(body)) {
      if (awaitingStaleOutput(session, body)) {
        await keepWaitingForResume(ctx, session);
        return;
      }
      await onFinished(ctx, session, body);
    } else if (session.status !== "suspended" || session.statusDetail !== statusDetail) {
      await ctx.runMutation(internal.builds.logEvent, {
        buildId: session.buildId,
        kind: "devin-message",
        message: `Devin session suspended: ${statusDetail}`,
      });
    }
  }
}

type ExtractedOutput = {
  out: any;
  spec: ReturnType<typeof appSpecSchema.parse>;
  appTsx: string;
};

function awaitingStaleOutput(session: PendingSession, body: any): boolean {
  if (!session.awaitingResume || !session.lastOutputFingerprint) return false;
  const extracted = extractOutput(body);
  return Boolean(
    extracted && sourceFingerprint(extracted.appTsx) === session.lastOutputFingerprint,
  );
}

async function keepWaitingForResume(ctx: ActionCtx, session: PendingSession): Promise<void> {
  await ctx.runMutation(internal.devin.upsertFromPoll, {
    id: session._id,
    status: sessionApiVersion(session) === "v3" ? "resuming" : "resume_requested",
    terminal: false,
  });
}

/** Valid, successful structured output — or null. */
function extractOutput(body: any): ExtractedOutput | null {
  let out: any = body?.structured_output;
  if (typeof out === "string") {
    try {
      out = JSON.parse(out);
    } catch {
      return null;
    }
  }
  if (!out || typeof out !== "object" || out.status === "failed") return null;
  const specParse = appSpecSchema.safeParse(out.appSpec);
  const appTsx: unknown = out.appTsx;
  if (
    !specParse.success ||
    typeof appTsx !== "string" ||
    appTsx.trim().length === 0 ||
    appTsx.length > MAX_GENERATED_TSX_LENGTH
  ) {
    return null;
  }
  return { out, spec: specParse.data, appTsx };
}

async function onFinished(ctx: ActionCtx, session: PendingSession, body: any): Promise<void> {
  let rawOut: any = body?.structured_output;
  if (typeof rawOut === "string") {
    try {
      rawOut = JSON.parse(rawOut);
    } catch {
      rawOut = null;
    }
  }
  if (rawOut && typeof rawOut === "object" && rawOut.status === "failed") {
    const notes = typeof rawOut.notes === "string" ? `: ${rawOut.notes.slice(0, 300)}` : "";
    await failSession(ctx, session, `Devin reported failure${notes}`);
    return;
  }
  const extracted = extractOutput(body);
  if (!extracted) {
    await failSession(ctx, session, "Devin finished without valid structured output");
    return;
  }
  const { out, spec, appTsx } = extracted;

  const build = await ctx.runQuery(internal.builds.getBuild, { buildId: session.buildId });
  if (!build) {
    await ctx.runMutation(internal.devin.upsertFromPoll, { id: session._id, terminal: true });
    return;
  }
  const allowedConnectors = [...appConnectors(build)];
  const declaredConnectors = spec.connectorsUsed ?? [];
  const disallowed = declaredConnectors.find((connector) => !allowedConnectors.includes(connector));
  if (disallowed) {
    await failSession(ctx, session, `Generated app used disabled connector: ${disallowed}`);
    return;
  }
  try {
    let appId: Id<"apps"> | undefined = build.appId;
    if (!appId) {
      const name =
        typeof out.appName === "string" && out.appName.trim() ? out.appName.trim() : spec.name;
      const created = await ctx.runMutation(internal.apps.createForBuild, {
        buildId: session.buildId,
        name,
        spec,
        theme: spec.theme,
        prompt: build.prompt,
      });
      appId = created.appId;
    } else {
      const name =
        typeof out.appName === "string" && out.appName.trim() ? out.appName.trim() : spec.name;
      await ctx.runMutation(internal.apps.updateForBuild, {
        appId,
        name,
        spec,
        theme: spec.theme,
      });
    }
    const published = await ctx.runMutation(internal.apps.publishVersion, {
      appId,
      tsxSource: appTsx,
      specJson: spec,
      buildId: session.buildId,
      devinSessionDocId: session._id,
      devinGeneration: session.generation,
    });
    if (published.created) {
      await ctx.runMutation(internal.builds.patch, {
        buildId: session.buildId,
        status: "awaiting_compile",
      });
      await ctx.runMutation(internal.builds.logEvent, {
        buildId: session.buildId,
        kind: "devin",
        message: "app generated — waiting for compile",
      });
    } else {
      // The conversation completed without changing source. Return the build
      // to its prior source state instead of leaving it stuck at Generating.
      await ctx.runMutation(internal.builds.patch, {
        buildId: session.buildId,
        status: published.status,
      });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await failSession(ctx, session, `Could not publish generated app: ${detail.slice(0, 300)}`);
    return;
  }

  await ctx.runMutation(internal.devin.upsertFromPoll, {
    id: session._id,
    status: "completed",
    statusDetail: "output_ready",
    awaitingResume: false,
    lastOutputFingerprint: sourceFingerprint(appTsx),
    terminal: true,
    structuredOutput: {
      status: out.status,
      appName: out.appName,
      notes: typeof out.notes === "string" ? out.notes : undefined,
    },
  });
  if (session.generation > 0) {
    const response =
      typeof out.notes === "string" && out.notes.trim()
        ? out.notes.trim()
        : "I finished that update. The new app version is ready for the builder.";
    await ctx.runMutation(internal.builds.logEvent, {
      buildId: session.buildId,
      kind: "devin-message",
      message: response.slice(0, 2_000),
    });
  }
}

async function failSession(ctx: ActionCtx, session: PendingSession, message: string): Promise<void> {
  await ctx.runMutation(internal.devin.upsertFromPoll, { id: session._id, terminal: true });
  const build = await ctx.runQuery(internal.builds.getBuild, { buildId: session.buildId });
  if (!build) return;
  if (session.generation === 0 && maxAutomaticRetries() > 0 && !build.retried) {
    await ctx.runMutation(internal.builds.patch, {
      buildId: session.buildId,
      retried: true,
      status: "queued",
    });
    await ctx.runMutation(internal.builds.logEvent, {
      buildId: session.buildId,
      kind: "error",
      message: `${message} — retrying once`,
    });
    await ctx.scheduler.runAfter(0, internal.devinActions.start, { buildId: session.buildId });
  } else {
    await ctx.runMutation(internal.builds.patch, {
      buildId: session.buildId,
      status: "error",
      error: message,
    });
    await ctx.runMutation(internal.builds.logEvent, {
      buildId: session.buildId,
      kind: "error",
      message,
    });
  }
}
