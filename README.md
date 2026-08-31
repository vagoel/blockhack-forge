# Khayaal AI

**Team:** 404 NOT FOUND — Varun, Vaibhav Patel, Huda, Nimra Ahmed  
**Tagline:** *Khayaal* (خيال) is Arabic for **imagination** — describe it, Devin builds it, the room plays it, live.  
**Repo:** https://github.com/vagoel/blockhack-forge  
**Demo:** https://blockhack-forge-console.vercel.app  
**Deck:** https://blockhack-forge-console.vercel.app/presentation  
**Video demo:** https://www.loom.com/share/828e83d3a32444f9baf2a6429994b6d5  
**Hackathon:** https://collabute-hackathon.vercel.app/#resources

## Problem
An idea dies waiting for a team to build it. A live, multi-user app needs a backend, a database, realtime sync, design, and a deployment pipeline — five or more tools and days of wiring. By the time it ships, the moment is gone, and people without code never ship at all.

## Target users
Teachers, event hosts, founders, and communities — anyone with an idea for an interactive, shared experience (quizzes, polls, leaderboards, auctions, launch sites) but no engineering team or time.

## Solution
Khayaal AI turns a sentence into a live app with a shareable URL. The operator describes the app in the Console and picks its capabilities; the platform grounds the build, generates the code with Devin, compiles it **right in the browser tab** (no build server), and publishes it with a QR code plus a public Vercel URL. Anyone who scans joins instantly from their phone — no account, no install — and every device stays in sync in realtime.

**Key features:**
- **Prompt → production in five moves:** Prompt → Ground (Context.dev) → Generate (Devin) → Compile in-browser → Go live (QR + Vercel URL)
- **Multi-user realtime by default:** presence, scores, votes, and timers flow through Convex — a room full of phones stays in sync with no refresh
- **Instant hot-swap:** ship an update and every open phone swaps to the new version live
- **Brand grounding:** give a URL and the generated app picks up its colors, fonts, style, and data
- **100+ skill library:** curated instruction guides (realtime state, leaderboards, quizzes, theming, WebGL effects, …) composed into each Devin prompt
- **Safe by design:** generated code runs in a sandboxed iframe against an approved runtime SDK + UI kit; all secrets stay server-side

## Partner tech usage

| Tech | How we used it |
|---|---|
| **Devin by Cognition** | Devin is the product's **engine**, not just our dev tool: every generated app is written by a Devin API session, driven by a prompt Convex composes from our 100+ skill library plus the grounding context. Devin Cloud modes are selectable per build. The platform itself was also built with the Devin CLI workflow. |
| **Convex** | The **entire backend** — we run zero servers of our own. Convex handles build orchestration and storage, the operator/app data model, and all realtime sync (presence, scores, timers), including instant hot-swap of updated apps to every connected device. |
| **Context.dev** | Grounds every build in the real web: brand colors, fonts, and styleguides resolved from any URL, plus live data and docs extracted for the generated app — on-brand results with zero scraping code. |

## Impact
Idea → live multi-user app goes from days of setup to minutes — roughly 100× faster to something shareable. Anyone with imagination can ship a live app before their coffee cools: no code, no servers, no wait.

## Pre-existing assets
None — all core functionality was built during the event. Standard open-source libraries and the partner platforms (Devin, Convex, Context.dev, Vercel, optional OpenAI proxied server-side) are used as external services.
