---
name: realtime-state
triggers: [state, sync, shared, live, realtime, collaborative, together, multiplayer]
requires: [convex]
core: true
priority: 90
summary: Core patterns for modeling shared realtime state — docs vs items vs scores, loading semantics, write primitives, and guard design.
---

# Realtime State — the foundation every app builds on

This skill is always included. It defines how to think about shared state before any
game-specific pattern applies.

## The three storage shapes — pick deliberately

| Shape | Read | Write | Model it as |
|---|---|---|---|
| **Docs** (keyed, mutable) | `useDoc(c, k)` / `useDocs(c)` | `rt.set` / `rt.claim` / `rt.cas` / `rt.increment` | Current-state facts: game phase, whose turn, per-player profile keyed by sessionId, tallies |
| **Items** (append-only log) | `useList(c)` — oldest first, newest LAST, cap 300 | `rt.push` — can be rejected by guards | Events that happened: bids, messages, submissions, moves history |
| **Scores** (built-in leaderboard) | `useLeaderboard(top?)` | `rt.setScore` / `rt.addScore` | Points per player — never reinvent this with docs |

Decision rule: if you'd overwrite it, it's a doc. If you'd append it, it's an item. If
it's points, it's a score. A doc keyed by `me.sessionId` is the standard "my stuff"
slot — writes never contend because only one device owns the key.

## Loading and existence semantics (source of most generated-app crashes)

- `useDoc` → `null` while loading AND when never set. Never `doc.phase` — always
  `doc?.phase ?? "lobby"`. Design the state machine so `null` means the sensible initial
  phase.
- `useDocs` / `useList` / `useLeaderboard` / `useDataset` / `usePresence` → `[]` while
  loading. `[]` must render as an inviting empty state (`EmptyState`), not a broken
  board.
- There is no "loaded" flag. Make the null/empty render valid and the app is correct by
  construction.

## Write primitives — matching primitive to contention

- **Uncontended or owner-only** (my profile doc, host-only control doc): `rt.set`.
  Last-writer-wins is fine because there is only one writer.
- **Two+ players might write the same key at once**: `rt.set` will silently drop one
  write. Use `rt.claim` (first writer wins, losers told) or `rt.cas` (write only if
  unchanged since read).
- **Counting under concurrency**: `rt.increment(c, k, field, by)` — atomic, returns new
  value. NEVER `rt.set(c, k, {count: doc.count + 1})` — two phones reading 5 both write
  6 and a tap is lost.
- **Appending under guards**: `rt.push` — and always handle `{ok: false, reason}`:

```tsx
const [notice, setNotice] = useState<string | null>(null);
const submit = async () => {
  const res = await rt.push("messages", { text, name: me.name });
  if (!res.ok) {
    setNotice("That didn't go through — slow down and try again.");
    return;
  }
  setText("");
  setNotice(null);
};
```

## Guard design (appSpec.collections)

Every collection that strangers write to gets a guard entry. Defaults: 30 writes/min per
session, 4096 bytes per data payload, 5000 items per collection.

- Free-text feed → `{ rateLimitPerMin: 10, maxLen: 300, maxItems: 500 }`
- Hot counter collection (tap games) → `{ rateLimitPerMin: 600 }` (the default 30/min
  breaks tap games), and batch client-side if even that could be exceeded.
- One-per-player push → `{ uniqueBy: "sessionId" }` and include `sessionId` inside the
  pushed `data` (the guard inspects data fields, not the item envelope).

## Pitfalls

1. **Module-level state**: `let count = 0` outside the component is per-phone and
   volatile. All shared state through `rt.*`; all local state through `useState`.
2. **Mirroring server state into useState**: don't `useEffect(() => setPhase(doc.phase))`.
   Render directly from the hook. Local state is only for in-flight input (text being
   typed, `busy` flags, dismissed notices).
3. **Deriving "latest" wrong**: `useList` is newest-LAST. Latest item =
   `list.at(-1)`. Reversing for display: `list.slice().reverse()`.
4. **Caps**: `useList` returns at most 300 items, `useDocs` 500. For long-running feeds
   show the recent slice and design so old items don't matter.
