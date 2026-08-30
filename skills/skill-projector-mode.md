---
name: projector-mode
triggers: [projector, big screen, screen, display, stage, present, audience, tv]
summary: mode==="projector" big-screen layout — giant read-only aggregates for the wall, controls only on phones, one component two renders.
---

# Projector Mode — the wall shows the show, phones hold the controls

This skill is included by default for most event apps. Set `appSpec.projector: true`
whenever you implement it.

## The model

The operator can put the SAME app on a venue screen. That instance receives
`Runtime.useMode() === "projector"`; phones receive `"player"`. Same component, same
subscriptions, same live data — two renders:

| | Player (phone) | Projector (wall) |
|---|---|---|
| Purpose | act | spectate & orient the room |
| Controls | all of them | NONE — no buttons, no inputs, no host strip |
| Type scale | normal | giant — readable from 15 meters |
| Content | my state + my next action | aggregates: leaderboard, tallies, timer, presence, latest events |
| Density | one action per viewport | one message per glance |

The projector is also a real session (it has a sessionId, appears in presence). It must
never join rosters, claim things, vote, or score — gate EVERY write-triggering UI on
`mode === "player"`.

## Structure pattern

Branch once, at the end, in JSX — hooks stay unconditional at the top (React rule):

```tsx
export default function App() {
  const mode = Runtime.useMode();
  // ...ALL hooks here, both branches share them, derived data computed once...
  if (mode === "projector") return <ProjectorView /* shared derived props */ />;
  return <PlayerView /* shared derived props */ />;
}
```

Share derived data (entries, tallies, phase) between branches; don't recompute per
branch. Extract `ProjectorView` as a plain (non-hook) component in the same file when
it exceeds ~30 lines.

## Big-screen typography & layout (inline styles; no kit component is "giant" by default)

- Hero number/word: `fontSize: "clamp(64px, 18vw, 240px)"`, `fontWeight: 800`,
  `lineHeight: 1`, centered. One hero per phase — the countdown OR the winner OR the
  tally, never all three competing.
