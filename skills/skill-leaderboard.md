---
name: leaderboard
triggers: [leaderboard, score, scores, points, ranking, winner, compete, standings]
summary: Points and standings — setScore/addScore semantics, useLeaderboard rendering, highlight-self, rank movement UX.
---

# Leaderboard — points, standings, winners

## When to use

Any competitive app: races, trivia, challenges, streaks, "who's winning" overlays on top
of another mechanic. The scores table is built into the platform — never rebuild it out
of docs or lists.

## API semantics (exact)

- `rt.addScore(name, delta): Promise<number>` — atomic add, returns the player's new
  total. One row per session (keyed by sessionId server-side); the `name` you pass
  becomes the display name on the row (pass `Runtime.useMe().name`, or `""` to fall back
  to it). Use for all "+N points" awards; safe under concurrency.
- `rt.setScore(name, points): Promise<null>` — absolute overwrite. Use for reset-to-zero
  flows or "your score IS x" games (closest-guess). Racing `setScore` from multiple
  places loses writes — prefer `addScore` whenever the change is relative.
- `Runtime.useLeaderboard(top?)` → `Array<{sessionId, name, points}>` sorted descending,
  `[]` while loading/empty. `top` caps rows (fetch a few more than you display if you
  also need the current player's row when they're outside the top).

## Data model recipe

Scores rarely need a spec guard (they're not a collection), but every mechanic that
GRANTS points must be race-safe so points can't be farmed:

- Award points only from writes that atomically succeeded: `claim` returned
  `claimed: true`, `push` returned `ok: true`, a correct-answer ballot `claim` won.
  Never award from a plain button that could be double-tapped.
- If a single tap = 1 point (tap races), `addScore` itself is the atomic act — fine.

```json
{ "meta": { "rateLimitPerMin": 10 } }
```

(plus whatever collections the underlying game uses).

## UX guidance

- **Always highlight self**: map `sessionId === me.sessionId` to `highlight: true` in
  `Leaderboard` entries. Seeing yourself climb is the core loop.
- **Show my score big** (`Stat`) even when I'm not on the visible top-N.
- **Empty state sells the game**: "No scores yet — first point takes the lead" beats a
  blank table.
- **Medals read better than numbers**: prefix top three with 🥇🥈🥉 in the name string if
  you render custom rows; the kit's `Leaderboard` handles plain ranked display.
- **Ties are fine** — descending sort is stable enough; don't build tiebreakers unless
  the game demands one (then use earliest-scorer via a claim on the winning moment).
- On projector, the leaderboard IS the show: top 10, huge, plus presence count.

## Pitfalls

1. **Read-modify-write**: never `setScore(name, current + 10)` from client-read state —
   two awards interleave and one is lost. `addScore(name, 10)`.
2. **Renames**: each score write updates the row's display name; a player who edits
   their name mid-game keeps their points (sessionId key) — always pass the CURRENT
   `me.name`, never a cached one.
3. **Negative totals**: `addScore` happily goes below zero. Clamp in the UI or accept
   it as part of the game — decide, don't be surprised.
4. **Projector scoring**: the projector instance has a sessionId too — make sure it
   never runs score-granting code paths (gate awards behind `mode === "player"`).

## Reference implementation — "Streak Trivia"

Self-serve trivia: fixed questions, each player advances at their own pace; correct =
+100 × streak multiplier. Demonstrates addScore, highlight-self, per-player progress
docs, projector standings.

`appSpec`:

```json
{
  "name": "Streak Trivia",
  "description": "Answer at your own pace — streaks multiply your points.",
  "projector": true,
  "collections": {
    "progress": { "rateLimitPerMin": 60 }
  }
}
```

`appTsx`:

```tsx
import { useState } from "react";
import * as Runtime from "@runtime/sdk";
import { Screen, Card, BigButton, Leaderboard, PresencePill, Stat, EmptyState, Grid } from "@runtime/ui";

const QUESTIONS = [
  { q: "Which planet has the most moons?", opts: ["Earth", "Saturn", "Mars", "Venus"], a: 1 },
  { q: "What does 'HTTP' start with?", opts: ["Hyper", "Host", "High", "Hard"], a: 0 },
  { q: "Octopuses have how many hearts?", opts: ["1", "2", "3", "8"], a: 2 },
  { q: "The Great Wall is mostly in…", opts: ["Japan", "Mongolia", "China", "Korea"], a: 2 },
  { q: "Which is NOT a primary color of light?", opts: ["Red", "Green", "Yellow", "Blue"], a: 2 },
];

type Progress = { idx: number; streak: number };

export default function App() {
  const me = Runtime.useMe();
  const rt = Runtime.useRt();
  const mode = Runtime.useMode();
  const board = Runtime.useLeaderboard(10);
  const presence = Runtime.usePresence();
  const progress = (Runtime.useDoc("progress", me.sessionId) as Progress | null) ?? { idx: 0, streak: 0 };
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const finished = progress.idx >= QUESTIONS.length;
  const q = finished ? null : QUESTIONS.at(progress.idx);
  const myRow = board.find((e) => e.sessionId === me.sessionId);

  const answer = async (choice: number) => {
    if (!q || busy) return;
    setBusy(true);
    const correct = choice === q.a;
    const nextStreak = correct ? progress.streak + 1 : 0;
    // Own-key doc: only this device writes it, so set() is race-free here.
    await rt.set("progress", me.sessionId, { idx: progress.idx + 1, streak: nextStreak });
    if (correct) {
      const pts = 100 * nextStreak;
      const total = await rt.addScore(me.name, pts); // atomic award
      setFlash(`Correct! +${pts} (streak ×${nextStreak}) — total ${total}`);
    } else {
      setFlash("Nope — streak reset. Next one's yours.");
    }
    setBusy(false);
  };

  const entries = board.map((e, i) => ({
    name: `${i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : ""}${e.name}`,
    points: e.points,
    highlight: e.sessionId === me.sessionId,
  }));
  const standings = entries.length === 0
    ? <EmptyState message="No scores yet — first correct answer takes the lead!" />
    : <Leaderboard entries={entries} />;

  if (mode === "projector") {
    return (
      <Screen title="Streak Trivia — Standings">
        <PresencePill count={presence.length} />
        {standings}
      </Screen>
    );
  }

  return (
    <Screen title="Streak Trivia">
      <PresencePill count={presence.length} />
      <Grid cols={2}>
        <Stat label="Your points" value={myRow?.points ?? 0} />
        <Stat label="Streak" value={`×${progress.streak}`} />
      </Grid>
      {flash && <p style={{ textAlign: "center", color: "var(--rt-accent)" }}>{flash}</p>}
      {q && (
        <Card title={`Q${progress.idx + 1} of ${QUESTIONS.length}: ${q.q}`}>
          <Grid cols={1}>
            {q.opts.map((opt, i) => (
              <BigButton key={i} onClick={() => void answer(i)} disabled={busy}>
                {opt}
              </BigButton>
            ))}
          </Grid>
        </Card>
      )}
      {finished && (
        <Card title="All done!">
          <p style={{ textAlign: "center" }}>You finished with {myRow?.points ?? 0} points. Watch the board.</p>
        </Card>
      )}
      {standings}
    </Screen>
  );
}
```

Adapt: any game grants points the same way — swap the question loop for the game's
success events, keep the award-on-atomic-success rule. Synchronized (host-paced) quizzes
belong to the quiz-poll skill; this skill supplies the scoring layer.
