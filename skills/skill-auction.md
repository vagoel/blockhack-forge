---
name: auction
triggers: [auction, bid, bidding, highest, sell, gavel, sold, offer]
summary: Live auction pattern — monotonicMaxField-guarded bids, bid history, countdown close, outbid UX.
---

# Auction — strictly-increasing bid races

## When to use

Anything where players compete to hold the top of a strictly increasing number: live
auctions, "name your price", highest-pledge drives, reverse raffles. The defining
property: a submission is only valid if it beats the current best, and two phones will
try to beat it simultaneously.

## Why the guard, not client logic

A client-side check ("is my bid > current high?") is a read-then-write race: two phones
both see $50, both bid $55, both "succeed", and the history is corrupt. The server-side
guard `monotonicMaxField` makes `rt.push` atomically reject any bid whose field is not
STRICTLY greater than the current max in the collection. Equal bids lose. The client's
only job is to try, and to handle losing politely.

## Data model recipe

- `bids` — append-only items `{round, amount, guardValue, name}` with guard
  `monotonicMaxField: "guardValue"`. Filter to the current round; its high bid is the
  LAST filtered item because `useList` is newest-last.
- `meta` — docs: `"auction"` (numeric round), `"item"` (what is being auctioned), and
  `"starter"` (claim-elected timer starter).
- Timer `"auction"` via `rt.startTimer` / `useTimer` — the close.

`appSpec.collections`:

```json
{
  "bids": { "monotonicMaxField": "guardValue", "rateLimitPerMin": 60, "maxItems": 1000 },
  "meta": { "rateLimitPerMin": 10 }
}
```

## Admin reset without deleting history

The required admin view needs a real `Reset auction` / `New auction` action. Because the
bid list and its monotonic guard are append-only, model rounds explicitly:

- Subscribe to `meta/auction` as `{round?: number}`; current round defaults to `0`.
- Each bid stores `{round, amount, name, guardValue}` and the collection guard is
  `monotonicMaxField: "guardValue"`. Use
  `guardValue = round * 1_000_000_000 + amount`, reject amounts outside `1..999_999_999`,
  and display/compare only `amount` among bids for the current round.
- Admin reset calls `rt.increment("meta", "auction", "round", 1)`, restarts the timer,
  and shows confirmation. All clients filter history by the new round reactively. Never
  claim the old bid items were deleted.

## Interaction patterns

- **Quick-raise buttons beat free input.** `+1 / +5 / +25` over the current high is one
  tap and always well-formed. Offer a custom-amount input as secondary.
- **Outbid feedback**: on `{ok: false}` show "Outbid — someone got there first!" and let
  the reactive list show the new high. Never show an error tone for losing a race; it's
  the game.
- **Close**: the first player to open the auction wins `claim("meta", "starter")` and
  calls `rt.startTimer("auction", ms)`. When `fired` flips true, disable bidding and
  crown the last bid filtered to the current round. `fired` is the shared authoritative
  close — never close locally on `remainingMs === 0` alone (clocks drift;
  `remainingMs` is display).
- **Bid history** filters to the current round, then renders newest-first, capped to
  roughly 15 rows.

## Pitfalls

1. **Bid ties**: `monotonicMaxField` is strict — a bid equal to the high is rejected.
   Build raise buttons from `high + step` so users can't construct a tie.
2. **Bidding after close**: `fired` arrives via subscription; a bid in flight at the gong
   may still land. Accept it (last-accepted-wins is fair) or, stricter, have the UI stop
   at `fired` and treat the final list as truth. Never trust the local clock.
3. **First bid**: with an empty collection the guard compares against no max — any
   positive amount is accepted. Seed the UI with a minimum ("Bidding starts at 10") by
   making the lowest quick-raise `max(high, MIN)` based.
4. **Don't store the high bid in a doc** — deriving it from the guarded list means it
   can never disagree with history.

## Reference implementation — "Golden Gavel"

`appSpec`:

```json
{
  "name": "Golden Gavel",
  "description": "Live auction — highest bid when the timer fires wins.",
  "projector": true,
  "collections": {
    "bids": { "monotonicMaxField": "guardValue", "rateLimitPerMin": 60, "maxItems": 1000 },
    "meta": { "rateLimitPerMin": 10 }
  }
}
```

`appTsx`:

