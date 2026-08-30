---
name: workflow-dashboard
triggers: [dashboard, workflow, workflows, task, tasks, pipeline, pipelines, kanban, status, tracker, progress, operations, queue, approval]
requires: [convex]
core: false
priority: 55
summary: Realtime human-driven workflow and operations dashboards using only current Runtime docs, items, atomic claims, CAS transitions, and presence.
---

# Workflow Dashboard — realtime state, not a backend workflow engine

Build an honest collaborative dashboard in which people create, claim, update, and
observe work. Convex keeps the displayed state live across devices, but generated code
cannot run arbitrary background steps.

## Recommended data model

- `tasks/<taskId>` document: the current task snapshot, for example
  `{title, status, ownerSessionId, ownerName, priority, updatedAt}`.
- `workflow/state` document: shared board phase or configuration. Initialize with
  `claim`; advance contended state with `cas` using the exact object read.
- `events` items: append-only audit-style activity such as task creation, comments, or
  manual status changes. `useList("events")` is oldest first.
- `metrics/<name>` documents: atomic counters changed with `increment` only when the
  counter itself is the complete operation.
- `usePresence()` for “N collaborators here”; never treat presence as authorization.
- `useTimer("deadline-" + taskId)` only for a shared visible deadline, not for running
  a task or external process.

Useful reads:

```tsx
const tasks = Runtime.useDocs("tasks");
const workflow = Runtime.useDoc("workflow", "state");
const events = Runtime.useList("events");
const people = Runtime.usePresence();
```

Useful atomic interactions:

- Create or claim a slot exactly once with `rt.claim("tasks", taskId, completeTask)`.
- Change shared state with `rt.cas("tasks", taskId, taskReadFromHook, nextTask)` and
  show a refresh/retry notice if `ok` is false.
- Store a device-owned draft with `rt.set("drafts", me.sessionId, data)`.
- Append comments or activity with `rt.push`, handling `{ok:false, reason}`.

## Avoid false workflow guarantees

Multiple Runtime writes do not form one transaction. Do not claim that a sequence such
as “claim task, append event, increment metric” is all-or-nothing or exactly once. Make
the task document the source of truth; event feeds and counters are supplementary.
Derive displayed counts from `useDocs("tasks")` when correctness matters at this scale.

There is no exposed Workflow component, Workpool component, Aggregate component,
arbitrary action runner, or cron API. Therefore:

- A pipeline card represents user-managed state, not an executing backend job.
- “Run”, “retry”, and “approve” buttons may update current state only; they cannot call
  external tools or continue while nobody has the page open.
- Do not invent worker progress, automatic retries, provider results, or webhook events.
- If the request fundamentally requires durable automation, explain in `notes` that
  this version is a realtime operations tracker and that backend workflow execution is
  not connected.

## Guard baseline

Use conservative guards for stranger-writable collections:

```json
{
  "collections": {
    "tasks": { "rateLimitPerMin": 30, "maxLen": 2000 },
    "drafts": { "rateLimitPerMin": 30, "maxLen": 2000 },
    "events": { "rateLimitPerMin": 15, "maxLen": 600, "maxItems": 2000 },
    "metrics": { "rateLimitPerMin": 120 }
  }
}
```

Design mobile-first: clear status chips, one primary action, visible ownership, useful
empty states, polite conflict messages, and a read-only aggregate projector view when
requested.