5. **Awaiting nothing**: buttons that write should set a `busy` flag around the await so
   double-taps don't double-write (guards are the backstop, not the UX).

## Reference implementation — "Reaction Wall"

A live wall: anyone posts a short message; anyone taps emoji reactions (atomic
counters). Demonstrates docs + items + increment + guards + rejection UX + empty states.

`appSpec`:

```json
{
  "name": "Reaction Wall",
  "description": "Post a thought, react with emoji — live with everyone in the room.",
  "projector": true,
  "collections": {
    "posts": { "rateLimitPerMin": 6, "maxLen": 240, "maxItems": 400 },
    "reactions": { "rateLimitPerMin": 120 }
  }
}
```

`appTsx`:

```tsx
import { useState } from "react";
import * as Runtime from "@runtime/sdk";
import { Screen, Card, BigButton, Input, PresencePill, EmptyState, Avatar } from "@runtime/ui";

const EMOJI = ["🔥", "💡", "😂", "👏"] as const;

function Post(props: {
  id: string;
  name: string;
  text: string;
  counts: Record<string, number>;
  canReact: boolean;
  onReact: (emoji: string) => void;
}) {
  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Avatar name={props.name} />
        <strong>{props.name}</strong>
      </div>
      <p style={{ margin: "8px 0" }}>{props.text}</p>
      <div style={{ display: "flex", gap: 8 }}>
        {EMOJI.map((e) => (
          <button
            key={e}
            onClick={() => props.onReact(e)}
            disabled={!props.canReact}
            style={{
              minWidth: 64, minHeight: 44, fontSize: 18,
              background: "var(--rt-surface)", color: "var(--rt-text)",
              border: "1px solid var(--rt-secondary)", borderRadius: "var(--rt-radius)",
            }}
          >
            {e} {Number(Object.entries(props.counts ?? {}).find(([key]) => key === e)?.at(1) ?? 0)}
          </button>
        ))}
      </div>
    </Card>
  );
}

export default function App() {
  const me = Runtime.useMe();
  const rt = Runtime.useRt();
  const mode = Runtime.useMode();
  const posts = Runtime.useList("posts");            // oldest first, newest last
  const reactionDocs = Runtime.useDocs("reactions"); // one doc per post id
  const presence = Runtime.usePresence();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const countsByPost = new Map(reactionDocs.map((d) => [d.key, d.data as Record<string, number>]));
  const newestFirst = posts.slice().reverse();

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    const res = await rt.push("posts", { text, name: me.name });
    if (!res.ok) {
      setNotice("Couldn't post — you may be going too fast. Try again in a moment.");
    } else {
      setDraft("");
      setNotice(null);
    }
    setBusy(false);
  };

  const react = (postId: string, emoji: string) => {
    void rt.increment("reactions", postId, emoji, 1); // atomic tally
  };

  const wall = newestFirst.length === 0 ? (
    <EmptyState message="Nothing here yet — post the first thought!" />
  ) : (
    newestFirst.map((p) => (
      <Post
        key={p._id}
        id={p._id}
        name={p.data?.name ?? "Guest"}
        text={String(p.data?.text ?? "")}
        counts={countsByPost.get(p._id) ?? {}}
        canReact={mode === "player"}
        onReact={(e) => react(p._id, e)}
      />
    ))
  );

  if (mode === "projector") {
    return (
      <Screen title="Reaction Wall">
        <PresencePill count={presence.length} />
        {wall}
      </Screen>
    );
  }

  return (
    <Screen title="Reaction Wall">
      <PresencePill count={presence.length} />
      <Card title="Say something">
        <Input value={draft} onChange={setDraft} placeholder="Your thought (240 chars)…" />
        <BigButton onClick={submit} disabled={busy || draft.trim().length === 0}>
          Post it
        </BigButton>
        {notice && <p style={{ color: "var(--rt-accent)" }}>{notice}</p>}
      </Card>
      {wall}
    </Screen>
  );
}
```

Adapt by swapping what a "post" is (question, photo caption, idea) and what the counter
docs tally — the doc-per-item-id + `increment` shape stays the same.
