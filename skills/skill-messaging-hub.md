---
name: messaging-hub
triggers: [message, messaging, chat, inbox, notification, slack, telegram, sms, whatsapp, discord, voice, call, webhook, channel]
requires: [convex]
core: false
priority: 60
summary: Honest in-app realtime messaging patterns; external delivery and inbound webhooks are unavailable unless separately implemented and authorized.
---

# Messaging Hub — shared in-app messages only

With the current builder, Convex can power a fast realtime message wall inside the
generated app. Selecting Convex alone does **not** authorize or expose Slack, Telegram,
SMS, WhatsApp, Discord, voice calls, email, push delivery, or inbound/outbound webhooks.
Never imply a message was sent to or received from one of those services.

## Supported in-app pattern

- Read the public room feed with `useList("messages")`; it is oldest first and returns
  at most 300 items.
- Send with `rt.push("messages", {text, name: me.name, sessionId: me.sessionId, channel})`.
- Handle `{ok:false, reason}` and leave the draft intact when rejected.
- Use `usePresence()` for the live viewer count and `useMe()` for the local display
  identity.
- Use keyed docs for shared channel metadata or announcements.
- Use `increment("reactions", messageId, "like", 1)` for atomic public reaction
  counts. It does not enforce one reaction per person.
- Render model/user text as text, never HTML.

Minimal guarded spec:

```json
{
  "collections": {
    "messages": { "rateLimitPerMin": 10, "maxLen": 500, "maxItems": 1000 },
    "channels": { "rateLimitPerMin": 10, "maxLen": 1000 },
    "reactions": { "rateLimitPerMin": 120 }
  }
}
```

Every message button should disable while pending, reject empty input, enforce a short
client-side character limit, and show a friendly retry message. Empty rooms should say
“Start the conversation” rather than render a blank list. A projector view may show the
latest messages and presence but must have no composer.

## Privacy and channel limitations

The app is one anonymous public room. `sessionId` is not authentication. Client-side
filtering by a `channel` or recipient field does not make messages private because the
underlying app-scoped feed remains readable. Do not promise secure direct messages,
private inboxes, verified senders, moderation roles, or confidential support chat.

## Requests naming external services

If the user asks for Slack, Telegram, SMS, WhatsApp, Discord, voice, email, or webhook
integration, build only an explicitly labeled **in-app messaging hub** when that still
provides value. State in `notes` that external delivery and webhook ingestion are not
connected. Do not add fake “sent” receipts, provider logos that imply connectivity,
phone/email destination fields, or simulated inbound provider events.

Generated TSX must not import provider SDKs, call `fetch`, define webhook routes, or ask
for credentials. Real provider support requires a separate connector grant, server-side
credentials, outbound Convex actions, verified HTTP actions, replay protection,
idempotency, rate/cost controls, and a Runtime wrapper—none are currently exposed.
