# Sponsor Tech Highlights — Why These Are Market Leaders

Research notes on the three mandatory partner technologies for the Collabute X TheBlock. Hackathon.
Use these to design meaningful integrations and to craft the pitch narrative.

---

## 1. Devin by Cognition — The AI Software Engineer

**What it is:** An autonomous AI software engineer that plans and executes complex, multi-step engineering tasks end-to-end — not just an autocomplete tool.

### Market-leading features

- **Full autonomy, not autocomplete** — Devin plans, codes, tests, debugs, and ships PRs the way a human teammate does, picking up review feedback and CI results until PRs are merged. Competitors (Copilot, Cursor) assist a human typing; Devin owns the task.
- **Fleet of parallel agents** — spin up multiple Devins for large tasks (e.g. migrating all repos in parallel), each with its own cloud IDE. Devin can even spawn sub-Devins for big jobs.
- **Devin API + Automations** — fully programmatic: `POST /v1/sessions` with a prompt creates a session; you can poll status, send messages, pass session secrets, attach playbooks and knowledge. This means *products can embed Devin as an engine*, not just use it as a dev tool.
- **Devin Wiki & Devin Search** — auto-indexes repos every few hours into wikis with architecture diagrams and cited answers to codebase questions. Best-in-class codebase understanding.
- **Confidence scores (2.1)** — Devin self-reports 🟢🟡🔴 task confidence, which is highly correlated with PR-merge success; scoring can run across Linear/Jira issues *before* spending compute.
- **Interactive Planning** — researches the codebase and proposes a plan in seconds; you align on it before autonomous execution.
- **Deep tool ecosystem** — native integrations with GitHub/GitLab, Slack, Linear, Jira, Datadog; browser + desktop use for visual QA.

### Hackathon integration angles

- Use Devin CLI/IDE for the entire build (document sessions as evidence of AI-assisted workflow).
- Call the **Devin API** from the product itself (e.g. a feature that triggers a Devin session to generate/fix code on demand).
- Show Devin Wiki/Search output in the demo to prove codebase-level understanding.

**API quickstart:** `POST https://api.devin.ai/v1/sessions` with `Authorization: Bearer $DEVIN_API_KEY` and `{"prompt": "...", "idempotent": true}` → returns `session_id`; poll `GET /v1/sessions/{id}` until `blocked`/`finished`.

---

## 2. Convex — The Reactive Backend Platform

**What it is:** An open-source, reactive database + serverless backend where queries are TypeScript functions running *inside* the database, with realtime sync to clients built in.

### Market-leading features

- **Reactivity by default** — queries automatically rerun and push updates to subscribed clients over WebSockets whenever underlying data changes. No polling, no cache invalidation, no socket code. Competitors (Firebase, Supabase) bolt realtime on; Convex makes it the core model.
- **End-to-end TypeScript type safety** — schema, server functions, and client are all typed; the client SDK knows your API shapes. UI components re-render automatically like React for your data.
- **ACID transactions with serializable isolation** — mutations are true transactions with optimistic concurrency control; the whole stack stays consistent (UI never shows a torn state).
- **Clean function model** — *Queries* (read, cached, reactive) / *Mutations* (transactional writes) / *Actions* (external API calls) / HTTP actions for webhooks. Clear boundaries = fewer bugs at hackathon speed.
- **Batteries-included platform** — file storage, cron jobs, scheduling, vector search, and full-text search built in; open source backend.
- **AI-native component ecosystem** — official drop-in components: **Agent** (threads/messages for LLM agents), **RAG** (semantic search + retrieval), **Workflow** (durable, resumable multi-step runs), **Workpool**, Aggregate, Migrations, Resend, and more.

### Hackathon integration angles

- Use Convex as the entire backend: schema, queries/mutations, realtime UI updates (great live-demo effect — two browsers updating instantly).
- Use the **Agent + RAG + Workflow components** if the product has AI agents — this is deep, judge-visible integration.
- Use scheduled functions/crons for background jobs.

**Docs via Context7:** `/websites/convex_dev`, components at `/get-convex/agent`, `/get-convex/rag`, `/get-convex/workflow`.

---

## 3. Context.dev — The Unified Web Context API

**What it is:** A single API that gives software and AI agents live, structured access to the web — scraping, crawling, extraction, brand intelligence — without building crawlers, running browsers, or managing proxies.

### Market-leading features

- **One key, every endpoint** — REST at `https://api.context.dev/v1` (`Authorization: Bearer ctxt_secret_...`), official SDKs, and an MCP server. Replaces multiple point vendors (scraper + proxy + brand-data + document parser).
- **Automatic anti-bot handling on every plan** — requests escalate through datacenter → residential proxy pools; Cloudflare, DataDome, and reCAPTCHA challenges are detected and handled automatically at no extra cost. Competitors charge premium tiers for this.
- **Stealth browser rendering** — JS-heavy pages and SPAs return real content, not empty shells; `settleAnimations`, `includeFrames`, and cache-freshness controls handle dynamic pages.
- **Natural-language browser actions** — up to 5 ordered pre-capture actions including `perform` with plain-English instructions like `click the "Load more" button` — reaches interaction-gated content without writing Playwright scripts.
- **Schema-typed extraction** — the Extract API crawls a site, prioritizes relevant pages, and returns JSON matching *your* JSON Schema. No selectors, no brittle parsing. Also: normalized product/catalog extraction.
- **Brand intelligence APIs** — resolve any domain into logo, colors, fonts, full styleguide, socials, address, NAICS/SIC codes, company description. Unique for rendering brand-aware UIs on the fly.
- **Documents too** — PDF, DOCX, XLSX, PPTX, CSV parsed natively to Markdown; full-site crawls yield one Markdown doc per page, ready for RAG ingestion.
- **Change monitoring** — watch webpages, sitemaps, or structured data for changes.

### Hackathon integration angles

- Feed live web data into the product: crawl/scrape → Markdown → store in Convex → RAG over it.
- Use **Extract (JSON Schema)** so the product gets typed data from arbitrary sites — very demo-friendly.
- Use **Brand APIs** to auto-theme the UI from any customer domain (instant "wow" moment).

---

## Cross-sponsor pitch narrative (for the deck)

> "Devin built it, Convex runs it, Context.dev feeds it."

- **Devin** = the AI engineering workflow (and optionally an in-product code/automation engine via its API).
- **Convex** = the realtime, transactional, AI-native backend the product runs on.
- **Context.dev** = the live, structured web-context pipeline powering the product's intelligence.

A strong architecture that uses all three *in the data path* (not just tooling) maximizes the 25% Partner Integration score:
**Context.dev** (ingest web data) → **Convex** (store, RAG, realtime UI, agent workflows) → **Devin** (built the system; optionally triggers automated code/ops tasks).
