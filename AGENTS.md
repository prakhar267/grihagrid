# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable product direction

The selected visual direction is **Architectural Monograph**. Keep the experience editorial, calm, and materially grounded: warm ivory paper (`#f3efe6`), near-black ink (`#181511`), restrained copper actions (`#a7532f`), Cormorant Garamond display type, DM Sans interface type, thin rules, generous whitespace, and photography that feels like a premium Indian architecture journal. Avoid gradients, glossy SaaS card walls, pill-heavy controls, decorative glassmorphism, and playful illustration. Product screens should feel like working pages from the same architectural book, not a separate admin template.

The product name is **GrihaGrid**. The core promise is: “Know what fits. Know what it costs.” It is an India-first concept-planning and professional-handoff product, never a substitute for licensed architectural, structural, geotechnical, or municipal work.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
