# Design QA

## Evidence

- Source visual truth: `/Users/prakhar/Desktop/HouseForge/reference-audit/clean-01.png`
- Implementation desktop: `/Users/prakhar/Desktop/HouseForge/grihagrid/qa-artifacts/implementation-desktop-v2.png`
- Implementation mobile: `/Users/prakhar/Desktop/HouseForge/grihagrid/qa-artifacts/implementation-mobile-v1.png`
- Production desktop: `/Users/prakhar/Desktop/HouseForge/grihagrid/qa-artifacts/production-desktop.png`
- Combined comparison: `/Users/prakhar/Desktop/HouseForge/grihagrid/qa-artifacts/comparison-v2.png`
- Desktop viewport: 1440 × 1000 CSS px; source and implementation captures are both 1440 × 1000 physical px at device scale 1.
- Mobile viewport: 390 × 844 CSS px at device scale 1; implementation capture is 390 × 844 physical px.
- State: dark theme, anonymous homepage, promotion dismissed.

## Full-view comparison

The implementation preserves the source’s conversion architecture: compact sticky navigation, left-aligned outcome hero, right-side visual proof, paired primary/secondary CTAs, trust microcopy, four-column outcome strip, and a clear transition into a four-step explanation. Brand, headline, pricing and imagery are intentionally original. The generated architectural elevation is sharper and more credible than a copied schematic while keeping the same region balance.

## Focused comparisons

- Hero typography: Manrope/DM Sans produces the same dense, geometric hierarchy and wrap behavior without copying branded typography.
- Layout rhythm: desktop content width, hero split, above-the-fold density, CTA grouping and proof-strip spacing align with the source. Mobile intentionally moves the visual between explanation and CTA for a stronger evidence-first reading order.
- Colors/tokens: near-black navy surfaces, indigo/cyan emphasis, low-contrast borders and green success signals retain the reference language with an original palette.
- Image quality: the original 1536 × 1024 generated asset has a correct desktop crop, intentional mobile object position, no watermark and no placeholder/CSS illustration substitute.
- Copy/content: all product copy is original and replaces overclaiming “construction-ready” language with explicit concept-stage limits.
- Icons: Lucide provides one consistent open-source stroke family; no emoji, text glyph or handmade SVG substitutions are used.

## Comparison history

### Pass 1 — blocked

- **P2 typography fallback:** Manrope was declared without a generic fallback in shorthand declarations, so the first screenshot briefly rendered display text as serif before the remote font loaded.
  - Fix: added an explicit `Manrope`, `DM Sans`, system sans-serif stack for every display surface.
  - Post-fix evidence: `implementation-desktop-v2.png` and `comparison-v2.png`.
- **P2 mobile primary-action wrapping:** “Start free” wrapped at 390 px and increased header height.
  - Fix: added `white-space: nowrap`, mobile sizing and tighter padding for the header CTA.
  - Post-fix evidence: mobile browser inspection at 390 × 844; no horizontal overflow (`scrollWidth = 390`).

### Pass 2 — passed

No actionable P0/P1/P2 visual issues remain in the captured desktop and mobile states. Intentional deviations are the new brand, original generated hero, clearer safety language and evidence-first mobile ordering. Remaining P3: locally self-host fonts before a custom-domain launch to eliminate dependence on Google Fonts.

## Browser verification

- Tested mobile menu open/close.
- Changed plot-width slider by keyboard and confirmed estimate recomputation from 30 ft / ₹37.0L–₹44.3L to 31 ft / ₹38.3L–₹45.8L.
- Completed all four onboarding steps and generated the sample feasibility project.
- Verified dashboard and report routes, production homepage and production `/api/health`.
- Console: no warnings or errors on local core routes or the production homepage.
- Responsive: no horizontal overflow at 390 px.

final result: passed
