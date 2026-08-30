"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { appConnectors } from "./lib/connectors";
import { RUNTIME_JS } from "./lib/runtimeAsset";
import { requireOperator } from "./lib/operator";

declare const process: { env: Record<string, string | undefined> };

const VERCEL_ORIGIN = "https://api.vercel.com";
const MAX_POLL_ATTEMPTS = 100;
const DEPLOYMENT_LEASE_MS = 2 * 60_000;
const STANDARD_PROTECTION = "prod_deployment_urls_and_all_previews";

function token(): string {
  const value = (process.env.VERCEL_TOKEN ?? process.env.VERCEL)?.trim();
  if (!value) throw new Error("Vercel is not configured");
  return value;
}

function convexUrl(): string {
  const value = (process.env.APP_CONVEX_URL ?? process.env.CONVEX_CLOUD_URL)?.trim();
  if (!value) throw new Error("APP_CONVEX_URL is not configured");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("APP_CONVEX_URL must use https");
  return parsed.origin;
}

function scoped(path: string): string {
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  if (!teamId) return `${VERCEL_ORIGIN}${path}`;
  return `${VERCEL_ORIGIN}${path}${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(teamId)}`;
}

async function jsonRequest(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(scoped(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const code =
      typeof body?.error?.code === "string" ? ` (${body.error.code.slice(0, 80)})` : "";
    throw new Error(`Vercel API ${response.status}${code}`);
  }
  return body;
}

function projectName(slug: string, appId: string): string {
  const raw = `ab-${slug}-${appId.slice(-8)}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{3,}/g, "--")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 100);
  return raw || `app-builder-${appId.slice(-8).toLowerCase()}`;
}

function projectIdFrom(body: any): string {
  if (typeof body?.id !== "string") throw new Error("Vercel project response missing id");
  return body.id;
}

async function enforceStandardProtection(body: any): Promise<string> {
  const projectId = projectIdFrom(body);
  if (body?.ssoProtection?.deploymentType !== STANDARD_PROTECTION) {
    await jsonRequest(`/v9/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        ssoProtection: { deploymentType: STANDARD_PROTECTION },
      }),
    });
  }
  return projectId;
}

async function ensureProject(name: string): Promise<string> {
  const encoded = encodeURIComponent(name);
  const get = async () => {
    const body = await jsonRequest(`/v9/projects/${encoded}`);
    return await enforceStandardProtection(body);
  };
  try {
    return await get();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Vercel API 404")) throw error;
  }
  try {
    const body = await jsonRequest("/v11/projects", {
      method: "POST",
      body: JSON.stringify({
        name,
        framework: null,
        ssoProtection: { deploymentType: STANDARD_PROTECTION },
      }),
    });
    return projectIdFrom(body);
  } catch (error) {
    // Deterministic names make concurrent creates recoverable.
    if (error instanceof Error && error.message.startsWith("Vercel API 409")) return await get();
    throw error;
  }
}

