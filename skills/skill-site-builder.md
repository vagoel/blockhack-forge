---
name: site-builder
triggers: [website, site, landing, landing-page, portfolio, saas, company, product, homepage, marketing]
summary: Build polished full-width responsive sites without defaulting to rooms, games, presence, or unsupported web capabilities.
---

# Site Builder — a polished website, not an event-game shell

When the request is a website, landing page, portfolio, company site, SaaS page, or
product showcase, treat it as editorial product design. Do not add a lobby, QR prompt,
presence counter, leaderboard, projector mode, room identity, multiplayer mechanic, or
game language unless the user explicitly asks for one.

## Composition

- Produce one cohesive, full-width responsive page in the required single TSX file.
  Use edge-to-edge themed bands with centered inner content (`maxWidth` around
  1080–1200px), generous vertical rhythm, and mobile stacking below tablet width.
- Build a clear story: compact brand header, high-signal hero, proof or metric strip,
  benefits/features, a concrete product or work showcase, trust/FAQ where relevant,
  and one final call to action. Omit sections that add no information.
- The hero needs a specific promise, one explanatory sentence, and one dominant action.
  Avoid vague “revolutionize your workflow” filler and walls of badges.
- Create depth with CSS only: layered surfaces, restrained gradients using theme
  variables, thin translucent borders, soft shadows, rounded panels, typographic scale,
  and simple geometric illustrations. Use whitespace before decoration.
- Make the first viewport feel complete on both a 375px phone and a wide desktop.
  Prefer `clamp()` for headings and spacing, CSS grid/flex with wrapping, and 44px
  minimum controls. Avoid fixed widths, horizontal scrolling, hover-only meaning, and
  dense desktop nav on phones.

## Interaction and state

Most marketing sites need no shared backend. Use no Convex collections unless the user
asked for durable/shared behavior and Convex is authorized. Small UI interactions
(FAQ disclosure, selected feature, contact-step mockup) may use React local state.
Buttons must do something visible within the page or be clearly labelled previews;
never fake a completed signup, payment, email, download, or navigation.

## Sandbox-safe visual rules

- Import only `react`, `@runtime/sdk`, and `@runtime/ui`; default-export one component.
- Never render `<a>`, `href`, navigation, iframe, or external embeds. Never call
  `window`, `document`, `location`, `open`, or network APIs.
- No remote photos, stock-image URLs, icon libraries, fonts, videos, or audio. Use CSS,
  text, Unicode, and small inline helper components. The only permitted external image
  is a conditional, size-constrained `Runtime.useTheme().logoUrl`.
- Style with `var(--rt-*)` tokens and `color-mix`; do not hardcode a parallel palette.
  Preserve contrast and visible focus states.

## Quality bar

Use real copy derived from the prompt and supplied grounding, consistent nouns, concise
cards, and a strong visual hierarchy. Ensure every section still makes sense when the
logo or data is absent. Prefer three excellent feature cards over ten generic ones.
End with a deliberate final panel rather than letting the page trail off.
