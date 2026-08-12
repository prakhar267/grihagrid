# Design QA — Architectural Monograph

## Evidence

- Source visual truth: `/Users/prakhar/Desktop/HouseForge/grihagrid/design-references/selected-architectural-monograph.png`
- Final desktop implementation: `/Users/prakhar/Desktop/HouseForge/grihagrid/qa-artifacts/monograph-desktop-final.png`
- Final mobile implementation: `/Users/prakhar/Desktop/HouseForge/grihagrid/qa-artifacts/monograph-mobile-final.png`
- Normalized side-by-side comparison: `/Users/prakhar/Desktop/HouseForge/grihagrid/qa-artifacts/monograph-comparison-final.jpg`
- Desktop: source 1487 × 1058 px; implementation 1487 × 1058 px; CSS viewport 1487 × 1058; device scale 1.
- Mobile: implementation 390 × 844 px; CSS viewport 390 × 844; device scale 1.
- State: anonymous homepage, selected Architectural Monograph direction, production content.

## Full-view comparison

The implementation preserves the selected composition and hierarchy: a thin editorial header; 45/55 split hero; ivory paper field; restrained copper actions; large high-contrast serif headline; integrated estimator, steps, and privacy line; and a full-height Indian residential hero. The final house asset now contains the floor-plan drawing, plot dimensions, and handwritten site note as one purpose-built raster, matching the reference's architectural-journal treatment.

The intentional product deviations are accurate dimensional input instead of a single area field, live city/floor controls, an honest range appropriate to the current calculation rules, and stronger professional-boundary language. These preserve the visual anatomy while making the experience functional and safer.

## Focused comparison

- Typography: Cormorant Garamond produces the selected high-contrast editorial display character; locally served DM Sans matches the quiet interface copy. The headline wrap, optical scale, and navigation weight align closely with the target.
- Spacing and layout: header rule, copy origin, hero split, headline-to-body rhythm, estimator rules, and bottom step row align with the source. The final implementation slightly reduces the left-column width, giving the house stronger presence while keeping every planning control legible.
- Colors: warm ivory (`#f3efe6`), near-black ink (`#181511`), copper (`#a7532f`), muted brown-grey, and hairline rules match the reference without gradients or glossy SaaS treatments.
- Image quality: bespoke 1536 × 1024 daylight Indian-house raster with integrated plan/dimensions/note; JPEG production derivative is 570 KB and remains sharp at desktop and mobile crops. No placeholder, CSS art, inline SVG, watermark, person, or car is present.
- Copy and content: the same core promise and information order are retained. Claims are deliberately bounded to concept-stage feasibility rather than construction or approval.
- Mobile: 390 px capture has no horizontal overflow (`scrollWidth = 390`). Reading order is headline → copy/actions → architectural image → estimator, with an accessible compact menu.

## Comparison history

### Pass 1 — blocked

- **P1 asset fidelity:** the first house image lacked the reference's integrated floor-plan drawing and site annotations; HTML overlays only approximated the result.
  - Fix: regenerated the hero as a single edited raster with a faint plan, 30′/50′ dimension lines, and plot note; removed the HTML approximation.
- **P2 header proportion:** the brand's grid track visually consumed a full third of the header and pushed the navigation right of the reference.
  - Fix: set the brand track to the measured editorial width and kept a content-sized brand control.
- **P2 privacy/performance:** the first stylesheet still carried a Google Fonts import while Fontsource was installed.
  - Fix: removed the remote font dependency and limited bundled font files to required Latin subsets.

### Pass 2 — passed

The normalized final comparison shows no actionable P0/P1/P2 fidelity issue. Remaining P3: exact headline letterform contrast differs slightly because the generated reference used a proprietary/unidentified editorial serif; Cormorant Garamond is the closest appropriate freely available family.

## Browser verification

- Tested desktop 1487 × 1058 and mobile 390 × 844.
- Verified mobile menu open/close and `aria-expanded` state.
- Verified estimator details carry into the four-step brief.
- Completed all four wizard stages.
- Registered a real local account through the Worker, created an owned project, generated/cached its deterministic report, and opened it from the dashboard.
- Verified report values come from the stored project/report contract rather than fallbacks.
- Verified desktop and mobile have no horizontal overflow.
- Browser console: no warnings or errors on the final authenticated journey.
- Automated release checks: production build and the complete API/worker/site test suite pass.

final result: passed
