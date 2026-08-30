"use node";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Theme } from "./lib/appSpec";
import { hasAppConnector } from "./lib/connectors";
import { requireOperator } from "./lib/operator";

// Convex runtimes expose process.env; @types/node is not part of this tsconfig.
declare const process: { env: Record<string, string | undefined> };

const BASE = "https://api.context.dev/v1";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withContextLease<T>(ctx: ActionCtx, work: () => Promise<T>): Promise<T> {
  const owner = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  let slot: number | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    slot = await ctx.runMutation(internal.builds.acquireContextSlot, {
      owner,
      leaseMs: 180_000,
    });
    if (slot !== null) break;
    await wait(750 + Math.floor(Math.random() * 250));
  }
  if (slot === null) throw new Error("Context.dev queue is busy; try again shortly");
  try {
    return await work();
  } finally {
    await ctx.runMutation(internal.builds.releaseContextSlot, { owner, slot });
  }
}

function contextKey(): string | null {
  // CONTEXT is retained as a backwards-compatible alias for the existing
  // workspace. CONTEXT_DEV_API_KEY is the official Context.dev convention.
  return process.env.CONTEXT_DEV_API_KEY?.trim() || process.env.CONTEXT?.trim() || null;
}

async function get(path: string, params: Record<string, string>): Promise<any | null> {
  const key = contextKey();
  if (!key) return null;
  try {
    const url = new URL(`${BASE}${path}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function post(path: string, body: unknown): Promise<any | null> {
  const key = contextKey();
  if (!key) return null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function asColor(c: unknown): string | undefined {
  if (typeof c === "string" && c.trim()) return c.trim();
  if (c && typeof c === "object") {
    const o = c as any;
    return asColor(o.hex ?? o.value ?? o.color);
  }
  return undefined;
}

function asFont(f: unknown): string | undefined {
  if (typeof f === "string" && f.trim()) return f.trim();
  if (f && typeof f === "object") {
    const o = f as any;
    return asFont(o.fontFamily ?? o.family ?? o.name ?? o.font);
  }
  return undefined;
}

function pickLogo(body: any, depth = 0): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  if (depth > 3) return undefined;
  const candidates = [
    body.logoUrl,
    body.logo_url,
    body.logo,
    body.images?.logo,
    body.icon,
    Array.isArray(body.logos) ? body.logos[0] : undefined,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//.test(c)) return c;
    if (Array.isArray(c)) {
      for (const item of c) {
        const nested = pickLogo(item, depth + 1);
        if (nested) return nested;
      }
    }
    if (c && typeof c === "object") {
      const o = c as any;
      for (const value of [o.url, o.src, o.svg, o.png, o.image, o.formats]) {
        if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
        const nested = pickLogo(value, depth + 1);
        if (nested) return nested;
      }
    }
  }
  for (const value of Object.values(body)) {
    if (typeof value === "string" && /^https?:\/\//.test(value) && /logo|icon/i.test(value)) {
      return value;
    }
    if (value && typeof value === "object") {
      const nested = pickLogo(value, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

// Defensive mapping: the response shape varies; look for colors/palette/fonts.
function mapTheme(body: any): Theme | null {
  if (!body || typeof body !== "object") return null;
  const root = body.styleguide ?? body.brand ?? body.data ?? body;
  const colors = root?.colors ?? root?.palette ?? root?.theme?.colors ?? null;
  const theme: Record<string, string> = {};
  if (Array.isArray(colors)) {
    const hexes = colors.map(asColor).filter((c): c is string => !!c);
    if (hexes[0]) theme.primary = hexes[0];
    if (hexes[1]) theme.secondary = hexes[1];
    if (hexes[2]) theme.accent = hexes[2];
  } else if (colors && typeof colors === "object") {
    const set = (token: string, ...cands: unknown[]) => {
      for (const cand of cands) {
        const hex = asColor(cand);
        if (hex) {
          theme[token] = hex;
          return;
        }
      }
    };
    const c = colors as any;
    set("primary", c.primary, c.accent, c.brand, c.main, c.primaryColor);
    set("secondary", c.secondary, c.muted, c.secondaryColor);
    set("background", c.background, c.bg, c.backgroundColor);
    set("surface", c.surface, c.card, c.panel);
    set("text", c.text, c.foreground, c.fg, c.textColor);
    set("accent", c.accent, c.highlight, c.accentColor);
  }
  // Context.dev's current styleguide has one accent token; use it for both
  // primary and accent so generated UI components inherit a coherent palette.
  if (!theme.accent && theme.primary) theme.accent = theme.primary;
  if (!theme.primary && theme.accent) theme.primary = theme.accent;

  const fonts = root?.fonts ?? root?.typography ?? null;
  const font = Array.isArray(fonts)
    ? asFont(fonts[0])
    : asFont(
        (fonts as any)?.primary ??
          (fonts as any)?.heading ??
          (fonts as any)?.headings?.h1 ??
          (fonts as any)?.body ??
          (fonts as any)?.p ??
          fonts
      );
  if (font) theme.font = font;
  const logo = pickLogo(root) ?? pickLogo(body);
  if (logo) theme.logoUrl = logo;
  return Object.keys(theme).length > 0 ? theme : null;
}

export const styleguide = internalAction({
  args: { url: v.string() },
  returns: v.any(),
  handler: async (ctx, { url }): Promise<Theme | null> => {
    const cacheKey = `styleguide:${url}`;
    const cached = await ctx.runQuery(internal.builds.cacheGet, { cacheKey });
    if (cached !== null) return cached;
    return await withContextLease(ctx, async () => {
      let parsed: URL;
      try {
        parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
      } catch {
        return null;
      }

      let theme = mapTheme(
        await get("/web/styleguide", {
          directUrl: parsed.toString(),
          timeoutMS: "30000",
        })
      );
      let brand: any | null = null;
      if (!theme) {
        brand = await post("/brand/retrieve", {
          type: "by_domain",
          domain: parsed.hostname,
          timeoutMS: 30000,
        });
        theme = mapTheme(brand);
      }
      if (theme && !theme.logoUrl) {
        brand =
          brand ??
          (await post("/brand/retrieve", {
            type: "by_domain",
            domain: parsed.hostname,
            timeoutMS: 30000,
          }));
        const logo = pickLogo(brand) ?? pickLogo(brand?.data ?? brand?.brand);
        if (logo) theme.logoUrl = logo;
      }
      if (theme) {
        await ctx.runMutation(internal.builds.cachePut, { cacheKey, value: theme });
      }
      return theme;
    });
  },
});

function findArray(body: any, depth = 0): any[] | null {
  if (!body || depth > 4) return null;
  if (Array.isArray(body)) return body;
  if (typeof body !== "object") return null;
  for (const k of ["data", "items", "result", "results", "output", "extracted", "rows"]) {
    const val = body[k];
    if (Array.isArray(val)) return val;
    if (val && typeof val === "object") {
      const nested = findArray(val, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function safeFieldName(raw: string, index: number): string {
  let name = raw.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").slice(0, 80);
  if (!/^[A-Za-z]/.test(name)) name = `field_${index}_${name}`;
  return name || `field_${index}`;
}

function normalizeExtracted(value: unknown, depth = 0): any {
  if (depth > 10) return null;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 20_000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((item) => normalizeExtracted(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const used = new Set<string>();
    for (const [index, [rawKey, rawValue]] of Object.entries(value).slice(0, 100).entries()) {
      let key = safeFieldName(rawKey, index);
      while (used.has(key)) key = `${key}_${index}`;
      used.add(key);
      out[key] = normalizeExtracted(rawValue, depth + 1);
    }
    return out;
  }
  return null;
}

export const extract = internalAction({
  args: { url: v.string(), schema: v.any() },
  returns: v.any(),
  handler: async (ctx, { url, schema }): Promise<any[] | null> => {
    // The same URL may be extracted against different schemas.
    const cacheKey = `extract:${url}:${shortHash(JSON.stringify(schema))}`;
    const cached = await ctx.runQuery(internal.builds.cacheGet, { cacheKey });
    if (cached !== null) return cached;
    return await withContextLease(ctx, async () => {
      const body = await post("/web/extract", {
        url,
        schema,
        maxPages: 5,
        timeoutMS: 60000,
        tags: ["app-builder"],
      });
      const found = findArray(body?.data ?? body);
      const rows = found?.slice(0, 200).map((row) => normalizeExtracted(row));
      if (rows) {
        await ctx.runMutation(internal.builds.cachePut, { cacheKey, value: rows });
      }
      return rows ?? null;
    });
  },
});

export const search = internalAction({
  args: { query: v.string(), domains: v.optional(v.array(v.string())) },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { query, domains }): Promise<string | null> => {
    return await withContextLease(ctx, async () => {
      const body = await post("/web/search", {
        query: query.slice(0, 500),
        numResults: 10,
        markdownOptions: {
          enabled: true,
          useMainContentOnly: true,
          includeImages: false,
          timeoutMS: 30000,
        },
        tags: ["app-builder"],
        ...(domains && domains.length > 0 ? { includeDomains: domains } : {}),
      });
      if (!body) return null;
      const results = Array.isArray(body) ? body : body.results ?? body.data ?? [];
      const parts = (Array.isArray(results) ? results : [])
        .map((r: any) =>
          typeof r === "string"
            ? r
            : r?.markdown?.code === "SUCCESS"
              ? r.markdown.markdown
              : r?.md ?? r?.content ?? r?.text
        )
        .filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0);
      return parts.length > 0 ? parts.join("\n\n---\n\n") : null;
    });
  },
});

export const retheme = action({
  args: { slug: v.string(), url: v.string(), operatorKey: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { slug, url, operatorKey }): Promise<boolean> => {
    requireOperator(operatorKey);
    const app = await ctx.runQuery(internal.apps.getInternalBySlug, { slug });
    if (!app) throw new Error(`No app with slug "${slug}"`);
    if (!hasAppConnector(app, "context")) {
      throw new Error("Context is not enabled for this app");
    }
    const theme = await ctx.runAction(internal.contextdev.styleguide, { url });
    if (!theme) return false;
    await ctx.runMutation(api.apps.setTheme, { slug, theme, operatorKey });
    return true;
  },
});
