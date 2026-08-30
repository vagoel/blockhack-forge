---
name: theming
triggers: [theme, brand, branded, colors, style, logo, look, design]
core: true
priority: 80
summary: How theme flows (appSpec.theme → CSS vars → UI kit), when to leave theme unset, live retheme, using logoUrl safely.
---

# Theming — one theme pipeline, zero hardcoded colors

This skill is always included. Follow it in every app, themed or not.

## How theme flows (the whole pipeline)

1. `appSpec.theme` (optional) seeds the app's stored theme; the operator can overwrite
   it at any time ("make it look like acme.com" extracts brand tokens live).
2. The runtime sets CSS variables on the iframe root and keeps them updated reactively:
   `--rt-primary`, `--rt-secondary`, `--rt-background`, `--rt-surface`, `--rt-text`,
   `--rt-accent`, `--rt-radius`, `--rt-font`.
3. Every `@runtime/ui` component styles itself from those variables automatically.
4. Your custom markup joins the system by referencing the SAME variables in inline
   styles. `Runtime.useTheme()` returns the live theme object for the rare JS-side needs
   (`logoUrl`, conditional layout).

Consequence: an app written entirely against the variables re-themes live — mid-session,
no reload — when the operator changes the theme. An app with hardcoded hex values
becomes a mismatched clown suit the moment that happens.

## Rules

- **Never hardcode colors, radii, or font stacks** in custom markup. Use the variables:

```tsx
<div style={{
  background: "var(--rt-surface)",
  color: "var(--rt-text)",
  borderRadius: "var(--rt-radius)",
  fontFamily: "var(--rt-font)",
}} />
```

