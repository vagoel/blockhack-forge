---
name: data-map
triggers: [map, location, nearby, dataset, places, distance, directory, venues]
summary: Rendering pre-loaded dataset rows — cards/list browsing, haversine nearest-sort on lat/lng, pure-CSS scatter map, no tiles.
---

# Data Map — browsing a pre-loaded dataset, with geography

## When to use

The app is built around real rows extracted from a website (venues, restaurants, talks,
products, stalls): directories, "what's near me"-style explorers, scavenger-hunt
targets, catalog browsers. The pipeline pre-loads rows when `appSpec.dataset` is set —
the app reads them with `Runtime.useDataset()` and never fetches anything.

## Hard constraints to respect

- **No map tiles.** No Google/OSM/Mapbox — external assets and fetch are forbidden.
  Geography is rendered as a pure-CSS scatter (positioned dots in a box) plus
  distance-sorted lists. This looks intentional and works offline-fast.
- **No geolocation.** `navigator.geolocation` is unavailable in the sandbox. "Near me"
  means near a REFERENCE the user picks: tap a row ("from here"), or tap a point on the
  scatter. Default reference = first row.
- **Rows are untyped** (`any[]`) and extraction is imperfect: field names vary, numbers
  arrive as strings, rows may miss fields, and the whole array may be `[]` (extraction
  failed). Defensive reading is mandatory.

## Data model recipe

