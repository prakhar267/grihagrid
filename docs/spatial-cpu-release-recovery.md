# Detailed-house save CPU recovery — 22 September 2026

Protected release 35657643288 stopped in staging while saving the first detailed
Jaipur G+2 model. Cloudflare Observability recorded “Worker exceeded CPU time
limit.” at 2026-09-21 21:35:17.378 UTC for POST `/api/projects/:id/spatial`, on
Worker `d7aec81e-f23c-477d-bf97-7f7f94280689`. This is a confirmed runtime CPU
failure, not a failed database migration or a demonstrated KV outage.

The canary deleted its synthetic project and cascading records, restored its
session baseline, and proved zero residue. Automatic rollback restored staging
Worker `3fdf3566-674f-449a-aeb5-ff981b913b60`. Production never started. Migration
0024 remains applied only in staging; the deployed-source migration admission
in PR #85 must carry it through the next protected release.

## Customer outcome and acceptance

A homeowner can preview and save the furnished three-storey house, then persist
its cameras and tour without exhausting the free Worker's CPU budget. All rooms
must still have collision-safe walking connections and real stair connections.
No plan upgrade, reduced clearance, omitted furnishings, skipped connectivity
validation, new migration or changed API contract is part of this correction.

Success requires the same Jaipur/Delhi authenticated canary, clean rollback and
residue evidence, exact-version staging and production checks, and the full
production observation. Local timing is diagnostic evidence; it cannot certify
Cloudflare's per-invocation budget. No release success is asserted here.

## Validation changes

Connectivity first builds a bounded graph of room anchors, doorway positions
and approaches, usable corners and stair landings. Each horizontal edge passes
the existing continuous obstacle sweep and floor-support samples. Stair edges
pass the existing full 3D route check independently in each direction. A graph
is accepted only when every room anchor is reachable. Door and wall references
only suggest candidates; they never waive geometric clearance.

If that proof does not connect every room, or its 1,024-node/4,096-edge-check
budget is exceeded, the existing detailed route search remains the fallback.
Repeated directed floor/stair segments share work only during one synchronous
validation, capped at 1,024 entries per map. Normal camera routes retain their
coordinates and do not receive these caches.

Within that same validation scope, obstacle bounds and trigonometry are prepared
once. Rectangular interiors use direct bounds; their boundaries and all other
polygons retain the original point-in-polygon calculation. Scope cleanup and
mutable-obstacle regression checks prevent caches surviving a later edit.

On the local development machine, the unchanged release fixtures initially
required approximately 170–240 ms for schema/connectivity validation. The new
connectivity path measured approximately 7–24 ms across cold/warm samples;
model schema validation and tour validation are measured separately. These
figures are not a portable performance test or a guaranteed production latency.

The focused suite includes sealed upper rooms, missing upper stairs, top-floor
starting rooms, disconnected/rotated obstacles, scope cleanup, 3,000 additional
independent continuous-geometry comparisons, and the existing floor/entry/room
scenario matrix. The real D1 release canary and full repository gate remain
required before merging.
