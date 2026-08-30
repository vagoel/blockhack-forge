---
name: forms
triggers: [form, rsvp, signup, submit, feedback, register, collect, suggestion]
summary: Collecting structured input from the room — editable per-player docs vs append-only submissions, validation, live summaries.
---

# Forms — collecting input from strangers, safely

## When to use

RSVPs, signups, feedback, suggestion boxes, question queues for a speaker, potluck
sign-ups, "submit your idea" — anything where players fill in structured data and the
room sees an aggregate. Not for votes on fixed options (quiz-poll skill) or free-form
chat feeds (realtime-state skill's guarded push pattern).

## Choose the storage shape by editability

| Need | Shape | Why |
|---|---|---|
| One response per player, EDITABLE | doc keyed by `me.sessionId` via `rt.set("responses", me.sessionId, data)` | idempotent, re-submit = update, zero contention (only you write your key) |
| One response per player, LOCKED | `rt.push` with guard `uniqueBy: "sessionId"` (sessionId inside data) | server-enforced single submission; rejection = "already submitted" |
| Many entries per player (suggestions) | `rt.push` with `rateLimitPerMin` + `maxLen` | append-only feed, guarded against spam |

The editable-doc shape is the default for forms — people typo their RSVP and want to fix
it. Reserve the locked push for contests/final answers.

## Data model recipe

```json
{
  "responses": { "rateLimitPerMin": 12, "maxLen": 600 },
  "questions": { "rateLimitPerMin": 4, "maxLen": 300, "maxItems": 300 }
}
```

- Read my own response with `useDoc("responses", me.sessionId)` — `null` means not yet
  submitted; a value pre-fills the form for editing.
- Aggregate with `useDocs("responses")` — counts, averages, breakdowns computed
  client-side on render (all clients compute identical results from identical data; no
  aggregation writer needed, no drift).
- Free-text extras (a question queue) as a guarded push list, rendered newest-first.

## Form UX on phones (this is where generated apps usually feel cheap)

- **Fewest possible fields.** Every field costs completions. Choice chips
  (`BigButton`/small buttons) beat typing; typing fields get a clear placeholder.
- **Controlled inputs**: keep drafts in `useState`, write to the store only on submit.
  Never `rt.set` per keystroke (rate limit + churn for everyone subscribed).
- **Validate before write, politely after**: disable submit until required fields are
  filled (a disabled button with a hint, not an alert). On `{ok: false}` from a push:
  "Couldn't submit — shorter message, or wait a moment" — and keep their draft intact.
- **Confirm loudly**: after submit, flip to a "You're in ✓ (edit?)" card showing what
  they submitted. Uncertainty makes people double-submit.
- **Show the aggregate immediately** — watching the room's numbers move after your own
  submission is the reward loop.

## Pitfalls

1. **Drafts in the store**: per-keystroke `rt.set` hits the rate limit mid-word and
   spams every subscriber. Draft in `useState`, store on submit.
2. **`uniqueBy` checks data fields**, not the item envelope — to enforce
   one-per-player you MUST copy `me.sessionId` into the pushed `data`.
3. **Losing the draft on rejection**: never clear the input before `ok: true` comes
   back.
4. **Aggregating with a counter doc**: incrementing "attending" counters alongside
   editable docs double-counts edits. Derive aggregates from `useDocs` on render;
   reserve `increment` for append-only tallies.
5. **maxLen is on the whole JSON payload** (default 4096) — with a `maxLength` on the
   input itself, users hit YOUR limit with a friendly message instead of the server's.

## Reference implementation — "Pizza Night RSVP"

RSVP with headcount and slice preference, editable after submit, live totals, plus a
guarded "requests" queue. Demonstrates every pattern above.

`appSpec`:

```json
{
  "name": "Pizza Night RSVP",
  "description": "Tell us if you're in, how hungry you are, and what to order.",
  "projector": true,
  "collections": {
    "responses": { "rateLimitPerMin": 12, "maxLen": 600 },
    "requests": { "rateLimitPerMin": 4, "maxLen": 200, "maxItems": 300 }
  }
}
```

`appTsx`:

```tsx
import { useState } from "react";
import * as Runtime from "@runtime/sdk";
import { Screen, Card, BigButton, Input, PresencePill, EmptyState, Grid, Stat, List } from "@runtime/ui";

type Rsvp = { name: string; going: boolean; slices: number; style: string };
const STYLES = ["Margherita", "Pepperoni", "Veggie", "Hawaiian (brave)"];

export default function App() {
  const me = Runtime.useMe();
  const rt = Runtime.useRt();
  const mode = Runtime.useMode();
  const presence = Runtime.usePresence();
  const mine = Runtime.useDoc("responses", me.sessionId) as Rsvp | null;
  const all = Runtime.useDocs("responses");
  const requests = Runtime.useList("requests");
  const [editing, setEditing] = useState(false);
  const [going, setGoing] = useState(true);
  const [slices, setSlices] = useState(2);
  const [style, setStyle] = useState(STYLES[0]);
  const [reqDraft, setReqDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Aggregates: derived on render from shared docs — no counter drift possible.
  const rsvps = all.map((d) => d.data as Rsvp);
  const goingList = rsvps.filter((r) => r?.going);
  const totalSlices = goingList.reduce((sum, r) => sum + (r.slices ?? 0), 0);
  const styleCounts = new Map<string, number>();
  for (const r of goingList) styleCounts.set(r.style, (styleCounts.get(r.style) ?? 0) + 1);
  const pizzas = Math.ceil(totalSlices / 8);

  const beginEdit = () => {
    if (mine) { setGoing(mine.going); setSlices(mine.slices); setStyle(mine.style); }
    setEditing(true);
  };

  const submit = async () => {
    setBusy(true);
    // Own-key doc: editable, idempotent, race-free.
    await rt.set("responses", me.sessionId, { name: me.name, going, slices: going ? slices : 0, style } satisfies Rsvp);
    setEditing(false);
    setBusy(false);
  };

  const sendRequest = async () => {
    const text = reqDraft.trim();
    if (!text) return;
    setBusy(true);
    const res = await rt.push("requests", { text, name: me.name });
    if (!res.ok) {
      setNotice("Couldn't send — keep it short, and give it a moment."); // draft preserved
    } else {
      setReqDraft("");
      setNotice(null);
    }
    setBusy(false);
  };

  const totals = (
    <Grid cols={3}>
      <Stat label="Going" value={goingList.length} />
      <Stat label="Slices" value={totalSlices} />
      <Stat label="Pizzas to order" value={pizzas} />
    </Grid>
  );
  const styleRows = [...styleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => (
      <div key={s} style={{ display: "flex", justifyContent: "space-between", minHeight: 44, alignItems: "center" }}>
        <span>{s}</span><strong>{n}</strong>
      </div>
    ));

  if (mode === "projector") {
    return (
      <Screen title="Pizza Night">
        <PresencePill count={presence.length} />
        {totals}
        <Card title="Style votes">
          {styleRows.length === 0 ? <EmptyState message="No RSVPs yet — phones out!" /> : styleRows}
        </Card>
      </Screen>
    );
  }

  const showForm = editing || mine === null;
  return (
    <Screen title="Pizza Night RSVP">
      <PresencePill count={presence.length} />
      {totals}
      {showForm ? (
        <Card title={mine ? "Edit your RSVP" : "Are you in?"}>
          <Grid cols={2}>
            <BigButton variant={going ? "primary" : "secondary"} onClick={() => setGoing(true)}>I'm in 🍕</BigButton>
            <BigButton variant={going ? "secondary" : "primary"} onClick={() => setGoing(false)}>Can't make it</BigButton>
          </Grid>
          {going && (
            <>
              <p>How many slices?</p>
              <Grid cols={4}>
                {[1, 2, 3, 4].map((s) => (
                  <BigButton key={s} variant={slices === s ? "primary" : "secondary"} onClick={() => setSlices(s)}>{s}</BigButton>
                ))}
              </Grid>
              <p>Pick a style:</p>
              <Grid cols={2}>
                {STYLES.map((s) => (
                  <BigButton key={s} variant={style === s ? "primary" : "secondary"} onClick={() => setStyle(s)}>{s}</BigButton>
                ))}
              </Grid>
            </>
          )}
          <BigButton onClick={submit} disabled={busy}>{mine ? "Update RSVP" : "Submit RSVP"}</BigButton>
        </Card>
      ) : (
        <Card title="You're in the books ✓">
          <p>{mine!.going ? `Going — ${mine!.slices} slices of ${mine!.style}.` : "Not coming (we'll miss you)."}</p>
          <BigButton variant="secondary" onClick={beginEdit}>Edit my RSVP</BigButton>
        </Card>
      )}
      <Card title="Requests for the organizer">
        <Input value={reqDraft} onChange={setReqDraft} placeholder="e.g. gluten-free option please" />
        <BigButton variant="secondary" onClick={sendRequest} disabled={busy || reqDraft.trim() === ""}>Send request</BigButton>
        {notice && <p style={{ color: "var(--rt-accent)" }}>{notice}</p>}
        {requests.length > 0 && (
          <List items={requests.slice().reverse().slice(0, 10).map((r) => (
            <span key={r._id}><strong>{r.data?.name}:</strong> {r.data?.text}</span>
          ))} />
        )}
      </Card>
    </Screen>
  );
}
```

Adapt: swap the fields (talk feedback = rating chips + comment; potluck = dish + serves;
workshop signup = track choice) — the editable own-key doc, render-time aggregation, and
guarded extras queue stay identical.
