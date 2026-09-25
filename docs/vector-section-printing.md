# Compact vector section printing

## Customer outcome

A homeowner or architect downloads the complete drawing set and uses its Print
button to save an A3 landscape PDF. The three-storey Jaipur and Delhi test sets
previously produced 118–120 MB PDFs in Chrome 153 because each section cut surface
expanded an SVG hatch pattern into raster resources. Native printing exposed the
problem after the HTML export itself had passed.

Section hatches now use diagonal vector segments clipped numerically to each cut
rectangle. Their 2 mm paper spacing, source identity, outlines and shared section
geometry are retained. No browser pattern reference or clipping ID is needed.

Acceptance: unchanged sheet count, A3 dimensions and extracted text; no raster
image objects in these vector-only study PDFs; each complete test set below 2 MB;
visible hatching confined to cut surfaces. Guardrails: no model, revision, camera,
provider, database or release-control changes. These remain concept drawings.

## Verified 25 September 2026

| Native Chrome Save as PDF | Jaipur | Delhi |
| --- | ---: | ---: |
| Pages, A3 landscape | 19 | 18 |
| Previous bytes | 117,979,973 | 119,777,767 |
| Revised bytes | 1,352,052 | 1,298,084 |
| Size reduction | 98.85% | 98.92% |
| PDF raster image objects | 0 | 0 |
| All page text preserved | Yes | Yes |

The PDFs were produced through the actual drawing-set Print button and Chrome's
native Save as PDF UI, reopened with a PDF parser, rendered, and visually checked.
All 37 pages were reviewed, including both section directions at higher resolution.
Regression tests cover clipped endpoints, negative coordinates, thin members,
constant spacing, invalid/empty rectangles and cut-source identities in both axes.

The studio retained keyboard focus when moving the section cut. B–B at 51%
transferred into the matching all-storey 3D section. Desktop, 390 px and actual
Chrome 200% zoom had no page overflow. Reduced-motion mode and console checks
passed. Physical iPhone and spoken VoiceOver remain explicitly deferred.

Before this fix, fresh production scene JSON and GLB downloads for both cities
were also checked. Scene content and drawing-set HTML matched the verified saved
studies. All 652 Jaipur / 626 Delhi primitive transforms and each saved camera
matched the shared render recipe, with zero transform difference.

Release evidence belongs to the exact merged commit and protected workflow;
local checks alone do not assert deployment. No migration is introduced.
