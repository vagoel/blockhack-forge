---
name: opinionated-ui
triggers: [ui, interface, design, beautiful, polished, premium, modern, website, app, dashboard, landing-page]
core: true
priority: 75
summary: An always-on visual direction for distinctive typography, composition, components, states, and motion without generic template aesthetics.
---

# Opinionated UI — make one strong visual argument

This is the visual standard for every product. Before JSX, choose one direction—editorial
precision, warm utility, kinetic system, calm luxury, or playful geometry—and make type,
space, shape, and motion support it. Do not blend directions. Source-style grounding wins
when supplied; refine it in original code.

Reject generator clichés: centered hero plus three equal cards, purple blobs, glass or
pills everywhere, decorative badges, and icons in rounded squares. Not every section is
a card. Create hierarchy with scale, alignment, contrast, whitespace, and composition.

- Typography: use `var(--rt-font)`. Display text uses `clamp()`, tight leading, and slight
  negative tracking; body is 16px+ with 1.5–1.7 leading and a readable max width.
- Layout: design at 375px, then compose desktop rather than stretching it. Create one
  dominant moment, a supporting rhythm, and a quiet zone; alternate density.
- CSS: use theme variables and `color-mix()`, strong neutrals, and one restrained accent.
  Keep one radius/border/shadow/control grammar. Controls are 44px+ with visible states.
  Scoped `<style>{css}</style>` is encouraged for responsive rules and animation.
- Motion: reveal hierarchy, progress, or feedback with one restrained entrance and
  160–280ms transitions. Avoid competing loops and honor `prefers-reduced-motion`.
- States: design loading, empty, error, success, disabled, and busy states. Preserve
  layout and pair progress with useful status; never ship a blank screen or lone spinner.

Inspect phone and desktop. Require one focal point, readable contrast, no overflow or
card monotony, and a result identifiable from a cropped screenshot—not just its source.
