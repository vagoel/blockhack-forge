---
name: turn-taking
triggers: [turn, turns, turn-based, pass, rotation, sequence, whose turn, take turns]
summary: Serialized turn order across devices — claim to seed a turn doc, cas to advance it, join-order rosters.
---

# Turn-Taking — exactly one player acts at a time

## When to use

Games where the right to act rotates: storytelling chains, hot-potato, turn-based
boards, "pass the mic" Q&A, drawing-guess rounds. The defining property: everyone must
agree on whose turn it is, and advancing the turn must happen exactly once even if the
current player double-taps "done" or two clients race to advance on a timeout.

## Data model recipe

- `players` — roster as append-only items `{sessionId, name}` with guard
  `uniqueBy: "sessionId"` (include `sessionId` inside `data` — the guard inspects data
  fields). `useList("players")` is oldest-first, which IS join order — a free, stable
  turn order shared by every client.
- `game` / `"turn"` — the single serialization point:
  `{idx: number, sessionId: string, n: number}` where `idx` indexes the roster,
  `sessionId` denormalizes the current player, `n` is a monotonically increasing turn
  counter (makes every turn value unique, which keeps CAS honest even if the same player
  gets consecutive turns).
- Optional per-turn timer: `rt.startTimer("turn-" + n, ms)` started by the player whose
  turn began (their client detects `turn.sessionId === me.sessionId`).

`appSpec.collections`:

```json
{
  "players": { "uniqueBy": "sessionId", "rateLimitPerMin": 10, "maxItems": 100 },
  "game": { "rateLimitPerMin": 30 },
  "moves": { "rateLimitPerMin": 12, "maxLen": 500, "maxItems": 500 }
}
```

## The claim-then-cas lifecycle (the core pattern)

```tsx
// 1. SEED — first "start game" tap creates the turn doc exactly once:
const gate = await rt.claim("game", "turn", { idx: 0, sessionId: roster[0].sessionId, n: 0 });
// gate.claimed === false ⇒ someone else started it; the subscription shows it. Fine.

// 2. ADVANCE — only ever with cas, passing the EXACT object read from useDoc:
const turn = Runtime.useDoc("game", "turn"); // {idx, sessionId, n} | null
const next = (turn.idx + 1) % roster.length;
const res = await rt.cas("game", "turn", turn, {
  idx: next,
  sessionId: roster.at(next)?.sessionId,
  n: turn.n + 1,
});
if (!res.ok) {
  // Someone advanced first (double-tap, timeout racer). res.data is current truth,
  // and the subscription re-renders — just don't error loudly.
}
```

Why CAS and not `set`: with `set`, a double-tapped "end turn" advances twice and skips a
player; two clients advancing on a timeout skip two. CAS makes the second write fail
harmlessly because the stored value no longer equals `expect`.

**CAS gotcha (critical)**: the comparison is `JSON.stringify` deep-equal — key order
matters. Always pass the object from `useDoc` as `expect` untouched. Never rebuild
`{sessionId: ..., idx: ...}` in a different key order; it will never match.

## Interaction patterns

- **Gate the act button** on `turn?.sessionId === me.sessionId`. Everyone else sees
  "Waiting for {currentName}…" with the roster and a highlighted current player.
- **Late joiners** push into `players` any time; `% roster.length` folds them into the
  rotation automatically. Players who leave: skip-forward is just another CAS advance —
  offer anyone a "skip AFK player" button once that player's turn timer fires.
- **Turn timeout**: current player's client starts `rt.startTimer("turn-" + turn.n, ms)`
  when their turn begins (guard with a per-n claim if you want strict once-only). When
  `useTimer("turn-" + turn.n).fired`, ANY client may CAS-advance — the CAS makes the
  stampede safe: one succeeds, the rest no-op.
- Record what happened each turn as items in `moves` — the story/history renders from
  `useList`.

## Pitfalls

1. **Roster from presence**: `usePresence` fluctuates with connectivity — a blip would
   reshuffle turn order. Roster comes from the `players` list (join is explicit); use
   presence only to display online/offline badges next to roster rows.
2. **CAS against null**: the turn doc must be created with `claim` first. CAS with
   `expect: null` on a missing doc is undefined — don't rely on it.
3. **Forgetting `n`**: without a counter, a 2-player game has only two distinct turn
   values — a stale CAS from turn 1 could "succeed" during turn 3. The counter makes
   every state unique.
