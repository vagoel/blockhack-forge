---
name: timers
triggers: [timer, countdown, seconds, deadline, rounds, time limit, buzzer, stopwatch]
summary: Server-authoritative countdowns — startTimer/useTimer semantics, recoverable coordination, fired-driven phase changes, multi-round keys.
---

# Timers — one clock everyone agrees on

## When to use

Anything with a shared deadline: round-based games, auction closes, "answer within 20s",
lightning rounds, pomodoro-with-the-room, reaction-time games. The defining problem:
phone clocks disagree and JS timers drift, so game phase must NEVER change based on a
local clock — only on shared server state.

## Exact semantics

```ts
rt.startTimer(key, ms)                 // writes doc "timers"/key = {endsAt: serverNow+ms, fired: false}
Runtime.useTimer(key)                  // → {endsAt: number|null, fired: boolean, remainingMs: number}
```

- `endsAt === null` ⇒ this timer was never started. This is your "not yet begun" phase
  test — no extra "started" flag needed.
- `remainingMs` ticks down locally (~4×/s) toward the server `endsAt`. It is for
  DISPLAY. It may hit 0 slightly before/after the authoritative end.
- `fired` flips to `true` by a server-side scheduled job at the deadline — the same
  moment for every client. `fired` is the ONLY correct trigger for phase transitions
  (close bidding, end round, reveal answer).
- `startTimer` on an existing key RE-STARTS it (upsert overwrites `endsAt`, resets
  `fired`). This enables deliberate restarts (next round on the same key) and is also
  the footgun — see pitfalls.
- The `timers` collection is reserved for this mechanism; never store app data in it.
  No spec guard entry needed for `timers`.

## Core patterns

**Claim-coordinated starter** (the claim and timer start are separate transactions):

```tsx
const gate = await rt.claim("meta", "starter-round1", { sessionId: me.sessionId });
if (timer.endsAt === null && (gate.claimed || gate.data?.sessionId === me.sessionId)) {
  await rt.startTimer("round1", 60_000); // elected device may retry only while observed absent
}
```

Never call that pair exactly-once. If the elected device disappears between calls, the
timer can remain absent; for high-reliability flows, avoid the election or require a
backend composite mutation that this Runtime does not expose.

**Phase from timer state** (no extra phase doc needed for simple round games):

```tsx
const timer = Runtime.useTimer("round1");
const phase = timer.endsAt === null ? "lobby" : timer.fired ? "done" : "running";
```

**Multi-round keys**: give every round its own timer key (`round-${n}`) with the round
number `n` in a doc advanced by `claim`/`cas`. Distinct keys mean a stale `fired: true`
from round 2 can never end round 3.

**Act-on-fire race** (first tap after the buzzer wins): combine with `claim` —

```tsx
if (timer.fired) {
  const res = await rt.claim("wins", `round-${n}`, { sessionId: me.sessionId, name: me.name });
  if (res.claimed) await rt.addScore(me.name, 3);
}
```

The winner claim is authoritative; the later score award is best-effort because it is a
second transaction. For results that must never diverge, derive wins/points from the
claimed winner documents instead of maintaining a separate leaderboard side effect.

**Display**: `Math.ceil(remainingMs / 1000)` for seconds (never `floor` — showing "0"
while running feels broken), or the kit's `CountdownTimer {endsAt}` for a big clock.
Note `CountdownTimer`'s `onEnd` is cosmetic — phase still changes on `fired`.

## Pitfalls

1. **`setTimeout` state machines**: a local `setTimeout(() => setPhase("done"), 60000)`
   ends the game at 50 different moments on 50 phones and breaks for late joiners.
   Delete the thought. Cosmetic animation timers only.
2. **Uncoordinated `startTimer`**: N players tapping "start" = N restarts, the deadline
   creeps forward. A host check or per-round claim reduces that race, but claim + timer
   remains two calls and needs a recoverable absent-timer state.
3. **`remainingMs === 0` as end-of-round**: it's a display value; a client with a fast
   clock ends early, a throttled background tab ends late. Branch on `fired`.
4. **Reusing one key across rounds without a round counter**: after `startTimer("round")`
   for round 2, clients still rendering round 1 see `fired` reset and get confused.
   Prefer `round-${n}` keys tied to a shared round doc.
5. **Very short timers** (<2s): scheduling granularity plus network latency makes
   sub-2-second timers feel random — keep buzzers ≥3s and design around reveal moments,
   not frame-perfect timing.

## Reference implementation — "Quick Draw"

Reaction duel: a round is armed, the buzzer fires after a fixed fuse, first tap AFTER
the buzzer scores 3; tapping early costs 1. Multi-round via `meta/round` + per-round
keys. Demonstrates every pattern above.