- **Variable roles**: `background` = page; `surface` = cards/inputs (one step up);
  `primary` = the main action & filled emphasis; `secondary` = supporting
  actions/borders; `accent` = highlights, notices, "look here" moments (use sparingly —
  it's the loudest color); `text` = readable on background AND surface.
- **Exceptions that MAY bypass the theme**: semantically-colored game elements — team
  red/blue, traffic-light status, per-player identity hues derived from sessionId.
  These carry meaning the theme must not override. Everything decorative stays on
  variables.
- **Derived tints** without extra tokens: `color-mix(in srgb, var(--rt-primary) 25%, transparent)`
  for subtle fills, or opacity on the element. Don't invent parallel palettes.

## When to SET appSpec.theme — and when to leave it unset

Leave `theme` **unset** (the default) when the user didn't mention branding: the
platform's polished defaults apply, and the operator's retheme flow owns the look
without fighting spec values.

Set it only when the request names an aesthetic ("spooky halloween game", "make it hot
pink", "corporate navy") — then set ONLY the fields you mean; unset fields fall back to
defaults:

```json
{ "theme": { "primary": "#7c3aed", "background": "#0d0a14", "accent": "#22d3ee" } }
```

Requirements when you do: dark-background palettes read best in venues; `text` must
have ≥4.5:1 contrast on both `background` and `surface`; check `primary` is visible on
`background`. Never set `logoUrl` yourself — it arrives from brand extraction.

## Using logoUrl

`useTheme().logoUrl` is the ONE permitted external asset. It may be absent — always
render conditionally with constrained size, and never build layout that collapses
without it:

```tsx
const theme = Runtime.useTheme();
{theme.logoUrl && (
  <img src={theme.logoUrl} alt="" style={{ maxHeight: 48, maxWidth: 160, objectFit: "contain" }} />
)}
```

Good placements: header of the first screen, projector corner. One instance, not a
watermark on everything.

## Pitfalls

1. Hardcoding `#fff` text "because the default background is dark" — an operator
   retheme to light background makes it invisible. `var(--rt-text)`.
2. Reading `useTheme()` to copy values into inline styles (`color: theme.primary`) —
   works but misses nothing the variable doesn't do, and adds a render dependency. Use
   the CSS variable; reserve the hook for `logoUrl` and JS logic.
3. Fixed light-gray borders/shadows (`#eee`) that vanish or glare across themes — use
   `var(--rt-secondary)` at reduced opacity, or `color-mix` with the surface.
4. Setting all 8 theme fields "for completeness" — you freeze the app's look and fight
   the operator. Set the minimum that expresses the request.

## Reference implementation — "Vibe Check"

A deliberately theme-forward mini app: logo header, mood buttons tallied live, custom
bars — every custom pixel on theme variables, so a live retheme restyles everything.

`appSpec` (user asked for "a chill purple vibe"):

```json
{
  "name": "Vibe Check",
  "description": "Tap the mood of the room and watch it shift live.",
  "projector": true,
  "theme": { "primary": "#8b5cf6", "background": "#12101a", "accent": "#f0abfc" },
  "collections": {
    "moods": { "rateLimitPerMin": 60 }
  }
}
```

`appTsx`:

```tsx
import * as Runtime from "@runtime/sdk";
import { Screen, Card, BigButton, PresencePill, EmptyState, Grid } from "@runtime/ui";

const MOODS = [
  { key: "hyped", label: "🔥 Hyped" },
  { key: "chill", label: "😌 Chill" },
  { key: "curious", label: "🤔 Curious" },
  { key: "sleepy", label: "🥱 Sleepy" },
];

export default function App() {
  const rt = Runtime.useRt();
  const mode = Runtime.useMode();
  const theme = Runtime.useTheme();
  const tally = Runtime.useDoc("moods", "tally") as Record<string, number> | null;
  const presence = Runtime.usePresence();

  const counts = MOODS.map(
    (m) => Number(Object.entries(tally ?? {}).find(([key]) => key === m.key)?.at(1) ?? 0)
  );
  const total = counts.reduce((a, b) => a + b, 0);
  const top = total > 0 ? MOODS[counts.indexOf(Math.max(...counts))] : null;

  const vote = (key: string) => void rt.increment("moods", "tally", key, 1);

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center" }}>
      {theme.logoUrl && (
        <img src={theme.logoUrl} alt="" style={{ maxHeight: 40, maxWidth: 140, objectFit: "contain" }} />
      )}
      <span style={{ fontFamily: "var(--rt-font)", color: "var(--rt-accent)", fontWeight: 700 }}>
        how's the room feeling?
      </span>
    </div>
  );

  const bars = total === 0 ? (
    <EmptyState message="No vibes registered yet. Concerning." />
  ) : (
    <div style={{ display: "grid", gap: 10 }}>
      {MOODS.map((m, i) => (
        <div key={m.key}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--rt-text)" }}>
            <span>{m.label}</span>
            <strong>{counts.at(i)}</strong>
          </div>
          {/* Track and fill both from theme vars — retheme restyles this live. */}
          <div style={{ background: "color-mix(in srgb, var(--rt-primary) 18%, transparent)", borderRadius: "var(--rt-radius)" }}>
            <div style={{
              width: `${Math.max(4, Math.round(((counts.at(i) ?? 0) / total) * 100))}%`,
              height: 26,
              background: m === top ? "var(--rt-accent)" : "var(--rt-primary)",
              borderRadius: "var(--rt-radius)",
              transition: "width 300ms, background 300ms",
            }} />
          </div>
        </div>
      ))}
    </div>
  );

  if (mode === "projector") {
    return (
      <Screen title="Vibe Check">
        {header}
        <PresencePill count={presence.length} />
        {top && (
          <p style={{ textAlign: "center", fontSize: 40, color: "var(--rt-text)", margin: "8px 0" }}>
            {top.label}
          </p>
        )}
        {bars}
      </Screen>
    );
  }

  return (
    <Screen title="Vibe Check">
      {header}
      <PresencePill count={presence.length} />
      <Card title="Tap your current mood (as often as it changes)">
        <Grid cols={2}>
          {MOODS.map((m) => (
            <BigButton key={m.key} onClick={() => vote(m.key)}>{m.label}</BigButton>
          ))}
        </Grid>
      </Card>
      <Card title="The room right now">{bars}</Card>
    </Screen>
  );
}
```

Note what is NOT here: zero hex values in the TSX (the palette lives in `appSpec.theme`
where the operator can override it), `logoUrl` conditional, `color-mix` for the tint. A
retheme to corporate navy restyles every pixel of this app without touching code.