function scriptSafe(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function faviconForApp(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 2) || "✦";
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<defs><linearGradient id="g" x1="7" y1="5" x2="57" y2="59" gradientUnits="userSpaceOnUse">' +
    '<stop stop-color="#8B82FF"/><stop offset="1" stop-color="#4D3EDB"/></linearGradient></defs>' +
    '<rect width="64" height="64" rx="18" fill="url(#g)"/>' +
    `<text x="32" y="39" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="23" font-weight="800">${initials}</text>` +
    '<circle cx="50" cy="14" r="4" fill="#89E7C0"/></svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function originOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

function standaloneHtml(payload: any): string {
  const cloud = convexUrl();
  const ws = cloud.replace(/^https:/, "wss:");
  const theme = payload.app.theme && typeof payload.app.theme === "object" ? payload.app.theme : null;
  const logo = originOrNull(theme?.logoUrl);
  const connectors = [...appConnectors(payload.version)];
  const appTitle = String(payload.app.name || payload.app.slug || "App");
  const escapedAppTitle = htmlEscape(appTitle);
  const favicon = faviconForApp(appTitle);
  const config = {
    appId: String(payload.app._id),
    slug: payload.app.slug,
    name: payload.app.name,
    deploymentUrl: cloud,
    theme,
    connectors,
  };
  const connectSources = `${cloud} ${ws}`;
  const imageSources = ["data:", "blob:", logo].filter(Boolean).join(" ");
  const innerCsp = [
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
  const inner =
    "<!doctype html><html><head>" +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">' +
    '<meta name="referrer" content="no-referrer">' +
    `<meta http-equiv="Content-Security-Policy" content="${innerCsp}">` +
    "<style>html,body,#root{height:100%;margin:0}</style>" +
    "</head><body><div id=\"root\"></div>" +
    `<script>${scriptSafe(RUNTIME_JS)}</script>` +
    `<script>${scriptSafe(payload.version.bundle)}</script>` +
    "<script>window.__RT_BOOT__()</script></body></html>";

  const hostScript = `(()=>{const frame=document.getElementById("app");const cfg=${jsonForScript(
    config
  )};const inner=${jsonForScript(inner)};const adjectives=["Bright","Swift","Sunny","Brave","Clever","Merry"];const animals=["Fox","Otter","Panda","Falcon","Koala","Tiger"];let sid=localStorage.getItem("ab-session");if(!sid){sid=crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random();localStorage.setItem("ab-session",sid)}let name=localStorage.getItem("ab-name");if(!name){let n=Math.abs([...sid].reduce((a,c)=>a+c.charCodeAt(0),0));name=adjectives[n%adjectives.length]+" "+animals[Math.floor(n/adjectives.length)%animals.length];localStorage.setItem("ab-name",name)}addEventListener("message",e=>{if(e.source!==frame.contentWindow||!e.data||e.data.type!=="boot")return;frame.contentWindow.postMessage({...cfg,type:"init",sessionId:sid,name,mode:new URLSearchParams(location.search).get("mode")==="projector"?"projector":"player"},"*")});frame.srcdoc=inner})();`;

  return (
    "<!doctype html><html><head>" +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="referrer" content="no-referrer">' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'; child-src 'self'; connect-src ${connectSources}; img-src ${imageSources}; font-src data:; base-uri 'none'; object-src 'none'; form-action 'none'">` +
    `<link rel="icon" href="${favicon}" type="image/svg+xml">` +
    `<title>${escapedAppTitle}</title>` +
    "<style>html,body,#app{width:100%;height:100%;margin:0;border:0;background:#0b0d14}#app{position:fixed;inset:0}</style>" +
    `</head><body><iframe id="app" title="${escapedAppTitle}" sandbox="allow-scripts"></iframe>` +
    `<script>${scriptSafe(hostScript)}</script></body></html>`
  );
}

function remoteDeploymentId(body: any): string | null {
  const value = body?.id ?? body?.uid;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function remoteState(body: any): string {
  return String(body?.readyState ?? body?.status ?? body?.state ?? "").toUpperCase();
}

function httpsHostname(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.includes("/")) return null;
  try {
    const parsed = new URL(`https://${value}`);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function productionAlias(project: any, vercelDeploymentId: string): string | null {
  const aliases = Array.isArray(project?.alias) ? project.alias : [];
  for (const alias of aliases) {
    const linkedId = alias?.deployment?.id ?? alias?.deploymentId;
    if (
      linkedId === vercelDeploymentId &&
      String(alias?.environment ?? "").toLowerCase() === "production" &&
      String(alias?.target ?? "").toUpperCase() === "PRODUCTION"
    ) {
      const url = httpsHostname(alias?.domain);
      if (url) return url;
    }
  }

  const targets = project?.targets;
  if (targets && typeof targets === "object") {
    for (const [key, target] of Object.entries(targets) as Array<[string, any]>) {
      if (
        key.toLowerCase() !== "production" ||
        (target?.id ?? target?.deploymentId) !== vercelDeploymentId
      ) {
        continue;
      }
      const hostnames = Array.isArray(target?.alias) ? target.alias : [];
      for (const hostname of hostnames) {
        const url = httpsHostname(hostname);
        if (url) return url;
      }
    }
  }
  return null;
}

async function resolveProductionUrl(
  projectId: string,
  vercelDeploymentId: string
): Promise<string | null> {
  const project = await jsonRequest(`/v9/projects/${encodeURIComponent(projectId)}`);
  await enforceStandardProtection(project);
  return productionAlias(project, vercelDeploymentId);
}

async function findRemoteDeployment(
  projectId: string,
  versionId: string,
  createdAt?: number,
  excludeDeploymentId?: string
): Promise<any | null> {
  const query = new URLSearchParams({ projectId, limit: "50" });
  if (typeof createdAt === "number") {
    query.set("since", String(Math.max(0, createdAt - 60_000)));
  }
  const body = await jsonRequest(`/v7/deployments?${query.toString()}`);
  const deployments = Array.isArray(body?.deployments) ? body.deployments : [];
  const matches = deployments.filter((deployment: any) => {
    const id = remoteDeploymentId(deployment);
    return (
      deployment?.meta?.appBuilderVersionId === versionId &&
      (!excludeDeploymentId || id !== excludeDeploymentId)
    );
  });
  matches.sort(
    (left: any, right: any) =>
      Number(right?.createdAt ?? right?.created ?? 0) -
      Number(left?.createdAt ?? left?.created ?? 0)
  );
  return matches[0] ?? null;
}

async function adoptRemote(
  ctx: any,
  deploymentId: any,
  projectId: string,
  body: any,
  attempt = 0
): Promise<{ status: string; url?: string }> {
  const vercelDeploymentId = remoteDeploymentId(body);
  if (!vercelDeploymentId) throw new Error("Vercel deployment response missing id");
  await ctx.runMutation(internal.vercelData.recordCreated, {
    deploymentId,
    vercelDeploymentId,
    projectId,
  });

  const state = remoteState(body);
  if (state === "READY") {
    const url = await resolveProductionUrl(projectId, vercelDeploymentId);
    if (url) {
      await ctx.runMutation(internal.vercelData.complete, { deploymentId, url });
      return { status: "ready", url };
    }
  } else if (["ERROR", "CANCELED", "BLOCKED"].includes(state)) {
    await ctx.runMutation(internal.vercelData.fail, {
      deploymentId,
      error: `Vercel deployment ended in ${state.toLowerCase()}`,
    });
    return { status: state.toLowerCase() };
  }

  await ctx.scheduler.runAfter(state === "READY" ? 3000 : 2500, internal.vercel.poll, {
    deploymentId,
    attempt,
  });
  return { status: state ? state.toLowerCase() : "deploying" };
}

export const deploy = internalAction({
  args: { deploymentId: v.id("deployments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claimed = await ctx.runMutation(internal.vercelData.claim, args);
    if (!claimed) return null;
    try {
      const payload = await ctx.runQuery(internal.vercelData.getPayload, args);
      if (!payload?.version?.bundle) throw new Error("Compiled version is unavailable");
      const name = projectName(payload.app.slug, String(payload.app._id));
      const projectId = await ensureProject(name);
      await ctx.runMutation(internal.vercelData.recordProject, {
        deploymentId: args.deploymentId,
        projectId,
      });

      // A previous action may have reached Vercel but died before persisting
      // the remote ID. Recover by immutable app-version metadata before POST.
      const existingRemote = await findRemoteDeployment(
        projectId,
        String(payload.version._id),
        claimed.previousDeploymentId ? claimed.lease : payload.deployment.createdAt,
        claimed.previousDeploymentId
      );
      if (existingRemote) {
        const renewed = await ctx.runMutation(internal.vercelData.renewClaim, {
          deploymentId: args.deploymentId,
          lease: claimed.lease,
        });
        if (renewed === null) return null;
        await adoptRemote(ctx, args.deploymentId, projectId, existingRemote);
        return null;
      }

      const renewed = await ctx.runMutation(internal.vercelData.renewClaim, {
        deploymentId: args.deploymentId,
        lease: claimed.lease,
      });
      if (renewed === null) return null;

      const body = await jsonRequest(
        "/v13/deployments?skipAutoDetectionConfirmation=1",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            project: projectId,
            target: "production",
            files: [{ file: "index.html", data: standaloneHtml(payload), encoding: "utf-8" }],
            projectSettings: { framework: null },
            meta: {
              appBuilderAppId: String(payload.app._id),
              appBuilderVersionId: String(payload.version._id),
            },
          }),
        }
      );
      await adoptRemote(ctx, args.deploymentId, projectId, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown deployment error";
      await ctx.runMutation(internal.vercelData.fail, {
        deploymentId: args.deploymentId,
        error: message,
      });
    }
    return null;
  },
});

export const poll = internalAction({
  args: { deploymentId: v.id("deployments"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(internal.vercelData.getPayload, {
      deploymentId: args.deploymentId,
    });
    if (!payload || payload.deployment.status !== "deploying") return null;
    const remoteId = payload.deployment.deploymentId;
    if (typeof remoteId !== "string") return null;
    try {
      const body = await jsonRequest(`/v13/deployments/${encodeURIComponent(remoteId)}`);
      const state = remoteState(body);
      if (state === "READY") {
        const projectId =
          typeof payload.deployment.projectId === "string"
            ? payload.deployment.projectId
            : await ensureProject(projectName(payload.app.slug, String(payload.app._id)));
        await ctx.runMutation(internal.vercelData.recordProject, {
          deploymentId: args.deploymentId,
          projectId,
        });
        const url = await resolveProductionUrl(projectId, remoteId);
        if (url) {
          await ctx.runMutation(internal.vercelData.complete, {
            deploymentId: args.deploymentId,
            url,
          });
        } else if (args.attempt >= MAX_POLL_ATTEMPTS) {
          await ctx.runMutation(internal.vercelData.fail, {
            deploymentId: args.deploymentId,
            error: "Vercel production alias was not assigned",
          });
        } else {
          await ctx.scheduler.runAfter(3000, internal.vercel.poll, {
            deploymentId: args.deploymentId,
            attempt: args.attempt + 1,
          });
        }
      } else if (["ERROR", "CANCELED", "BLOCKED"].includes(state)) {
        await ctx.runMutation(internal.vercelData.fail, {
          deploymentId: args.deploymentId,
          error: `Vercel deployment ended in ${state.toLowerCase()}`,
        });
      } else if (args.attempt >= MAX_POLL_ATTEMPTS) {
        await ctx.runMutation(internal.vercelData.fail, {
          deploymentId: args.deploymentId,
          error: "Vercel deployment timed out",
        });
      } else {
        await ctx.scheduler.runAfter(3000, internal.vercel.poll, {
          deploymentId: args.deploymentId,
          attempt: args.attempt + 1,
        });
      }
    } catch (error) {
      if (args.attempt < MAX_POLL_ATTEMPTS) {
        await ctx.scheduler.runAfter(5000, internal.vercel.poll, {
          deploymentId: args.deploymentId,
          attempt: args.attempt + 1,
        });
      } else {
        await ctx.runMutation(internal.vercelData.fail, {
          deploymentId: args.deploymentId,
          error: error instanceof Error ? error.message : "Vercel polling failed",
        });
      }
    }
    return null;
  },
});

/**
 * Operator repair path for projects created before production-alias handling.
 * It also backfills a dropped remote ID by matching immutable version metadata.
 */
export const reconcile = action({
  args: { slug: v.string(), operatorKey: v.string() },
  returns: v.object({
    deploymentId: v.id("deployments"),
    status: v.string(),
    url: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{ deploymentId: any; status: string; url?: string }> => {
    requireOperator(args.operatorKey);
    let target: any = await ctx.runQuery(internal.vercelData.getReconcileTarget, {
      slug: args.slug,
    });
    if (!target) throw new Error("App has no compiled live version");

    if (!target.deployment) {
      const deploymentId = await ctx.runMutation(internal.vercelData.queueForOperator, {
        versionId: target.version._id,
      });
      if (!deploymentId) throw new Error("Could not queue deployment");
      return { deploymentId, status: "queued" };
    }

    const localDeploymentId = target.deployment._id;
    const name = projectName(target.app.slug, String(target.app._id));
    const projectId = await ensureProject(name);
    await ctx.runMutation(internal.vercelData.recordProject, {
      deploymentId: localDeploymentId,
      projectId,
    });

    let remote: any | null = null;
    if (typeof target.deployment.deploymentId === "string") {
      remote = await jsonRequest(
        `/v13/deployments/${encodeURIComponent(target.deployment.deploymentId)}`
      );
    } else {
      remote = await findRemoteDeployment(
        projectId,
        String(target.version._id),
        target.deployment.createdAt
      );
    }

    if (remote) {
      const result = await adoptRemote(ctx, localDeploymentId, projectId, remote);
      return { deploymentId: localDeploymentId, ...result };
    }

    const requeued = await ctx.runMutation(internal.vercelData.requeueUnidentified, {
      deploymentId: localDeploymentId,
    });
    if (!requeued) {
      // Refresh once to return the state won by a concurrent recovery action.
      target = await ctx.runQuery(internal.vercelData.getReconcileTarget, { slug: args.slug });
      return {
        deploymentId: localDeploymentId,
        status: String(target?.deployment?.status ?? "unchanged"),
        ...(typeof target?.deployment?.url === "string"
          ? { url: target.deployment.url }
          : {}),
      };
    }
    return { deploymentId: localDeploymentId, status: "queued" };
  },
});

/** Recovers jobs if a scheduled action was dropped before it could run. */
export const recover = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const rows = await ctx.runQuery(internal.vercelData.pending, {});
    const cutoff = Date.now() - DEPLOYMENT_LEASE_MS;
    for (const row of rows) {
      try {
        if (row.status === "queued") {
          await ctx.scheduler.runAfter(0, internal.vercel.deploy, { deploymentId: row._id });
        } else if (row.status === "deploying" && row.deploymentId) {
          await ctx.scheduler.runAfter(0, internal.vercel.poll, {
            deploymentId: row._id,
            attempt: 0,
          });
        } else if (row.status === "deploying" && row.updatedAt <= cutoff) {
          const payload = await ctx.runQuery(internal.vercelData.getPayload, {
            deploymentId: row._id,
          });
          if (!payload) continue;
          const name = projectName(payload.app.slug, String(payload.app._id));
          const projectId = await ensureProject(name);
          await ctx.runMutation(internal.vercelData.recordProject, {
            deploymentId: row._id,
            projectId,
          });
          const remote = await findRemoteDeployment(
            projectId,
            String(payload.version._id),
            row.createdAt
          );
          if (remote) {
            await adoptRemote(ctx, row._id, projectId, remote);
          } else {
            await ctx.runMutation(internal.vercelData.requeueExpiredClaim, {
              deploymentId: row._id,
              cutoff,
            });
          }
        }
      } catch {
        // A transient Vercel failure must not prevent recovery of other rows.
        // The next cron pass will retry without exposing provider details.
      }
    }
    return null;
  },
});