4. **Advancing from stale props**: compute the CAS from the freshest `useDoc` value at
   tap time, not from a value captured in an old closure (define the handler inside the
   component so it closes over the current render's `turn`).

## Reference implementation — "Story Chain"

Players join, then take turns adding 1–8 words to a growing story; 30s per turn, anyone
can skip an expired turn.

`appSpec`:

```json
{
  "name": "Story Chain",
  "description": "One sentence at a time, one player at a time — build a story together.",
  "projector": true,
  "collections": {
    "players": { "uniqueBy": "sessionId", "rateLimitPerMin": 10, "maxItems": 100 },
    "game": { "rateLimitPerMin": 30 },
    "moves": { "rateLimitPerMin": 12, "maxLen": 400, "maxItems": 500 }
  }
}
```

`appTsx`:

```tsx
import { useState } from "react";
import * as Runtime from "@runtime/sdk";
import { Screen, Card, BigButton, Input, PresencePill, EmptyState, Avatar, Stat } from "@runtime/ui";

const TURN_MS = 30_000;

type Turn = { idx: number; sessionId: string; n: number };

export default function App() {
  const me = Runtime.useMe();
  const rt = Runtime.useRt();
  const mode = Runtime.useMode();
  const roster = Runtime.useList("players");        // oldest-first = join order
  const turn = Runtime.useDoc("game", "turn") as Turn | null;
  const moves = Runtime.useList("moves");
  const timer = Runtime.useTimer(turn ? `turn-${turn.n}` : "turn-none");
  const presence = Runtime.usePresence();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const joined = roster.some((p) => p.data?.sessionId === me.sessionId);
  const online = new Set(presence.filter((p) => p.online).map((p) => p.userId));
  const current = turn ? roster[turn.idx % Math.max(roster.length, 1)] : null;
  const myTurn = turn?.sessionId === me.sessionId;
  const expired = turn !== null && timer.fired;

  const join = async () => {
    setBusy(true);
    const res = await rt.push("players", { sessionId: me.sessionId, name: me.name });
    if (!res.ok) setNotice("Already in — you're on the roster.");
    setBusy(false);
  };

  const startGame = async () => {
    if (roster.length === 0) return;
    setBusy(true);
    const first = roster[0].data;
    const gate = await rt.claim("game", "turn", { idx: 0, sessionId: first.sessionId, n: 0 });
    if (gate.claimed) await rt.startTimer("turn-0", TURN_MS);
    setBusy(false);
  };

  const advance = async (t: Turn) => {
    const next = (t.idx + 1) % roster.length;
    const res = await rt.cas("game", "turn", t, {
      idx: next,
      sessionId: roster.at(next)?.data.sessionId,
      n: t.n + 1,
    });
    if (res.ok) await rt.startTimer(`turn-${t.n + 1}`, TURN_MS);
    return res.ok; // false = someone else advanced; subscription has the truth
  };

  const submit = async () => {
    if (!turn || !myTurn) return;
    const words = draft.trim();
    if (!words) return;
    setBusy(true);
    const res = await rt.push("moves", { words, name: me.name });
    if (!res.ok) {
      setNotice("Too fast or too long — trim it and try again.");
    } else {
      setDraft("");
      setNotice(null);
      await advance(turn);
    }
    setBusy(false);
  };

  const skip = async () => {
    if (!turn || !expired) return;
    setBusy(true);
    await advance(turn); // CAS makes the stampede safe
    setBusy(false);
  };

  const story = moves.map((m) => m.data?.words).join(" ");
  const rosterView = roster.map((p) => (
    <div key={p._id} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
      <Avatar name={p.data?.name ?? "?"} />
      <span style={{ fontWeight: p.data?.sessionId === turn?.sessionId ? 700 : 400 }}>
        {p.data?.name}{p.data?.sessionId === turn?.sessionId ? " ← now" : ""}
      </span>
      <span style={{ opacity: 0.6 }}>{online.has(p.data?.sessionId) ? "●" : "○"}</span>
    </div>
  ));

  const storyCard = (
    <Card title="The story so far">
      {story ? <p style={{ lineHeight: 1.6 }}>{story}</p> : <EmptyState message="A blank page. Terrifying." />}
    </Card>
  );

  if (mode === "projector") {
    return (
      <Screen title="Story Chain">
        <PresencePill count={presence.length} />
        {turn && current && <Stat label="Writing now" value={String(current.data?.name ?? "…")} />}
        {turn && !timer.fired && <Stat label="Seconds left" value={Math.ceil(timer.remainingMs / 1000)} />}
        {storyCard}
      </Screen>
    );
  }

  return (
    <Screen title="Story Chain">
      <PresencePill count={presence.length} />
      {storyCard}
      {!joined && <BigButton onClick={join} disabled={busy}>Join the story</BigButton>}
      {joined && turn === null && (
        <BigButton onClick={startGame} disabled={busy || roster.length < 2}>
          {roster.length < 2 ? "Waiting for one more writer…" : "Start the story"}
        </BigButton>
      )}
      {turn && myTurn && (
        <Card title={`Your turn — ${Math.ceil(timer.remainingMs / 1000)}s`}>
          <Input value={draft} onChange={setDraft} placeholder="Add a few words…" />
          <BigButton onClick={submit} disabled={busy || draft.trim() === ""}>Add & pass</BigButton>
        </Card>
      )}
      {turn && !myTurn && (
        <Card>
          <p style={{ textAlign: "center" }}>Waiting for <strong>{current?.data?.name ?? "…"}</strong>…</p>
          {expired && (
            <BigButton variant="secondary" onClick={skip} disabled={busy}>Skip them (time's up)</BigButton>
          )}
        </Card>
      )}
      {notice && <p style={{ color: "var(--rt-accent)" }}>{notice}</p>}
      {rosterView.length > 0 && <Card title="Writers">{rosterView}</Card>}
    </Screen>
  );
}
```

Adapt: hot-potato = the "move" is just holding; drawing-guess = current player sets a
prompt doc, others push guesses; tic-tac-toe = gate the board-game skill's `claim` on
`myTurn` and CAS-advance after each placed mark.
