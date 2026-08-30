---
name: presence-rooms
triggers: [presence, lobby, room, join, online, players, team, roster]
summary: Live who's-here — usePresence semantics, explicit rosters vs ephemeral presence, teams, lobbies, online badges.
---

# Presence & Rooms — who's here, who's on which team

## When to use

Lobbies, rosters, team pickers, "N people here" social proof, waiting rooms, icebreakers.
Use presence only when who-is-here materially changes a live/social experience. A room,
game, poll, shared event, or collaborative board often benefits from a `PresencePill`.
A marketing site, portfolio, catalog, document hub, and ordinary single-user tool should
not show presence merely because Convex is enabled.

## Two different concepts — don't conflate them

| | Presence (`usePresence`) | Roster (your own collection) |
|---|---|---|
| Source | automatic heartbeats | explicit player action (join/team pick) |
| Lifetime | ephemeral — drops when the tab closes or blips | durable — survives disconnects |
| Ordering | unstable | stable (list join-order, or doc keys) |
| Use for | counts, online dots, "watching now" | game membership, turn order, teams, scores identity |

`Runtime.usePresence()` → `Array<{userId, name, online}>`; `userId` is that player's
`sessionId`; the room is the app itself (everyone who opened it — including the
projector instance, which appears in the list too). `[]` while connecting. Heartbeats
are automatic; you never manage them.

**Rule**: game logic keys off the roster; presence only decorates it (online badge,
count). Wi-Fi blips must not eject someone from a game.

## Data model recipe

- **Roster as docs keyed by sessionId** — `rt.set("players", me.sessionId, {name, team, joinedAt})`,
  read with `useDocs("players")`. Idempotent (re-join just refreshes), editable (switch
  team = another `set` on your own key; no contention since only you write your key).
  Prefer this when membership is editable.
- **Roster as a list** — `rt.push("players", {sessionId, name})` with guard
  `uniqueBy: "sessionId"` when you need stable JOIN ORDER (turn games) or a hard
  "no re-entry" rule.
- **Online resolution**: build `Set(presence.filter(p => p.online).map(p => p.userId))`
  and check roster sessionIds against it.
- **Teams**: a `team` field on the player's own doc. Balance nudges: compute team counts
  client-side and default the join button to the smaller team (players may still
  choose).

`appSpec.collections`:

```json
{ "players": { "rateLimitPerMin": 20, "maxLen": 300 } }
```

## UX guidance

- First screen: `PresencePill count={presence.length}` + one obvious action.
- Roster rows: `Avatar` + name + online dot (`●` colored / `○` dimmed via opacity).
  Highlight "(you)".
- Empty lobby: "You're first — the others are coming" beats an empty list.
- A "start when ready" gate reads roster size, not presence size ("Need 2 more players").
- Filter the projector's own session out of player-facing rosters if it joined one
  (better: the projector never writes a roster entry — gate join UI on
  `mode === "player"`).

## Pitfalls

1. **Turn order from presence** — reshuffles on every blip. Order from the roster list.
2. **Counting presence as players** — lurkers and the projector inflate it. "23 here ·
   12 playing" (presence vs roster) is the honest display.
3. **Kicking on offline** — don't remove roster entries when `online` flips false;
   phones lock, elevators happen. Mark AFK visually; let game logic (turn timeouts)
   handle absence.
4. **Names**: presence names can lag or default to "Guest"; your roster doc's `name`
   (written at join with `me.name`) is more reliable — prefer it when both exist.

## Reference implementation — "Team Lobby"

Pick red or blue, see both rosters live with online dots, cheer for your team (atomic
cheer counters). A lobby that IS the game.

`appSpec`:

```json
{
  "name": "Team Lobby",
  "description": "Join red or blue, see who's here live, and out-cheer the other team.",
  "projector": true,
  "collections": {
    "players": { "rateLimitPerMin": 20, "maxLen": 300 },
    "cheers": { "rateLimitPerMin": 240 }
  }
}
```

`appTsx`:

