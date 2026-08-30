---
name: admin-controls
triggers: [admin, administrator, manage, controls, reset, restart, moderate]
core: true
priority: 70
summary: Always add a client-side password-gated admin view with product-appropriate controls and resettable state modeling.
---

# Admin Controls — always present, deliberately limited

Every product includes a visible `Admin` button on normal site/player views, never the
projector. It opens a polished password gate accepting only the hardcoded string `123`.
Use a password input, error text, cancel/back, and lock. Keep password, unlocked state,
and errors in React state only; refresh relocks it. Never persist or send the password.

After unlock, show a dedicated admin page with fitting controls: reset a game/auction,
start a round, or clear safe local workflow state. Confirm destructive-looking actions
and show busy/success/failure feedback. A static site still shows an honest status plus
return/lock controls; never fabricate publishing or analytics.

`123` is visible in shipped source and is NOT authentication. It gates convenience only,
never secrets, identity, money, private data, or privileged provider operations.

Design resets from the start. With Convex, store numeric `round`/`epoch` in a control doc;
put it on items and prefix claimed keys with it. Reset atomically advances the epoch,
initializes required current docs/timer, and all clients render only that epoch. Old items
remain stored but leave the current view. Runtime cannot delete collections or reset all
leaderboard rows. Without Convex, reset the relevant local React state.
