---
name: whatsapp-scheduler
description: Build consent-based WhatsApp message scheduling with an official WhatsApp Business provider, durable backend jobs, templates, opt-outs, and delivery webhooks. Use for WhatsApp reminders, scheduled or recurring sends, follow-ups, and message-queue dashboards. Do not use for unsolicited bulk outreach or fake browser-only integrations.
metadata:
  short-description: Schedule compliant WhatsApp messages
---

# WhatsApp Scheduler

Build a reliable outbound-message workflow, not a UI that merely says “sent.” Reuse the
sound architectural idea behind OpenClaw—a continuously available gateway plus a narrow
channel adapter and allowlists—but prefer the official WhatsApp Business Platform (Cloud
API or an existing approved Business Solution Provider) for production sends. Do not
quietly connect a personal WhatsApp account through an unofficial web-session library.

## Start with the real capability boundary

Before editing code, identify which situation applies:

1. An official WhatsApp provider is already configured: extend its server-side adapter.
2. The project has provider credentials but no adapter: add the smallest backend adapter,
   durable scheduling path, and webhook receiver needed for the requested journey.
3. No WhatsApp provider is configured: build the queue/scheduling experience only when it
   remains useful, label delivery as disconnected, and list the exact setup still needed.

Never put access tokens, app secrets, webhook secrets, or provider calls in browser code.
Use environment variables and server-side functions. Never request that a user paste a
secret into a generated app or commit one to the repository.

In this repository, sandboxed generated `appTsx` currently has no WhatsApp Runtime API and
cannot call external services. A real send therefore requires explicit backend and Runtime
support outside the generated file. If the task is limited to generated TSX, create an
honest scheduler/approval dashboard and do not fabricate delivery receipts.

## Recipient and policy requirements

“Anyone” means any valid recipient who has explicitly opted in—not an arbitrary phone
number scraped from contacts or supplied by a third party.

- Normalize recipients to E.164 and display a masked form in ordinary logs and UI.
- Store opt-in evidence: recipient, business identity shown at consent, message category,
  source, wording/version, and timestamp.
- Re-check opt-out and suppression state immediately before dispatch, not only when the
  message is created.
- Make opt-out obvious and effective for future scheduled and recurring messages.
- Business-initiated messages use an approved template with validated parameters.
- Free-form replies are allowed only when the provider confirms the current customer-care
  window permits them; do not infer that window from a local clock alone.
- Do not build unsolicited campaigns, contact enumeration, spam rotation, or controls
  intended to evade WhatsApp quality or rate limits.

Treat policy and template rules as provider-owned and changeable. Confirm current official
WhatsApp Business documentation when implementing or modifying the live adapter.

## Durable Convex design

Prefer a small state machine whose source of truth lives in Convex:

```text
draft -> scheduled -> dispatching -> accepted -> delivered -> read
                   \-> canceled
                   \-> failed
                   \-> unknown
```

`accepted` means the provider returned a message identifier. It is not the same as
`delivered`. Only a verified webhook can advance delivery or read state. Use `unknown`
when a network failure leaves provider acceptance ambiguous; do not automatically resend
an ambiguous attempt because that can duplicate a real message.

Suggested records:

- `whatsappContacts`: normalized number, display name, timezone, consent categories,
  consent evidence, opted-out timestamp, and suppression reason.
- `whatsappMessages`: owner, contact, template name/language, validated parameters,
  scheduled UTC timestamp, original timezone, status, provider message ID, attempt count,
  last error, timestamps, and an immutable idempotency key.
- `whatsappSeries`: recurrence rule, timezone, next occurrence, active/canceled state, and
  the template payload for future instances.
- `whatsappWebhookEvents`: provider event ID or stable event fingerprint for deduplication.

Schedule from an authenticated mutation. In the same transaction, write the message and
call `ctx.scheduler.runAt()` with an internal function; retain the returned scheduled-job
ID for cancellation. The scheduled internal mutation must re-read the message, verify it
is still due and allowed, atomically change `scheduled` to `dispatching`, then enqueue one
internal action for the external provider call.

Keep external `fetch` in an `internalAction`. The action reads a bounded send payload,
calls the provider, and records the outcome through an internal mutation. Convex actions
with external side effects are not automatically retried; implement retries deliberately:

- Retry only clearly retryable, non-ambiguous failures with bounded exponential backoff
  and jitter.
- Honor provider rate-limit hints.
- Mark timeouts, connection loss after upload, or malformed responses as `unknown` unless
  the provider offers a safe reconciliation mechanism.
- Never claim exactly-once external delivery. The database transition can be atomic; the
  network side effect cannot.

Cancel and edit through authenticated mutations. Cancel the stored scheduled-function ID
when still pending and update state transactionally. The dispatch function must still
check status, consent, and suppression so a cancellation or opt-out that races with the
timer prevents the send whenever dispatch has not begun.

For recurrence, materialize one upcoming occurrence at a time. Preserve the recipient's
IANA timezone and calculate the next local occurrence explicitly so daylight-saving
changes do not shift a human-facing time. Set a finite end condition or require an active
series that the owner can pause.

## Provider adapter boundary

Keep provider details behind a narrow interface such as:

```ts
type WhatsAppSend = {
  toE164: string;
  template: { name: string; language: string; parameters: string[] };
  clientMessageId: string;
};

type WhatsAppAccepted = {
  providerMessageId: string;
  acceptedAt: number;
};
```

The implementation should:

- use a configurable Graph API version and the configured business phone-number ID;
- send only server-side with the bearer token sourced from environment configuration;
- validate provider responses before changing state;
- avoid logging authorization headers, full phone numbers, or message bodies by default;
- expose a fake adapter for deterministic tests rather than contacting WhatsApp in CI.

## Webhooks

Receive provider callbacks through a dedicated HTTP action:

- Support the provider's verification handshake without exposing the verification token.
- Verify the raw request signature with the configured app secret before parsing events.
- Reject invalid signatures and oversized or malformed bodies.
- Deduplicate events before applying state transitions.
- Match updates by provider message ID and allow only forward status transitions.
- Return quickly; schedule heavier processing internally.
- Keep webhook payloads bounded and redact personal data from logs.

Do not expose webhook mutations directly to clients. A client-supplied “delivered” flag is
never authoritative.

## Product experience

The primary flow should be fast and legible:

1. Pick an opted-in contact.
2. Choose an approved template and preview resolved parameters.
3. Select date, local time, and timezone.
4. Review recipient, consent category, exact content, and send time.
5. Schedule, then show a live queue with cancel/reschedule actions and honest statuses.

Separate drafts, scheduled, processing, delivered, failed, unknown, and canceled states.
Show actionable errors. Require confirmation for high-impact changes such as scheduling a
large batch or resending an unknown attempt. Do not use dark patterns that hide recipient
count, cost, template category, or opt-out state.

## Verification

Use synthetic numbers and a fake provider in tests. Cover at least:

- missing or category-mismatched consent;
- opted-out/suppressed recipient at creation and again at dispatch;
- invalid E.164 number and invalid template parameters;
- past timestamps, timezone conversion, and a daylight-saving boundary;
- cancellation and reschedule races;
- duplicate and out-of-order webhook events;
- accepted versus delivered status;
- rate limiting, clear transient failure, and ambiguous network failure;
- authorization isolation between operators;
- recurring-series pause and end conditions.

Before handing off, run the repository's type checks and focused tests. State whether the
WhatsApp transport was exercised against a provider sandbox, a fake adapter, or not at all.