`appSpec`:

```json
{
  "name": "Quick Draw",
  "description": "Wait for the buzzer — first tap after it wins the round.",
  "projector": true,
  "collections": {
    "meta": { "rateLimitPerMin": 30 },
    "wins": { "rateLimitPerMin": 30 }
  }
}
```

`appTsx`:

```tsx
import { useState } from "react";
import * as Runtime from "@runtime/sdk";
import { Screen, Card, BigButton, Leaderboard, PresencePill, Stat, EmptyState } from "@runtime/ui";

const FUSE_MS = 5_000;

export default function App() {
  const me = Runtime.useMe();
  const rt = Runtime.useRt();
  const mode = Runtime.useMode();
  const roundDoc = Runtime.useDoc("meta", "round") as { n: number } | null;
  const n = roundDoc?.n ?? 0;
  const timer = Runtime.useTimer(`round-${n}`);
  const win = Runtime.useDoc("wins", `round-${n}`) as { sessionId: string; name: string } | null;
  const board = Runtime.useLeaderboard(10);
  const presence = Runtime.usePresence();
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const armed = timer.endsAt !== null && !timer.fired; // fuse burning — do NOT tap
  const live = timer.fired && win === null;            // buzzer fired, nobody has won yet
  const decided = timer.fired && win !== null;
  const idle = timer.endsAt === null;

  const arm = async () => {
    setBusy(true);
    // Claim coordination is separate from startTimer; allow this elected device to retry.
    const gate = await rt.claim("meta", `starter-${n}`, { sessionId: me.sessionId });
    if (timer.endsAt === null && (gate.claimed || gate.data?.sessionId === me.sessionId)) {
      await rt.startTimer(`round-${n}`, FUSE_MS);
    }
    setBusy(false);
  };

  const draw = async () => {
    if (busy) return;
    setBusy(true);
    if (armed) {
      await rt.addScore(me.name, -1); // jumped the gun
      setFlash("Too early! -1");
    } else if (timer.fired) {
      const res = await rt.claim("wins", `round-${n}`, { sessionId: me.sessionId, name: me.name });
      if (res.claimed) {
        await rt.addScore(me.name, 3);
        setFlash("You won the draw! +3");
      } else {
        setFlash(`${res.data?.name ?? "Someone"} was faster.`);
      }
    }
    setBusy(false);
  };

  const nextRound = async () => {
    setBusy(true);
    // Advance the round counter exactly once even if many tap "next".
    if (roundDoc === null) {
      await rt.claim("meta", "round", { n: 1 });
    } else {
      await rt.cas("meta", "round", roundDoc, { n: roundDoc.n + 1 }); // losers no-op
    }
    setFlash(null);
    setBusy(false);
  };

  const entries = board.map((e) => ({ name: e.name, points: e.points, highlight: e.sessionId === me.sessionId }));
  const standings = entries.length === 0
    ? <EmptyState message="No draws yet — arm the first round!" />
    : <Leaderboard entries={entries} />;

  if (mode === "projector") {
    return (
      <Screen title="Quick Draw">
        <PresencePill count={presence.length} />
        <Stat label={`Round ${n + 1}`} value={idle ? "Waiting" : armed ? "Steady…" : decided ? `${win?.name} wins!` : "DRAW!"} />
        {standings}
      </Screen>
    );
  }

  return (
    <Screen title="Quick Draw">
      <PresencePill count={presence.length} />
      <Stat label={`Round ${n + 1}`} value={idle ? "Not armed" : armed ? "Steady…" : decided ? "Decided" : "DRAW NOW"} />
      {flash && <p style={{ textAlign: "center", color: "var(--rt-accent)" }}>{flash}</p>}
      {idle && (
        <>
          <p style={{ textAlign: "center" }}>Arm the round. Buzzer fires in {FUSE_MS / 1000}s. First tap after it wins.</p>
          <BigButton onClick={arm} disabled={busy}>Arm the round</BigButton>
        </>
      )}
      {(armed || live) && (
        <BigButton onClick={draw} disabled={busy} variant={live ? "primary" : "danger"}>
          {armed ? "Wait for it…" : "DRAW!"}
        </BigButton>
      )}
      {decided && (
        <Card title={`${win?.name}${win?.sessionId === me.sessionId ? " (you!)" : ""} won round ${n + 1}`}>
          <BigButton variant="secondary" onClick={nextRound} disabled={busy}>Next round</BigButton>
        </Card>
      )}
      {standings}
    </Screen>
  );
}
```

Adapt: replace the "draw" claim with any post-deadline action (final answers lock,
bidding closes, reveal happens). The skeleton — per-round keys, claim-elected start,
`fired`-driven phases, CAS round advance — transfers unchanged.