```tsx
import { useState } from "react";
import * as Runtime from "@runtime/sdk";
import { Screen, Card, BigButton, PresencePill, EmptyState, Avatar, Grid, Stat } from "@runtime/ui";

type Player = { name: string; team: "red" | "blue" };
const TEAM_COLOR = { red: "#e5484d", blue: "#3e63dd" } as const;

export default function App() {
  const me = Runtime.useMe();
  const rt = Runtime.useRt();
  const mode = Runtime.useMode();
  const presence = Runtime.usePresence();
  const players = Runtime.useDocs("players");
  const cheers = Runtime.useDoc("cheers", "totals") as { red?: number; blue?: number } | null;
  const [busy, setBusy] = useState(false);

  const online = new Set(presence.filter((p) => p.online).map((p) => p.userId));
  const mine = players.find((p) => p.key === me.sessionId)?.data as Player | undefined;
  const byTeam = (team: "red" | "blue") =>
    players.filter((p) => (p.data as Player)?.team === team);
  const redCount = byTeam("red").length;
  const blueCount = byTeam("blue").length;
  const smaller: "red" | "blue" = redCount <= blueCount ? "red" : "blue";

  const join = async (team: "red" | "blue") => {
    setBusy(true);
    // Own-key doc: only this device writes it — set() is race-free and re-join/switch friendly.
    await rt.set("players", me.sessionId, { name: me.name, team } satisfies Player);
    setBusy(false);
  };

  const cheer = () => {
    if (!mine) return;
    void rt.increment("cheers", "totals", mine.team, 1); // atomic team counter
  };

  const rosterFor = (team: "red" | "blue") => {
    const list = byTeam(team);
    if (list.length === 0) return <EmptyState message="Nobody yet — be first!" />;
    return list.map((p) => {
      const d = p.data as Player;
      return (
        <div key={p.key} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
          <Avatar name={d.name} />
          <span>{d.name}{p.key === me.sessionId ? " (you)" : ""}</span>
          <span style={{ marginLeft: "auto", opacity: online.has(p.key) ? 1 : 0.35 }}>
            {online.has(p.key) ? "●" : "○"}
          </span>
        </div>
      );
    });
  };

  const scoreRow = (
    <Grid cols={2}>
      <Stat label={`🔴 Red cheers (${redCount} players)`} value={cheers?.red ?? 0} />
      <Stat label={`🔵 Blue cheers (${blueCount} players)`} value={cheers?.blue ?? 0} />
    </Grid>
  );

  if (mode === "projector") {
    return (
      <Screen title="Team Lobby">
        <PresencePill count={presence.length} />
        {scoreRow}
        <Grid cols={2}>
          <Card title="Red team">{rosterFor("red")}</Card>
          <Card title="Blue team">{rosterFor("blue")}</Card>
        </Grid>
      </Screen>
    );
  }

  return (
    <Screen title="Team Lobby">
      <PresencePill count={presence.length} />
      {!mine && (
        <Card title="Pick your side">
          <p style={{ textAlign: "center", opacity: 0.8 }}>
            {presence.length} here · {players.length} on teams
          </p>
          <Grid cols={2}>
            {(["red", "blue"] as const).map((team) => (
              <BigButton
                key={team}
                onClick={() => void join(team)}
                disabled={busy}
                variant={team === smaller ? "primary" : "secondary"}
              >
                {team === "red" ? "🔴 Red" : "🔵 Blue"}{team === smaller ? " (needs you)" : ""}
              </BigButton>
            ))}
          </Grid>
        </Card>
      )}
      {mine && (
        <>
          {scoreRow}
          <BigButton onClick={cheer}>
            {mine.team === "red" ? "🔴" : "🔵"} CHEER for {mine.team}!
          </BigButton>
          <BigButton variant="secondary" onClick={() => void join(mine.team === "red" ? "blue" : "red")} disabled={busy}>
            Defect to {mine.team === "red" ? "blue" : "red"}
          </BigButton>
        </>
      )}
      <Grid cols={2}>
        <Card title="Red team">{rosterFor("red")}</Card>
        <Card title="Blue team">{rosterFor("blue")}</Card>
      </Grid>
    </Screen>
  );
}
```

Adapt: any lobby is this skeleton minus teams; icebreakers hang per-player prompts off
the player doc; team-vs-team games keep this roster and add their mechanic's collections
alongside.
