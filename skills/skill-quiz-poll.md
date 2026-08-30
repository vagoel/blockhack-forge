---
name: quiz-poll
triggers: [quiz, poll, vote, voting, trivia, survey, question, ballot]
summary: Host-paced quizzes and live polls — increment tallies per option, claim-based one-vote-per-player, phase docs, CSS bar results.
---

# Quiz & Poll — synchronized questions, honest tallies

## When to use

Live audience voting where everyone answers the SAME question at the same time: polls,
host-paced trivia, "this or that", award voting, retro dot-voting. Two invariants:
(1) tallies must be exact under 50 simultaneous taps, (2) one vote per player per
question. (Self-paced trivia where players advance independently is the leaderboard
skill instead.)

## Data model recipe

- **Questions**: hardcode in the TSX (generate them from the user's topic). No doc needed
  for content.
- **Phase doc** `quiz/"state"`: `{qIndex: number, phase: "lobby" | "open" | "reveal"}`.
  Written ONLY by the host → plain `rt.set` is safe (single writer). Everyone renders
  from it; `null` ⇒ lobby.
- **Host election**: `rt.claim("quiz", "host", {sessionId, name})` — first tap on
  "Host this" wins; gate host controls on `hostDoc?.sessionId === me.sessionId`.
- **Ballots** (one vote per player per question): `rt.claim("ballots", `${qIndex}:${me.sessionId}`, {choice})`
  — atomic; a double-tap or revisit gets `claimed: false` and their original stands.
- **Tallies**: after a WON ballot claim, `rt.increment("votes", String(qIndex), "opt" + choice, 1)`.
  Doc per question, field per option — atomic counts, and results render from
  `useDoc("votes", String(qIndex))`.
- Optional per-question timer: host starts `rt.startTimer("q-" + qIndex, ms)`; host (or
  anyone, via CAS if you want) reveals on `fired`.

`appSpec.collections`:

```json
{
  "quiz": { "rateLimitPerMin": 30 },
  "ballots": { "rateLimitPerMin": 30 },
  "votes": { "rateLimitPerMin": 60 }
}
```

## The vote flow (order matters)

```tsx
const vote = async (choice: number) => {
  setBusy(true);
  const ballot = await rt.claim("ballots", `${qIndex}:${me.sessionId}`, { choice });
  if (ballot.claimed) {
    await rt.increment("votes", String(qIndex), `opt${choice}`, 1); // tally ONLY if ballot won
    if (isTrivia && choice === correct) await rt.addScore(me.name, 100);
  }
  // ballot.claimed === false ⇒ already voted; ballot.data.choice is their vote — show it.
  setBusy(false);
};
```

Claim-then-increment means a crash between the two writes loses at most one tally (and
never double-counts) — the safe failure direction. Never increment first.

## Results rendering (pure CSS bars)

```tsx
const tally = Runtime.useDoc("votes", String(qIndex)) as Record<string, number> | null;
const counts = opts.map(
  (_, i) => Number(Object.entries(tally ?? {}).find(([key]) => key === `opt${i}`)?.at(1) ?? 0)
);
const total = counts.reduce((a, b) => a + b, 0);
// per option:
<div style={{ background: "var(--rt-surface)", borderRadius: "var(--rt-radius)" }}>
  <div style={{
    width: `${total ? Math.round(((counts.at(i) ?? 0) / total) * 100) : 0}%`,
    minWidth: counts.at(i) ? 8 : 0, height: 28,
    background: "var(--rt-primary)", borderRadius: "var(--rt-radius)",
    transition: "width 300ms",
  }} />
</div>
```

## UX guidance

- **Hide counts while voting is open** for trivia (no bandwagon / spoiler); polls may
  show live bars — that IS the show. Decide per app type.
- After voting, show "You picked B — waiting for reveal" with the vote locked in.
- Mid-question joiners: render from the phase doc — they land on the current question.
- Projector: lobby → "N in the room, waiting for host"; open → question + live total
  votes (or bars for polls); reveal → bars + correct answer highlighted. No buttons.
- Host phone gets a small control strip (Open next / Reveal), players never see it.

## Pitfalls

1. **Voting into a doc with `set`** — last write wins, tallies drift, revotes are free.
   Ballot claim + increment is the only honest shape.
2. **Host disappearance**: the host doc holds a sessionId whose phone may die. Offer a
   "take over hosting" that CAS-swaps the host doc after confirmation, or accept the
   risk for short sessions (note it in `notes`).
3. **Composite ballot keys**: key must include BOTH question index and sessionId —
   `q:${i}` alone = one vote total; `${sessionId}` alone = one vote per game.
4. **Reveal race**: if anyone (not just host) may reveal on timer-fire, advance the
   phase with CAS on the state doc so a stampede reveals once.

## Reference implementation — "Crowd Poll"

Host-paced multi-question live poll with bars revealed live.

`appSpec`:

```json
{
  "name": "Crowd Poll",
  "description": "Live polls — vote on your phone, watch the bars move.",
  "projector": true,
  "collections": {
    "quiz": { "rateLimitPerMin": 30 },
    "ballots": { "rateLimitPerMin": 30 },
    "votes": { "rateLimitPerMin": 60 }
  }
}
```

`appTsx`:

```tsx
import { useState } from "react";
import * as Runtime from "@runtime/sdk";
import { Screen, Card, BigButton, PresencePill, EmptyState, Stat } from "@runtime/ui";

const POLLS = [
  { q: "Tabs or spaces?", opts: ["Tabs", "Spaces", "Whatever the formatter says"] },
  { q: "Best time to be productive?", opts: ["Early morning", "Afternoon", "Late night"] },
  { q: "Pick a superpower:", opts: ["Fly", "Invisibility", "Pause time", "Unlimited coffee"] },
];

type QuizState = { qIndex: number; phase: "open" | "reveal" };

function Bars(props: { opts: string[]; tally: Record<string, number> | null; picked?: number }) {
  const counts = props.opts.map(
    (_, i) => Number(Object.entries(props.tally ?? {}).find(([key]) => key === `opt${i}`)?.at(1) ?? 0)
  );
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {props.opts.map((opt, i) => (
        <div key={i}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{opt}{props.picked === i ? " ← you" : ""}</span>
            <strong>{counts.at(i)}</strong>
          </div>
          <div style={{ background: "var(--rt-surface)", borderRadius: "var(--rt-radius)" }}>
            <div style={{
              width: `${total ? Math.max(4, Math.round(((counts.at(i) ?? 0) / total) * 100)) : 0}%`,
              height: 24, background: "var(--rt-primary)",
              borderRadius: "var(--rt-radius)", transition: "width 300ms",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const me = Runtime.useMe();
  const rt = Runtime.useRt();
  const mode = Runtime.useMode();
  const presence = Runtime.usePresence();
  const state = Runtime.useDoc("quiz", "state") as QuizState | null;
  const host = Runtime.useDoc("quiz", "host") as { sessionId: string; name: string } | null;
  const qIndex = state?.qIndex ?? 0;
  const poll = POLLS[Math.min(qIndex, POLLS.length - 1)];
  const tally = Runtime.useDoc("votes", String(qIndex)) as Record<string, number> | null;
  const myBallot = Runtime.useDoc("ballots", `${qIndex}:${me.sessionId}`) as { choice: number } | null;
  const [busy, setBusy] = useState(false);

  const iAmHost = host?.sessionId === me.sessionId;
  const started = state !== null;
  const finished = started && qIndex >= POLLS.length;

  const becomeHost = async () => {
    setBusy(true);
    const res = await rt.claim("quiz", "host", { sessionId: me.sessionId, name: me.name });
    if (res.claimed) await rt.set("quiz", "state", { qIndex: 0, phase: "open" });
    setBusy(false);
  };

  const nextQuestion = async () => {
    setBusy(true);
    await rt.set("quiz", "state", { qIndex: qIndex + 1, phase: "open" }); // host-only writer
    setBusy(false);
  };

  const vote = async (choice: number) => {
    setBusy(true);
    const ballot = await rt.claim("ballots", `${qIndex}:${me.sessionId}`, { choice });
    if (ballot.claimed) await rt.increment("votes", String(qIndex), `opt${choice}`, 1);
    setBusy(false);
  };

  if (mode === "projector") {
    return (
      <Screen title="Crowd Poll">
        <PresencePill count={presence.length} />
        {!started && <EmptyState message="Waiting for a host to start the poll…" />}
        {started && !finished && (
          <Card title={`Q${qIndex + 1}: ${poll.q}`}>
            <Bars opts={poll.opts} tally={tally} />
          </Card>
        )}
        {finished && <Stat label="That's a wrap" value="Thanks for voting!" />}
      </Screen>
    );
  }

  return (
    <Screen title="Crowd Poll">
      <PresencePill count={presence.length} />
      {!started && (
        <>
          <p style={{ textAlign: "center" }}>Someone needs to run the show.</p>
          <BigButton onClick={becomeHost} disabled={busy}>Host this poll</BigButton>
        </>
      )}
      {started && !finished && (
        <Card title={`Q${qIndex + 1} of ${POLLS.length}: ${poll.q}`}>
          {myBallot === null ? (
            <div style={{ display: "grid", gap: 10 }}>
              {poll.opts.map((opt, i) => (
                <BigButton key={i} onClick={() => void vote(i)} disabled={busy}>{opt}</BigButton>
              ))}
            </div>
          ) : (
            <Bars opts={poll.opts} tally={tally} picked={myBallot.choice} />
          )}
        </Card>
      )}
      {finished && <Card title="All done"><p>Thanks for voting! Watch the big screen.</p></Card>}
      {iAmHost && started && !finished && (
        <BigButton variant="secondary" onClick={nextQuestion} disabled={busy}>
          {qIndex + 1 < POLLS.length ? "Next question →" : "Finish poll"}
        </BigButton>
      )}
    </Screen>
  );
}
```

Adapt for trivia: add `a: number` to questions, hide `Bars` until a `phase: "reveal"`
(host button or timer-fired CAS), award `rt.addScore` on winning ballot claims with the
correct choice, and show the leaderboard between questions.
