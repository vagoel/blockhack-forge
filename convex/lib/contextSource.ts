const URL_RE = /https?:\/\/[^\s)"'<>\]]+/gi;
const SOURCE_CUE_RE =
  /\b(from|source|reference|ground|grounding|style|styled|brand|branding|based on|website|research url|data url)\b/i;
const PROVIDER_API_HOSTS = new Set([
  "api.context.dev",
  "api.devin.ai",
  "api.openai.com",
]);

function normalizeUrl(value: string): string | null {
  const cleaned = value.trim().replace(/[.,;:!?]+$/, "");
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function isProviderEndpoint(url: string): boolean {
  const parsed = new URL(url);
  return PROVIDER_API_HOSTS.has(parsed.hostname.toLowerCase()) ||
    (parsed.hostname.toLowerCase() === "context.dev" && /^\/v\d+\//i.test(parsed.pathname));
}

/** Resolve a user-facing source URL without mistaking provider API examples for sources. */
export function resolveContextSourceUrl(
  prompt: string,
  explicitUrl?: string | null,
): string | null {
  if (explicitUrl) return normalizeUrl(explicitUrl);
  const candidates = [...prompt.matchAll(URL_RE)]
    .map((match, index) => {
      const url = normalizeUrl(match[0]);
      if (!url) return null;
      const start = Math.max(0, (match.index ?? 0) - 120);
      const end = Math.min(prompt.length, (match.index ?? 0) + match[0].length + 80);
      const nearby = prompt.slice(start, end);
      const score =
        (SOURCE_CUE_RE.test(nearby) ? 80 : 0) +
        (url.startsWith("https://") ? 5 : 0) -
        (isProviderEndpoint(url) ? 200 : 0) -
        index * 0.01;
      return { url, score };
    })
    .filter((candidate): candidate is { url: string; score: number } => candidate !== null)
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.url ?? null;
}
