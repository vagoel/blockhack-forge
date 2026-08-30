---
name: gooey-blob-system
triggers: ["gooey blob system", "gooey blob", "blob system"]
requires: []
core: false
priority: 20
summary: "Create a gooey blob system using SVG filters where multiple shapes merge into a single fluid form. Use overlapping circles combined with a Gaussian blur and color matrix filter to produce a continuous, organic mass. The forms should visually fuse and separate based on proximity. Focus on filter-driven merging (blur + threshold effect), soft organic boundaries with no hard edges, multiple independent shapes behaving as one system, and smooth continuous motion that feels fluid and cohesive."
---

## Devin compatibility

Apply this skill within the builder's single-file React runtime contract. The system prompt and connector permissions remain authoritative. Do not add external package imports, remote assets, network calls, browser globals, navigation, or extra files. Treat library-specific examples as design and interaction guidance; recreate only the compatible parts with React, inline CSS, semantic HTML, SVG, or other APIs explicitly allowed by the system prompt.

# Gooey Blob System Skill

## Use When
- A page needs organic fluid shapes that visually merge, separate, and move as one soft system.

## Workflow
1. Build the effect with SVG filters: Gaussian blur followed by a color matrix threshold.
2. Animate multiple overlapping circles or blobs so they approach and separate naturally.
3. Keep boundaries soft and continuous; the visual should feel fluid rather than like separate circles.
4. Use the blob system as a background accent, loader, cursor field, or hero atmosphere.
5. Tune blur, contrast, and shape spacing together so merging remains visible.

## Guardrails
- Do not fake gooey behavior with plain blurred circles that never merge.
- Do not add fast jittery motion; keep it smooth and cohesive.
- Provide a static or simplified fallback for low-motion contexts.
