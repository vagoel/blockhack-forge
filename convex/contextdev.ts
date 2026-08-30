"use node";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Theme } from "./lib/appSpec";
import { hasAppConnector } from "./lib/connectors";
import { requireOperator } from "./lib/operator";
import { summarizeRenderedSource } from "./lib/sourceStyle";

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

function renderedHtml(body: any): string | null {
  for (const value of [body?.html, body?.data?.html, body?.result?.html]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export const sourceStyle = internalAction({
  args: { url: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { url }): Promise<string | null> => {
    const cacheKey = `source-style:${url}`;
    const cached = await ctx.runQuery(internal.builds.cacheGet, { cacheKey });
    if (typeof cached === "string") return cached;
    return await withContextLease(ctx, async () => {
      let parsed: URL;
      try {
        parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
      } catch {
        return null;
      }

      const body = await get("/web/scrape/html", {
        url: parsed.toString(),
        includeFrames: "false",
        timeoutMS: "30000",
      });
      const html = renderedHtml(body);
      if (!html) return null;
      const title = body?.metadata?.title ?? body?.title ?? body?.data?.metadata?.title;
      const grounding = summarizeRenderedSource(
        html,
        body?.metadata?.finalUrl ?? body?.url ?? parsed.toString(),
        typeof title === "string" ? title : null,
      );
      if (grounding) {
        await ctx.runMutation(internal.builds.cachePut, { cacheKey, value: grounding });
      }
      return grounding;
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

type ResearchSource = {
  url: string;
  title: string | null;
  description: string | null;
  markdown: string | null;
};

const LOW_TRUST_RESEARCH_HOSTS = new Set([
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "pinterest.com",
  "reddit.com",
  "tiktok.com",
  "x.com",
  "youtube.com",
]);

function normalizedHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

const DISCOVERY_QUERY_LIMIT = 430;
const SOURCE_INTENT_RE =
  /\b(source|reference|ground|grounding|brand|style|research|official|website|url|data|docs?|documentation|information|provenance)\b/i;

function cleanDiscoverySentence(value: string): string {
  return value
    .replace(
      /\[(?:insert\s+)?([^\]]+?)(?:\s+here)?\]/gi,
      (_match, contents: string) => contents.replace(/\burl\b/gi, "source"),
    )
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(
      /^build\s+(?:(?:a|an|the)\s+)?(?:(?:live|polished|responsive|modern|realtime|real-time|new|simple)\s+)*(?:"[^"]+"\s+)?(?:web\s+)?(?:app|website|tool|dashboard|directory|site)\s*(?:for|about|that)?\s*/i,
      "",
    )
    .replace(/\b(?:use|using|enable)\s+context\.dev\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function appendWithinLimit(parts: string[], value: string, valueLimit = DISCOVERY_QUERY_LIMIT): void {
  if (!value || parts.includes(value)) return;
  const bounded = value.length > valueLimit
    ? value.slice(0, valueLimit).replace(/\s+\S*$/, "").trim()
    : value;
  const used = parts.join(" ").length + (parts.length > 0 ? 1 : 0);
  const remaining = DISCOVERY_QUERY_LIMIT - used;
  if (remaining <= 0) return;
  if (bounded.length <= remaining) {
    parts.push(bounded);
    return;
  }
  const clipped = bounded.slice(0, remaining).replace(/\s+\S*$/, "").trim();
  if (clipped.length >= 24) parts.push(clipped);
}

/** Build a focused Context.dev query from the complete request instead of truncating its start. */
export function buildContextDiscoveryQuery(prompt: string): string {
  const normalized = prompt.replace(/\r/g, "\n").replace(/\n+/g, ". ").trim();
  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map(cleanDiscoverySentence)
    .filter(Boolean);
  if (sentences.length === 0) return "official authoritative source";

  const identity = sentences[0];
  const prioritized = sentences
    .slice(1)
    .map((sentence, index) => ({
      sentence,
      index,
      score: SOURCE_INTENT_RE.test(sentence) ? 100 : 0,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const parts: string[] = [];
  // Reserve room for source instructions that may occur near the end of a long request.
  appendWithinLimit(parts, identity, 180);
  for (const candidate of prioritized) appendWithinLimit(parts, candidate.sentence);
  return parts.join(" ").slice(0, DISCOVERY_QUERY_LIMIT).trim();
}

/** Prefer authoritative, scrapeable results while retaining Context.dev's relevance order. */
export function selectResearchSource(results: unknown): ResearchSource | null {
  if (!Array.isArray(results)) return null;
  const candidates = results
    .map((raw: any, index) => {
      const url = normalizedHttpUrl(raw?.url);
      if (!url) return null;
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const rootHost = [...LOW_TRUST_RESEARCH_HOSTS].find(
        (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`),
      );
      const title = typeof raw?.title === "string" && raw.title.trim() ? raw.title.trim() : null;
      const description =
        typeof raw?.description === "string" && raw.description.trim()
          ? raw.description.trim()
          : null;
      const markdown =
        raw?.markdown?.code === "SUCCESS" && typeof raw.markdown.markdown === "string"
          ? raw.markdown.markdown.trim() || null
          : null;
      const institutional = /(?:\.gov|\.edu|\.ac)(?:\.[a-z]{2})?$/.test(hostname);
      const score =
        (raw?.relevance === "high" ? 60 : raw?.relevance === "medium" ? 30 : 0) +
        (institutional ? 20 : 0) +
        (/\bofficial\b/i.test(`${title ?? ""} ${description ?? ""}`) ? 12 : 0) +
        (markdown ? 8 : 0) +
        (parsed.protocol === "https:" ? 2 : 0) -
        (rootHost ? 100 : 0) -
        index * 0.01;
      return { source: { url, title, description, markdown }, score };
    })
    .filter((entry): entry is { source: ResearchSource; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.source ?? null;
}

function discoveryGrounding(source: ResearchSource, results: any[]): string {
  const alternatives = results
    .map((result) => {
      const url = normalizedHttpUrl(result?.url);
      if (!url) return null;
      const title = typeof result?.title === "string" ? result.title.trim() : "Untitled source";
      const description =
        typeof result?.description === "string" ? result.description.trim() : "";
      return `- ${title || "Untitled source"}\n  URL: ${url}${description ? `\n  Summary: ${description}` : ""}`;
    })
    .filter((value): value is string => Boolean(value))
    .slice(0, 5)
    .join("\n");
  return [
    "Context.dev Web Search selected this primary research source:",
    `Primary source URL: ${source.url}`,
    source.title ? `Primary source title: ${source.title}` : "",
    source.description ? `Primary source summary: ${source.description}` : "",
    source.markdown ? `\nPrimary source content:\n${source.markdown.slice(0, 12_000)}` : "",
    alternatives ? `\nOther Context.dev search results for provenance:\n${alternatives}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const discover = internalAction({
  args: { query: v.string() },
  returns: v.any(),
  handler: async (ctx, { query }): Promise<{ url: string; grounding: string } | null> => {
    return await withContextLease(ctx, async () => {
      const discoveryQuery = buildContextDiscoveryQuery(query);
      const body = await post("/web/search", {
        query: `${discoveryQuery} official authoritative source`.slice(0, 500),
        numResults: 10,
        queryFanout: true,
        excludeDomains: [...LOW_TRUST_RESEARCH_HOSTS],
        markdownOptions: {
          enabled: true,
          includeLinks: true,
          useMainContentOnly: true,
          includeImages: false,
          shortenBase64Images: true,
          timeoutMS: 60000,
        },
        timeoutMS: 90000,
        tags: ["app-builder"],
      });
      if (!body) return null;
      const results = Array.isArray(body) ? body : body.results ?? body.data ?? [];
      const source = selectResearchSource(results);
      if (!source) return null;
      return {
        url: source.url,
        grounding: discoveryGrounding(source, Array.isArray(results) ? results : []),
      };
    });
  },
});

export const crawl = internalAction({
  args: { url: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { url }): Promise<string | null> => {
    const normalized = normalizedHttpUrl(url);
    if (!normalized) return null;
    const cacheKey = `research-crawl:v1:${normalized}`;
    const cached = await ctx.runQuery(internal.builds.cacheGet, { cacheKey });
    if (typeof cached === "string") return cached;
    return await withContextLease(ctx, async () => {
      const body = await post("/web/crawl", {
        url: normalized,
        maxPages: 8,
        maxDepth: 1,
        includeLinks: true,
        includeImages: false,
        shortenBase64Images: true,
        useMainContentOnly: true,
        followSubdomains: true,
        pdf: { shouldParse: true, ocr: false },
        waitForMs: 2000,
        stopAfterMs: 70000,
        timeoutMS: 90000,
        tags: ["app-builder", "research-grounding"],
      });
      const results = Array.isArray(body?.results) ? body.results : [];
      let remaining = 18_000;
      const parts: string[] = [];
      for (const result of results) {
        const markdown = typeof result?.markdown === "string" ? result.markdown.trim() : "";
        const sourceUrl = normalizedHttpUrl(
          result?.metadata?.finalUrl ?? result?.metadata?.url ?? result?.metadata?.sourceUrl,
        );
        if (!markdown || !sourceUrl || remaining <= 0) continue;
        const title =
          typeof result?.metadata?.title === "string" ? result.metadata.title.trim() : "";
        const header = `Source URL: ${sourceUrl}${title ? `\nSource title: ${title}` : ""}\n`;
        const excerpt = markdown.slice(0, Math.max(0, remaining - header.length));
        parts.push(`${header}${excerpt}`);
        remaining -= header.length + excerpt.length;
      }
      const grounding = parts.length > 0 ? parts.join("\n\n---\n\n") : null;
      if (grounding) {
        await ctx.runMutation(internal.builds.cachePut, { cacheKey, value: grounding });
      }
      return grounding;
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
