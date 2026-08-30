---
name: convex-platform
triggers: [convex, backend, database, reactive, realtime, transaction, serverless, storage, search, vector, component]
requires: [convex]
core: true
priority: 100
summary: What Convex can do as a platform versus the smaller, exact Runtime surface available to a generated single-file app.
---

# Convex Platform — use only what the builder exposes

Convex itself is a reactive TypeScript backend. Native Convex applications can define
cached reactive queries, transactional mutations, actions for external API calls, HTTP
actions for webhooks, scheduled functions and crons, file storage, full-text search,
vector search, and schemas with generated TypeScript types. Convex mutations are atomic
and serializable. Convex also has installable backend components such as Agent, RAG,
Workflow, Workpool, Aggregate, Migrations, and Resend.

Those are **platform capabilities, not automatic generated-app capabilities**. This
builder emits one TSX file inside a sandbox. It does not emit or deploy Convex backend
files. Use only the following exact surface.

## Builder-exposed Runtime matrix

| Need | Available API | Exact boundary |
|---|---|---|
| One mutable shared value | `useDoc`, `rt.set`, `rt.claim`, `rt.cas`, `rt.increment` | Keyed generic documents scoped to this app |
| Many mutable shared values | `useDocs` | Up to 500 keyed documents |
| Realtime event/message feed | `useList`, `rt.push` | Append-only, up to 300 returned, oldest first |
| Scores and ranks | `useLeaderboard`, `rt.setScore`, `rt.addScore` | One score row per anonymous session |
| People currently viewing | `usePresence`, `useMe` | Best-effort presence; session identity is not authentication |
| Shared deadline | `useTimer`, `rt.startTimer` | One-shot bounded server timer; not a general job scheduler |
| Build-time extracted rows | `useDataset` | Read-only; may be empty |
| Theme and display mode | `useTheme`, `useMode` | Live theme plus player/projector rendering |
| Connector inspection | `useConnectors` | IDs only; never credentials |
| Runtime AI | `useAI` | Only when the OpenAI connector is separately enabled |

Every subscription above is backed by a prebuilt, app-scoped Convex query. Every
`rt.*` write calls a prebuilt mutation. Values are generic JSON-like data, not a newly
generated typed Convex schema.

## Transaction boundary

One `rt.*` mutation call is atomic. Two awaited calls are **two transactions**:

```tsx
// NOT one atomic workflow: the second call can fail after the claim commits.
const won = await rt.claim("jobs", jobId, { status: "running", owner: me.sessionId });
if (won.claimed) await rt.increment("stats", "all", "started", 1);
```

Prefer one write that records the complete fact, or derive counts from the claimed
documents. Never promise exactly-once side effects across multiple Runtime calls.
Use `claim` for create-if-absent races, `cas` for changing a document only if it still
matches what was read, and `increment` for a single atomic numeric update.

## Hard prohibitions

- Never import `convex/*`, `@convex-dev/*`, or a provider SDK.
- Never define a schema, query, mutation, action, HTTP action, cron, component, or
  server file in generated TSX.
- File storage, native full-text/vector search, arbitrary scheduled jobs, Agent, RAG,
  Workflow, Workpool, Aggregate, Migrations, Resend, and external webhooks are not in
  the current Runtime. Do not call them or claim they work.
- Convex permission does not authorize Slack, Telegram, SMS, WhatsApp, Discord, voice,
  email, or any other external service.
- Anonymous `sessionId` values support UX and rate limiting only. Do not claim private
  records, secure roles, payments, prizes, or adversarial authorization.

If a request needs an unavailable backend capability, build the closest honest
realtime in-app experience with the matrix above and state the limitation in `notes`.
