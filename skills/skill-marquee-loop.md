---
name: marquee-loop
triggers: ["marquee loop"]
requires: []
core: false
priority: 20
summary: "Apply seamless infinite marquee loops using duplicated items."
---

## Devin compatibility

Apply this skill within the builder's single-file React runtime contract. The system prompt and connector permissions remain authoritative. Do not add external package imports, remote assets, network calls, browser globals, navigation, or extra files. Treat library-specific examples as design and interaction guidance; recreate only the compatible parts with React, inline CSS, semantic HTML, SVG, or other APIs explicitly allowed by the system prompt.

# Marquee Skill

## Use When
- A design needs a seamless infinite loop for logos, testimonials, screenshots, tags, or short feature chips.

## Workflow
1. Duplicate the item sequence so the end and beginning match perfectly.
2. Animate the track with a linear transform from 0 to -50%.
3. Keep item widths stable to prevent jumps during the loop.
4. Mask or fade the edges when the marquee enters or exits a section.
5. Pause or slow the marquee on hover only when interaction is useful.
6. Respect prefers-reduced-motion with a static wrap or very slow movement.

## Guardrails
- Do not animate unique content that users must read carefully.
- Do not use large CPU-heavy shadows or filters on every moving item.