- Secondary line (what's happening / what to do): `clamp(24px, 4vw, 48px)`.
- Leaderboard: top 8–10 rows max; the kit's `Leaderboard` is fine, wrapped in a
  width-capped centered column (`maxWidth: 900, margin: "0 auto"`).
- Always visible somewhere calm (a corner strip): `PresencePill` count and a join hint —
  "Scan the QR to play" (the shell overlays the actual QR code next to the iframe; your
  job is the textual invitation, never render a QR yourself).
- Wall screens are usually dark venues — the theme handles color; avoid huge
  full-white surfaces that blind the room.
- Motion: CSS transitions on bar widths/values (300ms) make the wall feel alive; no
  animation loops that spin CPU.

## What the projector shows per phase (design this explicitly)

- **Lobby**: presence count huge + "Scan to join" + names trickling in — social proof
  is the content.
- **In play**: the shared clock (`CountdownTimer` or hero seconds), the live aggregate
  (top-5 board / tally bars / current turn's player name huge).
- **Resolution**: winner's name as the hero, final standings under it. Linger — this is
  the payoff screenshot.

## Pitfalls

1. **Projector writes**: a start button rendered on the wall gets "clicked" by nobody —
   or worse, an auto-firing effect runs on the projector session and pollutes state
   (e.g. auto-join effects). Gate all writes AND all auto-join `useEffect`s on
   `mode === "player"`.
2. **Conditional hooks**: `if (mode === "projector") { const board = useLeaderboard() }`
   crashes React. All hooks top-level, always.
3. **Phone layout on the wall**: shipping the player view scaled up reads as broken.
   The projector branch is a designed layout, not a fallback.
4. **Counting the projector as a player**: "3 playing" when it's 2 phones + the wall.
   Count roster entries (which the projector never creates), or subtract known
   non-players; presence count for "here" is fine since the wall is arguably "here".
5. **Forgetting `projector: true`** in appSpec when the branch exists — the operator's
   UI uses it to offer the projector button.

## Reference implementation — "Hype Meter"

Phones mash a hype button (atomic increments, batched); the wall shows a giant live
meter, top hypers, and a join hint. Minimal mechanic, maximal projector patterns.

`appSpec`:

```json
{
  "name": "Hype Meter",
  "description": "Mash the button — fill the meter on the big screen together.",
  "projector": true,
  "collections": {
    "hype": { "rateLimitPerMin": 600 }
  }
}
```

`appTsx`:

```tsx
import { useRef, useState } from "react";
import * as Runtime from "@runtime/sdk";
import { Screen, BigButton, Leaderboard, PresencePill, EmptyState, Stat } from "@runtime/ui";

const GOAL = 2000;

function ProjectorView(props: {
  total: number;
  presence: number;
  entries: Array<{ name: string; points: number; highlight?: boolean }>;
}) {
  const pct = Math.min(100, Math.round((props.total / GOAL) * 100));
  return (
    <Screen>
      <p style={{ textAlign: "center", fontSize: "clamp(24px, 4vw, 48px)", margin: 0, color: "var(--rt-text)" }}>
        📣 Scan the QR to add your hype
      </p>
      <p style={{
        textAlign: "center", fontWeight: 800, lineHeight: 1, margin: "8px 0",
        fontSize: "clamp(64px, 18vw, 240px)", color: "var(--rt-primary)",
      }}>
        {pct}%
      </p>
      <div style={{ maxWidth: 900, margin: "0 auto", width: "100%" }}>
        <div style={{ background: "color-mix(in srgb, var(--rt-primary) 15%, transparent)", borderRadius: "var(--rt-radius)", height: 40 }}>
          <div style={{
            width: `${pct}%`, height: "100%", borderRadius: "var(--rt-radius)",
            background: pct >= 100 ? "var(--rt-accent)" : "var(--rt-primary)",
            transition: "width 300ms",
          }} />
        </div>
        {pct >= 100 && (
          <p style={{ textAlign: "center", fontSize: "clamp(32px, 6vw, 72px)", color: "var(--rt-accent)", fontWeight: 800 }}>
            MAXIMUM HYPE 🎉
          </p>
        )}
        {props.entries.length === 0
          ? <EmptyState message="Waiting for the first tap…" />
          : <Leaderboard entries={props.entries.slice(0, 8)} />}
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
        <PresencePill count={props.presence} />
      </div>
    </Screen>
  );
}

export default function App() {
  const me = Runtime.useMe();
  const rt = Runtime.useRt();
  const mode = Runtime.useMode();
  const meter = Runtime.useDoc("hype", "meter") as { total?: number } | null;
  const board = Runtime.useLeaderboard(10);
  const presence = Runtime.usePresence();
  const [pending, setPending] = useState(0);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(0);

  const total = meter?.total ?? 0;
  const entries = board.map((e) => ({
    name: e.name,
    points: e.points,
    highlight: e.sessionId === me.sessionId,
  }));

  // Batch taps: cosmetic local count, one shared write per ~5 taps or 400ms.
  // (Batching a hot counter is UX smoothing — the store stays the truth.)
  const flush = () => {
    const n = pendingRef.current;
    pendingRef.current = 0;
    setPending(0);
    if (n > 0) {
      void rt.increment("hype", "meter", "total", n);
      void rt.addScore(me.name, n);
    }
  };
  const tap = () => {
    pendingRef.current += 1;
    setPending(pendingRef.current);
    if (pendingRef.current >= 5) {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = null;
      flush();
    } else if (!flushTimer.current) {
      flushTimer.current = setTimeout(() => { flushTimer.current = null; flush(); }, 400);
    }
  };

  if (mode === "projector") {
    return <ProjectorView total={total} presence={presence.length} entries={entries} />;
  }

  return (
    <Screen title="Hype Meter">
      <PresencePill count={presence.length} />
      <Stat label="Room hype" value={`${Math.min(100, Math.round((total / GOAL) * 100))}%`} />
      <BigButton onClick={tap}>📣 HYPE!{pending > 0 ? ` (+${pending})` : ""}</BigButton>
      <p style={{ textAlign: "center", opacity: 0.7 }}>Watch the big screen fill up.</p>
      {entries.length > 0 && <Leaderboard entries={entries.slice(0, 5)} />}
    </Screen>
  );
}
```

Adapt: every skill's reference app already carries a projector branch — this skill is
the checklist you apply to ANY app: giant hero, read-only, join hint, presence, gated
writes, `projector: true`.
