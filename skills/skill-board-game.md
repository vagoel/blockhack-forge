---
name: board-game
triggers: [board, grid, tile, square, tic-tac-toe, bingo, territory, checkers]
summary: Grid/board games — one doc per square, rt.claim for atomic square-grabbing, deriving the board from useDocs.
---

# Board Games — grids of atomically claimable cells

## When to use

Any game played on a grid or a fixed set of slots where players take cells: territory
grabs, bingo squares, tic-tac-toe, seat pickers, treasure hunts, pixel-art walls. The
defining property: a cell must belong to exactly one player even when ten phones tap it
in the same 100ms.

## Data model recipe

- **One doc per cell**, key = a stable cell id (`"r-c"` like `"3-5"`, or a slot name).
  Value = `{sessionId, name, ...}` of the owner (plus color/symbol as needed).
- **Read the whole board** with `useDocs("squares")` → build a `Map<key, owner>` and
  render every cell from it. Unclaimed = key absent from the map.
- **Take a cell** with `rt.claim("squares", key, {sessionId, name})` — atomic
  create-if-absent. Exactly one winner; losers get `{claimed: false, data: winnerData}`
  and can show "Taken by Blue Fox".
- **Score on success only**: `if (res.claimed) await rt.addScore(me.name, 1)` — losers
  and re-taps of an owned cell score nothing because `claim` on an existing doc always
  returns `claimed: false` (even for the owner).
- Optional round timer: `rt.startTimer("round", ms)` by a claim-elected starter.

No `uniqueBy` guard needed — doc-claiming via `rt.claim` is inherently atomic. Use the
`uniqueBy` push guard only when claims are modeled as list items instead (rarely better).

`appSpec.collections`:

```json
{ "squares": { "rateLimitPerMin": 120 }, "meta": { "rateLimitPerMin": 10 } }
```

(120/min because an eager player taps fast; each tap is one claim attempt.)

## Admin reset and round keys

The required admin view includes `Reset game` / `New round`. Subscribe to a control doc
such as `meta/game` with `{round?: number}` (default `0`), prefix every claimed cell key
with the round (`${round}:${cell}`), and render only that prefix. Reset with
`rt.increment("meta", "game", "round", 1)`, then initialize any round-specific turn doc
or timer. Old claimed docs remain stored but are outside the current round. Derive current
scores from current-round cells; built-in leaderboard rows cannot all be cleared by one
admin client.

## Interaction patterns

- Render the grid with `Grid {cols}` from the UI kit or a plain CSS grid; cells are
  `<button>`s at least 44px square. Color owned cells with a per-player color derived
  deterministically from sessionId (hash → hue) so every phone renders identical colors.
- Mid-game joiners: the board is fully derivable from `useDocs`, so a late joiner sees
  the true board instantly — no replay needed. This is why board state lives in docs,
  not an event list.
- Win detection runs client-side on every render from the same shared docs (count cells,
  check lines). Every phone computes the same result from the same data — no "referee"
  writer needed. For a definitive recorded winner, the detecting clients race
  `rt.claim("meta", "winner", {...})` and exactly one write lands.
- Show remaining-cell count and per-player tallies — pace pressure drives the fun.

## Pitfalls

1. **`rt.set` for cell-taking** = lost claims: two taps both "win" and one silently
   overwrites the other. Always `claim` for first-touch ownership.
2. **Turn-based boards** (tic-tac-toe): claiming squares is not enough — you must also
   serialize turns. Combine this skill's per-cell `claim` with the turn-taking skill's
   `cas` turn doc: validate `turn.sessionId === me.sessionId` before claiming, advance
   the turn with `cas` after a successful claim.
3. **Board size vs caps**: `useDocs` caps at 500 docs — keep boards ≤ ~400 cells
   (20×20). For a 50-person race, 10×10 to 14×14 plays best.
4. **Deriving colors from names**: names are editable and can collide — derive colors
   from `sessionId`, display `name`.

## Reference implementation — "Territory Grab"

10×10 grid, 60 seconds, most squares wins.

`appSpec`:

```json
{
  "name": "Territory Grab",
  "description": "Claim squares faster than everyone else — most territory in 60s wins.",
  "projector": true,
  "collections": {
    "squares": { "rateLimitPerMin": 120 },
    "meta": { "rateLimitPerMin": 10 }
  }
}
```

