---
name: openai
triggers: [ai, artificial intelligence, assistant, generate, summarize, brainstorm, openai, gpt]
requires: [openai]
core: true
priority: 90
summary: Safe runtime AI through the bounded server-side Runtime.useAI proxy.
---

# OpenAI — bounded AI inside the generated app

This skill appears only when the operator explicitly enables the OpenAI connector.
The browser never receives a provider key and may not call the network directly.

## Exact API

```tsx
const ai = Runtime.useAI();
// ai.available: boolean
const text: string = await ai.generate("A concise, self-contained prompt");
```

`generate` is a server-side, rate-limited text operation. It may reject because of a
quota, provider error, or temporary network issue. Always catch errors, stop loading,
and show a friendly retry message. Keep prompts short and do not send secrets or
sensitive personal data.

```tsx
const ai = Runtime.useAI();
const [answer, setAnswer] = useState("");
const [busy, setBusy] = useState(false);
const [notice, setNotice] = useState<string | null>(null);

const ask = async () => {
  setBusy(true);
  setNotice(null);
  try {
    setAnswer(await ai.generate("Give one playful icebreaker question for a team."));
  } catch {
    setNotice("AI is taking a breather — try again in a moment.");
  } finally {
    setBusy(false);
  }
};
```

## Rules

- Call AI only after an intentional user action; never on every render or keystroke.
- Disable the triggering button while a call is pending.
- Render a useful initial and failure state so the app still works without a response.
- Never claim the model has live web access, private data, or tools.
- Never ask for or display API keys. Never use `fetch` or another network primitive.
- Treat model output as untrusted text. Render it as text, never HTML.
- Keep one request focused; do not create autonomous loops or fan out multiple calls.
