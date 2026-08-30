const MAX_STYLE_CHARS = 7_000;
const MAX_OUTLINE_NODES = 180;
const MAX_VALUE_CHARS = 180;

function compact(value: string, max = MAX_VALUE_CHARS): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function htmlAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match ? compact(match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function styleBlocks(html: string): string {
  const blocks: string[] = [];
  let used = 0;
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\bcontent\s*:\s*[^;{}]+;?/gi, "")
      .replace(/data:[^)'"\s]+/gi, "data:omitted")
      .replace(/\s+/g, " ")
      .trim();
    if (!css) continue;
    const remaining = MAX_STYLE_CHARS - used;
    if (remaining <= 0) break;
    blocks.push(css.slice(0, remaining));
    used += Math.min(css.length, remaining);
  }
  return blocks.join("\n");
}

function cssVariables(html: string): string[] {
  const variables: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/(--[A-Za-z0-9_-]{1,80})\s*:\s*([^;}{]{1,240})/g)) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    variables.push(`${name}: ${compact(match[2])}`);
    if (variables.length >= 80) break;
  }
  return variables;
}

function stylesheetLinks(html: string, sourceUrl: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attributes = match[1];
    if (!/\bstylesheet\b/i.test(htmlAttribute(attributes, "rel") ?? "")) continue;
    const href = htmlAttribute(attributes, "href");
    if (!href) continue;
    try {
      const resolved = new URL(href, sourceUrl).toString();
      if (!/^https?:\/\//i.test(resolved) || seen.has(resolved)) continue;
      seen.add(resolved);
      links.push(resolved.slice(0, 300));
    } catch {
      continue;
    }
    if (links.length >= 20) break;
  }
  return links;
}

function structureOutline(html: string): string[] {
  const withoutExecutableContent = html
    .replace(/<(script|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const nodes: string[] = [];
  const tags =
    /<(header|nav|main|section|article|aside|footer|form|button|input|textarea|select|h1|h2|h3|ul|ol|li|div)\b([^>]*)>/gi;
  for (const match of withoutExecutableContent.matchAll(tags)) {
    const tag = match[1].toLowerCase();
    const attributes = match[2];
    const details: string[] = [];
    for (const name of ["id", "class", "role", "type"]) {
      const value = htmlAttribute(attributes, name);
      if (value) details.push(`${name}="${value.replace(/["<>]/g, "")}"`);
    }
    if (tag === "div" && details.length === 0) continue;
    nodes.push(`<${tag}${details.length > 0 ? ` ${details.join(" ")}` : ""}>`);
    if (nodes.length >= MAX_OUTLINE_NODES) break;
  }
  return nodes;
}

/**
 * Turn Context.dev's rendered HTML into bounded, design-only grounding.
 * Scripts and page copy are deliberately excluded: Devin needs visual structure,
 * not instructions or content copied from the reference site.
 */
export function summarizeRenderedSource(
  html: string,
  sourceUrl: string,
  title?: string | null,
): string | null {
  if (!html.trim()) return null;
  const variables = cssVariables(html);
  const styles = styleBlocks(html);
  const links = stylesheetLinks(html, sourceUrl);
  const outline = structureOutline(html);
  if (variables.length === 0 && !styles && links.length === 0 && outline.length === 0) {
    return null;
  }

  const sections = [
    `Source URL: ${sourceUrl}`,
    title ? `Page title: ${compact(title, 240)}` : "",
    variables.length > 0 ? `CSS variables:\n${variables.join("\n")}` : "",
    links.length > 0 ? `Stylesheets:\n${links.join("\n")}` : "",
    styles ? `Rendered inline CSS excerpt:\n${styles}` : "",
    outline.length > 0 ? `Rendered DOM structure (text removed):\n${outline.join("\n")}` : "",
  ].filter(Boolean);
  return sections.join("\n\n").slice(0, 14_000);
}