- `appSpec.dataset = { name: "<dataset name from the pipeline>" }` — set this ONLY when
  the pipeline told you a dataset was extracted (its message includes the name and
  sample rows; read field names from the sample, don't guess).
- Dataset rows are read-only context. Player state (favorites, visited checkmarks,
  ratings) goes in normal collections alongside — e.g. shared checklist docs keyed by
  row index, or per-player favorites on the player's own doc.

```json
{ "dataset": { "name": "venues" }, "collections": { "visits": { "rateLimitPerMin": 60 } } }
```

## Geo toolkit (inline these)

```tsx
function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}
function latLng(row: any): { lat: number; lng: number } | null {
  const lat = num(row?.lat ?? row?.latitude ?? row?.Lat);
  const lng = num(row?.lng ?? row?.lon ?? row?.longitude ?? row?.Lng);
  return lat !== null && lng !== null ? { lat, lng } : null;
}
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, d = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d, dLng = (b.lng - a.lng) * d;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
```

Nearest sort: `rows.slice().sort((r1, r2) => dist(r1) - dist(r2))` — copy before
sorting; never mutate hook results.

**CSS scatter**: normalize each point into the bounding box of all points, position
absolutely in a fixed-aspect container, pad 8% so edge dots aren't clipped:

```tsx
const xPct = (p: {lat: number; lng: number}) =>
  8 + 84 * ((p.lng - minLng) / Math.max(maxLng - minLng, 1e-9));
const yPct = (p: {lat: number; lng: number}) =>
  8 + 84 * (1 - (p.lat - minLat) / Math.max(maxLat - minLat, 1e-9)); // lat up = screen up
```

## UX guidance

- **Cards over tables** on phones: name big, one or two secondary fields, distance badge
  when a reference is set ("1.2 km").
- The scatter is an overview, not navigation: dots (44px hit area via padded buttons),
  highlight selected + reference, label only the selected dot — 50 labels is soup.
- Search/filter with a simple `Input` over name fields — client-side `includes` on
  lowercase.
- Formats: `d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km``.
- Missing-geo rows still appear in the list (sorted last, no badge) — never silently
  drop data.
- Empty dataset ⇒ a real message ("Couldn't load the venue list — tell the organizer"),
  not a blank screen.

## Pitfalls

1. **Guessed field names.** Read the pipeline's sample rows. The `latLng` helper's
   alias chain covers common cases; extend it from the actual sample.
2. **String coordinates** — `"51.5" - "0.1"` is NaN-land. Always route numbers through
   `num()`.
3. **Degenerate bounds**: all rows in one spot ⇒ divide-by-zero in normalization — the
   `Math.max(span, 1e-9)` guard above is mandatory.
4. **Sorting in place** re-orders the hook's array for the next render. `slice()` first.
5. **300/500-row caps don't apply to datasets**, but rendering 1000 cards will jank a
   phone — cap the visible list (~40) and let search narrow it.

## Reference implementation — "Coffee Crawl"

Dataset of cafés; pick a reference café, everything sorts by distance; scatter overview;
the room collectively checks off visited spots. Demonstrates defensive reads, haversine
sort, CSS scatter, shared state alongside a dataset.

`appSpec`:

```json
{
  "name": "Coffee Crawl",
  "description": "Explore the café list, sort by what's near, and check spots off together.",
  "projector": true,
  "dataset": { "name": "cafes" },
  "collections": {
    "visits": { "rateLimitPerMin": 60 }
  }
}
```

`appTsx`:

```tsx
import { useMemo, useState } from "react";
import * as Runtime from "@runtime/sdk";
import { Screen, Card, Input, PresencePill, EmptyState, Stat, Grid } from "@runtime/ui";

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}
function latLng(row: any): { lat: number; lng: number } | null {
  const lat = num(row?.lat ?? row?.latitude ?? row?.Lat);
  const lng = num(row?.lng ?? row?.lon ?? row?.longitude ?? row?.Lng);
  return lat !== null && lng !== null ? { lat, lng } : null;
}
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, d = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d, dLng = (b.lng - a.lng) * d;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const fmtKm = (d: number) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`);

export default function App() {
  const rt = Runtime.useRt();
  const mode = Runtime.useMode();
  const rows = Runtime.useDataset();
  const visits = Runtime.useDocs("visits"); // key = row index, data = {count}
  const presence = Runtime.usePresence();
  const [refIdx, setRefIdx] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const items = useMemo(
    () => rows.map((row, idx) => ({ idx, row, pos: latLng(row), name: String(row?.name ?? row?.title ?? `Spot ${idx + 1}`) })),
    [rows]
  );
  const geo = items.filter((i) => i.pos !== null);
  const ref = refIdx !== null ? items.at(refIdx) ?? null : geo.at(0) ?? null;

  const bounds = useMemo(() => {
    if (geo.length === 0) return null;
    const lats = geo.map((i) => i.pos!.lat), lngs = geo.map((i) => i.pos!.lng);
    return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
  }, [items]);

  const visited = new Set(visits.filter((v) => (v.data?.count ?? 0) > 0).map((v) => v.key));
  const q = query.trim().toLowerCase();
  const sorted = items
    .filter((i) => q === "" || i.name.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => {
      if (!ref?.pos) return a.idx - b.idx;
      const da = a.pos ? haversineKm(ref.pos, a.pos) : Infinity;
      const db = b.pos ? haversineKm(ref.pos, b.pos) : Infinity;
      return da - db;
    })
    .slice(0, 40);

  const checkOff = (idx: number) => void rt.increment("visits", String(idx), "count", 1);

  if (rows.length === 0) {
    return (
      <Screen title="Coffee Crawl">
        <EmptyState message="The café list didn't load — grab the organizer!" />
      </Screen>
    );
  }

  const scatter = bounds && geo.length > 1 && (
    <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", background: "var(--rt-surface)", borderRadius: "var(--rt-radius)", overflow: "hidden" }}>
      {geo.map((i) => {
        const x = 8 + 84 * ((i.pos!.lng - bounds.minLng) / Math.max(bounds.maxLng - bounds.minLng, 1e-9));
        const y = 8 + 84 * (1 - (i.pos!.lat - bounds.minLat) / Math.max(bounds.maxLat - bounds.minLat, 1e-9));
        const isRef = i.idx === ref?.idx;
        return (
          <button
            key={i.idx}
            onClick={() => setRefIdx(i.idx)}
            aria-label={i.name}
            style={{
              position: "absolute", left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)",
              width: 44, height: 44, background: "transparent", border: "none", padding: 0,
            }}
          >
            <span style={{
              display: "block", margin: "auto", width: isRef ? 18 : 12, height: isRef ? 18 : 12,
              borderRadius: "50%", background: isRef ? "var(--rt-accent)" : visited.has(String(i.idx)) ? "var(--rt-secondary)" : "var(--rt-primary)",
            }} />
          </button>
        );
      })}
      {ref && (
        <span style={{ position: "absolute", left: 8, bottom: 6, fontSize: 12, opacity: 0.8 }}>
          ★ sorting from: {ref.name}
        </span>
      )}
    </div>
  );

  const list = sorted.map((i) => {
    const d = ref?.pos && i.pos ? haversineKm(ref.pos, i.pos) : null;
    const done = visited.has(String(i.idx));
    return (
      <Card key={i.idx} title={`${done ? "✅ " : ""}${i.name}`}>
        <p style={{ margin: "4px 0", opacity: 0.8 }}>
          {String(i.row?.address ?? i.row?.area ?? "")} {d !== null && <strong> · {fmtKm(d)}</strong>}
        </p>
        {mode === "player" && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setRefIdx(i.idx)} style={{ minHeight: 44, flex: 1, background: "var(--rt-surface)", color: "var(--rt-text)", border: "1px solid var(--rt-secondary)", borderRadius: "var(--rt-radius)" }}>
              Sort from here
            </button>
            <button onClick={() => checkOff(i.idx)} style={{ minHeight: 44, flex: 1, background: "var(--rt-primary)", color: "var(--rt-text)", border: "none", borderRadius: "var(--rt-radius)" }}>
              {done ? "Visited again +1" : "Check off ✓"}
            </button>
          </div>
        )}
      </Card>
    );
  });

  return (
    <Screen title="Coffee Crawl">
      <PresencePill count={presence.length} />
      <Grid cols={2}>
        <Stat label="Cafés" value={rows.length} />
        <Stat label="Visited by the room" value={visited.size} />
      </Grid>
      {scatter}
      {mode === "player" && <Input value={query} onChange={setQuery} placeholder="Search cafés…" />}
      {list.length === 0 ? <EmptyState message="No matches — clear the search?" /> : list}
    </Screen>
  );
}
```

Adapt: scavenger hunt = check-offs become per-team claims; conference talks = no geo,
sort by a time field instead of distance (same defensive `num()` reads); product catalog
= favorites on the player's own doc plus a "most-favorited" tally via `increment`.