```tsx
import { useState } from "react";
import * as Runtime from "@runtime/sdk";
import {
  Screen, Card, BigButton, Input, PresencePill, CountdownTimer, EmptyState, Stat, List,
} from "@runtime/ui";

const MIN_BID = 10;
const AUCTION_MS = 120_000;

export default function App() {
  const me = Runtime.useMe();
  const rt = Runtime.useRt();
  const mode = Runtime.useMode();
  const bids = Runtime.useList("bids"); // oldest first, newest LAST
  const auctionMeta = Runtime.useDoc("meta", "auction") as { round?: number } | null;
  const timer = Runtime.useTimer("auction");
  const presence = Runtime.usePresence();
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [adminView, setAdminView] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const round = Number(auctionMeta?.round ?? 0);
  const currentBids = bids.filter((entry) => Number(entry.data?.round ?? 0) === round);
  const high = currentBids.at(-1) ?? null;
  const highAmount = Number(high?.data?.amount ?? 0);
  const open = timer.endsAt !== null && !timer.fired;
  const closed = timer.fired;
  const iAmHigh = high?.sessionId === me.sessionId;

  const start = async () => {
    setBusy(true);
    const gate = await rt.claim("meta", "starter", { sessionId: me.sessionId });
    if (gate.claimed) await rt.startTimer("auction", AUCTION_MS);
    setBusy(false);
  };

  const bid = async (amount: number) => {
    if (!open || !Number.isFinite(amount) || amount <= 0 || amount >= 1_000_000_000) return;
    const rounded = Math.round(amount);
    setBusy(true);
    const res = await rt.push("bids", {
      round, amount: rounded, guardValue: round * 1_000_000_000 + rounded, name: me.name,
    });
    setNotice(res.ok ? null : "Outbid — someone got there first!");
    if (res.ok) setCustom("");
    setBusy(false);
  };

  const base = Math.max(highAmount, MIN_BID - 1);
  const history = currentBids.slice().reverse().slice(0, 15).map((b) => (
    <div key={b._id} style={{ display: "flex", justifyContent: "space-between", minHeight: 44, alignItems: "center" }}>
      <span>{b.data?.name ?? "Guest"}</span>
      <strong>${b.data?.amount}</strong>
    </div>
  ));

  const unlockAdmin = () => {
    if (adminPassword === "123") {
      setAdminUnlocked(true);
      setAdminError(null);
      setAdminPassword("");
    } else {
      setAdminError("That password is not correct.");
    }
  };

  const resetAuction = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setBusy(true);
    try {
      const nextRound = await rt.increment("meta", "auction", "round", 1);
      await rt.startTimer("auction", AUCTION_MS);
      setNotice(`Auction reset — round ${nextRound} is live.`);
      setConfirmReset(false);
      setAdminView(false);
    } catch {
      setAdminError("Reset failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const status = (
    <>
      <PresencePill count={presence.length} />
      <Stat label={closed ? "SOLD for" : "Current high bid"} value={high ? `$${highAmount}` : `$${MIN_BID} to start`} />
      {high && (
        <p style={{ textAlign: "center" }}>
          {closed ? "Winner: " : "Held by: "}
          <strong>{high.data?.name}</strong>{iAmHigh ? " (you!)" : ""}
        </p>
      )}
      {open && timer.endsAt !== null && <CountdownTimer endsAt={timer.endsAt} />}
    </>
  );

  if (mode === "projector") {
    return (
      <Screen title="Golden Gavel — Mystery Prize">
        {status}
        {history.length === 0 ? <EmptyState message="No bids yet…" /> : <List items={history} />}
      </Screen>
    );
  }

  if (adminView) {
    return (
      <Screen title="Auction admin">
        {!adminUnlocked ? (
          <Card title="Enter admin password">
            <Input value={adminPassword} onChange={setAdminPassword} placeholder="Password" type="password" />
            {adminError && <p style={{ color: "var(--rt-accent)" }}>{adminError}</p>}
            <BigButton onClick={unlockAdmin}>Unlock admin</BigButton>
            <BigButton variant="secondary" onClick={() => setAdminView(false)}>Back to auction</BigButton>
          </Card>
        ) : (
          <Card title="Auction controls">
            <p>Current round: {round + 1}. Reset starts a clean two-minute round for everyone.</p>
            <BigButton variant="danger" onClick={() => void resetAuction()} disabled={busy}>
              {confirmReset ? "Confirm reset auction" : "Reset auction"}
            </BigButton>
            <BigButton variant="secondary" onClick={() => { setAdminUnlocked(false); setAdminView(false); }}>
              Lock and return
            </BigButton>
          </Card>
        )}
      </Screen>
    );
  }

  return (
    <Screen title="Golden Gavel">
      {status}
      {timer.endsAt === null && (
        <>
          <p style={{ textAlign: "center" }}>A 2-minute auction for the mystery prize. Open it?</p>
          <BigButton onClick={start} disabled={busy}>Open the auction</BigButton>
        </>
      )}
      {open && (
        <Card title={iAmHigh ? "You hold the high bid" : "Place your bid"}>
          <div style={{ display: "flex", gap: 8 }}>
            {[1, 5, 25].map((step) => (
              <BigButton key={step} onClick={() => bid(base + step)} disabled={busy || iAmHigh}>
                ${base + step}
              </BigButton>
            ))}
          </div>
          <Input value={custom} onChange={setCustom} placeholder={`Custom (> $${base})`} type="number" />
          <BigButton variant="secondary" onClick={() => bid(Number(custom))} disabled={busy || iAmHigh || custom.trim() === ""}>
            Bid custom amount
          </BigButton>
          {notice && <p style={{ color: "var(--rt-accent)" }}>{notice}</p>}
        </Card>
      )}
      {closed && (
        <Card title="Auction closed">
          <p>{high ? `Sold to ${high.data?.name} for $${highAmount}.` : "No bids — the gavel falls on silence."}</p>
        </Card>
      )}
      {history.length > 0 && <Card title="Bid history"><List items={history} /></Card>}
      <BigButton variant="secondary" onClick={() => setAdminView(true)}>Admin</BigButton>
    </Screen>
  );
}
```

Adapt: multiple lots = one `bids-<lotId>` collection per lot (declare each in
`appSpec.collections`) plus a host-advanced `meta/lot` doc; charity drive = same shape
with `monotonicMaxField` on cumulative pledge totals dropped in favor of `increment`.
