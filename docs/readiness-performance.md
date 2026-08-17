# Readiness performance contract

## Customer and operator problem

`GET /api/readiness` protects releases and lets the product hide unavailable
optional capabilities. On a fully current schema, the previous implementation
validated the same contract with 39 serial D1 statements. A slow readiness call
could therefore delay release gates, time out public synthetics, and leave the
Project Home upload control waiting even while D1 itself was healthy.

This release treats readiness latency as product reliability. It does not
weaken a schema check or turn the dependency-independent `/api/health` route
into a readiness claim.

## Baseline

Seven uncached serial requests per environment were captured on 16 August 2026
against merged-main SHA `13d9ff63d0558baf47c99ad2782ae1a2e2ccb0f2` after
each environment was serving its exact release version:

| Environment | Worker version | Success | Minimum | p50 | p95 | Average |
|---|---|---:|---:|---:|---:|---:|
| Production | `4ebd0c13-df99-4ebb-92f3-a91b3da7a8df` | 7/7 | 2,615 ms | 2,623 ms | 2,877 ms | 2,661 ms |
| Staging | `1b4e648f-ddb1-4248-87dc-defc833edaba` | 7/7 | 2,440 ms | 2,465 ms | 2,691 ms | 2,507 ms |

These operator-origin samples establish a before-release comparison; they are
not a load test, monthly SLO record, or independent multi-region monitor.

## Design

The Worker performs one read-only inventory query that returns only:

- table, index, and trigger names from `sqlite_master`; and
- column names for the bounded set of readiness-owned tables through
  `pragma_table_info`.

The same read-only SQL statement appends at most two rows from the singleton
Professional Handoff control lookup: zero means missing, one is normalized from
an integer to `enabled`, `disabled`, or `invalid`, and two proves duplicate drift
without transferring an unbounded result. JavaScript compares this atomic
snapshot with explicit per-capability manifests; it does not trust the D1
migration ledger as proof that a column or guard exists. The healthy path is
therefore one D1 execution, down from 39. No unrelated application row, schema
SQL, account identifier, project data, token, or secret enters the snapshot or
response. If an old or partial schema cannot execute the control arm, readiness
retries only the metadata inventory and forces the control unavailable.

The following semantics remain unchanged:

- an absent binding or failed/malformed inventory makes the database unknown
  and returns `503 not_ready`;
- a missing required table, column, index, or trigger marks only the relevant
  schema group `outdated`, and required-group drift keeps the product unready;
- an exact disabled handoff control keeps readiness current and makes only
  report sharing unavailable; a missing, failed, or malformed control is a
  schema-integrity failure that makes the whole probe not ready, without hiding
  the state behind a cache;
- KV, Gemini, uploads, checkout, fulfillment, and abuse-admission checks keep
  their existing fail-closed rules; and
- the public JSON shape and capability names do not change.

## Acceptance and guardrails

- Current schema: exactly one atomic metadata-and-control snapshot read.
- Partial schema: at most one failed snapshot plus one metadata-only fallback,
  with granular `outdated` state and no optimistic control capability.
- Inventory failure or structurally invalid rows: database error, no optimistic
  capability.
- No D1 mutation, cache, application-row scan, response-body expansion, or new
  binding.
- No migration: the release changes how existing metadata is inspected, not
  stored data or schema.
- No visual change: existing callers receive the same contract, with less time
  spent in their loading state.
- Automated release gate: after exact-version propagation and before any
  authenticated canary mutation, collect 20 serial, uncached, end-to-end
  samples against the exact staging and production Worker version. Preserve
  every sample in the environment's 30-day release-evidence artifact and
  require nearest-rank p95 strictly below 500 ms, 20/20 contract success, the
  reviewed environment-specific AI state, and closed handoff, checkout,
  fulfillment and upload controls. Do not discard outliers. This bounded gate
  complements rather than replaces the monthly multi-region SLO.

If the inventory query regresses correctness or latency, roll back the Worker;
no database rollback is necessary. Future schema capabilities must extend the
folded manifest instead of adding serial readiness queries.