`appTsx`:

```tsx
import { useMemo, useState } from "react";
import * as Runtime from "@runtime/sdk";
import { Screen, BigButton, Leaderboard, PresencePill, Stat, EmptyState } from "@runtime/ui";

const SIZE = 10;
const ROUND_MS = 60_000;

function hueOf(sessionId: string): number {
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) h = (h * 31 + sessionId.charCodeAt(i)) >>> 0;
  return h % 360;
}

export default function App() {
  const me = Runtime.useMe();
  const rt = Runtime.useRt();
  const mode = Runtime.useMode();
  const squares = Runtime.useDocs("squares");
  const timer = Runtime.useTimer("round");
  const board = Runtime.useLeaderboard(10);
  const presence = Runtime.usePresence();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const owners = useMemo(() => {
    const m = new Map<string, { sessionId: string; name: string }>();
    for (const s of squares) m.set(s.key, s.data);
    return m;
  }, [squares]);

  const running = timer.endsAt !== null && !timer.fired;
  const done = timer.fired;
  const claimedCount = owners.size;

  const start = async () => {
    setBusy(true);
    const gate = await rt.claim("meta", "starter", { sessionId: me.sessionId });
    if (gate.claimed) await rt.startTimer("round", ROUND_MS);
    setBusy(false);
  };

  const grab = async (key: string) => {
    if (!running || owners.has(key)) return;
    const res = await rt.claim("squares", key, { sessionId: me.sessionId, name: me.name });
    if (res.claimed) {
      setNotice(null);
      await rt.addScore(me.name, 1); // score only the atomic winner
    } else {
      setNotice(`Taken by ${res.data?.name ?? "someone"}!`);
    }
  };

  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const key = `${r}-${c}`;
      const owner = owners.get(key);
      cells.push(
        <button
          key={key}
          onClick={() => void grab(key)}
          disabled={mode === "projector" || !running || Boolean(owner)}
          aria-label={owner ? `Taken by ${owner.name}` : `Square ${key}`}
          style={{
            aspectRatio: "1", width: "100%", minHeight: 0, padding: 0,
            border: "1px solid var(--rt-surface)",
            borderRadius: 4,
            background: owner ? `hsl(${hueOf(owner.sessionId)} 70% 55%)` : "var(--rt-surface)",
            outline: owner?.sessionId === me.sessionId ? "2px solid var(--rt-text)" : "none",
          }}
        />
      );
    }
  }

  const grid = (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${SIZE}, 1fr)`, gap: 3 }}>
      {cells}
    </div>
  );
  const entries = board.map((e) => ({ name: e.name, points: e.points, highlight: e.sessionId === me.sessionId }));

  if (mode === "projector") {
    return (
      <Screen title="Territory Grab">
        <PresencePill count={presence.length} />
        {running && <Stat label="Seconds left" value={Math.ceil(timer.remainingMs / 1000)} />}
        {done && <Stat label="Game over" value="Final map" />}
        {grid}
        {entries.length === 0 ? <EmptyState message="No territory claimed yet…" /> : <Leaderboard entries={entries} />}
      </Screen>
    );
  }

  return (
    <Screen title="Territory Grab">
      <PresencePill count={presence.length} />
      {timer.endsAt === null && (
        <>
          <p style={{ textAlign: "center" }}>Tap squares to claim them. Most squares in 60s wins.</p>
          <BigButton onClick={start} disabled={busy}>Start the round</BigButton>
        </>
      )}
      {running && <Stat label="Seconds left" value={Math.ceil(timer.remainingMs / 1000)} />}
      {done && <Stat label="Game over" value={`${claimedCount} squares claimed`} />}
      {grid}
      {notice && <p style={{ textAlign: "center", color: "var(--rt-accent)" }}>{notice}</p>}
      {entries.length > 0 && <Leaderboard entries={entries} />}
    </Screen>
  );
}
```

Adapt: bingo = claim your card's cells only when the called number matches a host doc;
tic-tac-toe = 3×3 board + the turn-taking skill's `cas` turn doc; seat map = named slot
keys with a "release" flow via host-only `rt.set`.
