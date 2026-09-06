# Quality evidence record

Automation is necessary release evidence, not a substitute for independent
human review. Attach evidence to the exact candidate SHA and do not convert an
unchecked row into a claim.

| Evidence | Repository proof | External proof still required |
|---|---|---|
| Correctness and regressions | Locked install, fresh migrations, build, full Node/workerd/D1 suite, operational config, Worker dry-runs, and high-severity audit | Staging and production canaries on the exact deployed version |
| Load and resilience | `npm run load:smoke` uses bounded concurrency, nearest-rank p95, no payload output, and explicit remote opt-in | Recorded multi-region service observation and a timed remote restore drill |
| Accessibility | Semantic controls, live status/error regions, mobile/reflow and print styles; source assertions cover lifecycle and reviewer routes | Keyboard-only plus VoiceOver/NVDA at 390 px and 200% zoom, contrast/text-spacing/reduced-motion checks, with tester/date/issues |
| Security and privacy | Cross-owner tests, one-time hashed tokens, exact-report hashes, immutable events, normalized images, fail-closed provider bindings, dependency audit, and CodeQL gate | Independent penetration review, provider/domain review, retention review, and incident exercise |
| Professional quality | Verified-profile workflow and no-approval language | License verification by a named operator and review of representative reports by a suitably qualified practitioner |

## Runtime and tablet-auth production release — 2026-09-07

- PR [#70](https://github.com/prakhar267/grihagrid/pull/70) head
  `8c19a7e7ea5b8267f5a4327c07edd2b5f840d5f2` passed exact-head
  [CI](https://github.com/prakhar267/grihagrid/actions/runs/34056177988) and
  [CodeQL](https://github.com/prakhar267/grihagrid/actions/runs/34056176670),
  then squash-merged as `2f1498aa9f46f42480f7e70716d5f2a2e43139c1`.
  Exact-main [CI](https://github.com/prakhar267/grihagrid/actions/runs/34056495039),
  [CodeQL](https://github.com/prakhar267/grihagrid/actions/runs/34056494493),
  and [deployment](https://github.com/prakhar267/grihagrid/actions/runs/34056840262)
  passed. The local locked gate built successfully, passed all 461 tests and
  all 21 migrations, completed both Worker dry-runs, and reported zero high-
  severity audit findings.
- That release serves React/React DOM 19.2.8, Vite 8.2.2,
  `@vitejs/plugin-react` 6.1.1, and Wrangler 4.129.0. Staging
  `9cc45632-bd33-4e39-a284-0202c0e8bd6f` passed 20/20 readiness samples at
  366 ms p95; production `da2f748b-4c64-4cef-997e-2f0ce5fb0741` passed 20/20
  at 246 ms p95. Its full 30-minute observation passed 220/220 checks; latency
  ranged from 9 to 270 ms and averaged 48 ms, with zero invocation-tail or
  handled-server-error events.
- PR [#71](https://github.com/prakhar267/grihagrid/pull/71) head
  `49cb5f87a14e093ebb565e2d8c672f5aca5ca4f4` reserved normal-flow space for
  the tablet authentication back action. Exact-head
  [CI](https://github.com/prakhar267/grihagrid/actions/runs/34057793849) and
  [CodeQL](https://github.com/prakhar267/grihagrid/actions/runs/34057792671)
  passed before squash merge as `da348f23e644cd9cc78efffab7c7b4cd008fb101`.
  Exact-main [CI](https://github.com/prakhar267/grihagrid/actions/runs/34059055433),
  [CodeQL](https://github.com/prakhar267/grihagrid/actions/runs/34059054828),
  and protected [deployment](https://github.com/prakhar267/grihagrid/actions/runs/34059381087)
  passed as the final release gates. The local locked gate built successfully,
  passed all 462 tests and 21 migrations, completed both Worker dry-runs, and
  reported zero high-severity audit findings.
- Staging `9093a84c-9520-4cfd-b21a-df3ea43d89fd` served 100% traffic for the
  exact release SHA and passed 20/20 readiness samples at 253 ms p95. Its
  authenticated canary completed the owner-scoped project, report, feedback,
  share/revoke, paid-closed, upload-closed, cleanup, and logout path; it left
  zero project/report/share residue and restored the report-handoff control.
- Production `892cd66a-288a-4072-9dad-591835786477` also served 100% traffic
  for the exact release SHA and passed 20/20 readiness samples at 249 ms p95.
  Its authenticated canary left zero project/report/share residue, restored
  its session baseline, and restored the enabled report-handoff control. The
  full observation from 2026-09-06 21:05:49Z to 21:35:49Z passed 220/220
  checks; latency ranged from 8 to 353 ms and averaged 46 ms. Exact-version
  invocation and handled-server-error tails each recorded zero events and zero
  bytes, remained alive through the monitor, and stopped only during teardown.
- The final production browser pass produced 51 clean public route/width
  checks at 390/720/1440 px and 20 clean authentication breakpoint checks at
  390/720/900/901 px. It found no horizontal overflow or tested structural-
  accessibility defect, and confirmed a non-overlapping 32–93 px gap between
  the back action and heading. This does not substitute for keyboard-only,
  VoiceOver/NVDA, independent security, legal, or practitioner review.
- Repository APIs reported zero open Dependabot, CodeQL, or secret-scanning
  alerts. `main` still requires exact CI and CodeQL checks, enforces those rules
  for administrators and resolved conversations, and disallows force pushes
  and deletion. Payment, fulfillment, the paid-plan allowlist, private uploads,
  email delivery, and custom-domain dependencies remain fail-closed.

## Responsive production release — 2026-09-07

- PR [#68](https://github.com/prakhar267/grihagrid/pull/68) head
  `cd3ec7fd835c197acf28bd9ee08dbe47beb16968` passed exact-head
  [CI](https://github.com/prakhar267/grihagrid/actions/runs/34051697700) and
  [CodeQL](https://github.com/prakhar267/grihagrid/actions/runs/34051696648),
  then squash-merged as `6cd4b76a6506a7455e12793a98b017f960fb54f5`.
  Exact-main [CI](https://github.com/prakhar267/grihagrid/actions/runs/34052014393),
  [CodeQL](https://github.com/prakhar267/grihagrid/actions/runs/34052014419),
  and the [protected release](https://github.com/prakhar267/grihagrid/actions/runs/34052368832)
  passed.
- The locked local verification built the production bundle, passed all 460
  tests and all 21 migrations on a fresh D1 database, completed production and
  staging Worker dry-runs, reported zero high-severity audit findings, and left
  payment, fulfillment, the payment-plan allowlist, and private uploads closed.
- Staging `c7fb1e05-59ab-4d09-b53e-3fc0bbc5bf17` and production
  `a3d6f043-820d-4e04-abdb-bea54bf0b498` serve 100% traffic for the exact SHA.
  Staging readiness passed 20/20 samples at 290 ms p95; production passed 20/20
  at 319 ms p95. Both authenticated canaries left zero project/report/share
  residue and restored the report-handoff control.
- The production monitor completed 20 samples, 220 requests and 220 successful
  checks over the full 30 minutes. Request latency ranged from 10 to 897 ms and
  averaged 59 ms; both exact-version tail aggregates recorded zero events and
  zero unexpected stderr.
- Deployed browser checks confirmed the fixed pricing-card reflow at 390, 601,
  720, 799, 800, 900, and 1440 px. A 17-route audit at 390/720/1440 px produced
  51 clean route/width results for overflow and basic semantic/accessibility
  structure. This automated inspection does not replace the human keyboard,
  VoiceOver/NVDA, independent security, legal, or practitioner reviews.

## Human test record template

Record candidate SHA, environment/version, date/time zone, tester and role,
device/browser/assistive technology, test data classification, each scenario and
result, issue links/severity, retest result, and explicit sign-off or rejection.
Screenshots and tickets must not contain passwords, email tokens, bearer links,
raw project inputs, reviewer evidence documents, or private image URLs.

At the time this document was added, no human accessibility certification,
independent penetration test, real practitioner acceptance, R2 activation,
provider email canary, named on-call acceptance, or timed remote restore was
performed by this change.

## Local load rehearsal — 2026-09-02

A fully migrated local Worker completed 60 bounded requests at concurrency six:
20 health, 20 readiness, and 20 estimate requests. Failures were zero; nearest-
rank p95 was 50 ms and maximum was 56 ms. This is local regression evidence,
not a production capacity claim or multi-region observation.

## Free-production candidate rehearsal — 2026-09-06

- A locked `npm ci` install and `npm run check` completed successfully: the
  production bundle built, all 459 serialized tests passed, and operational
  configuration validation confirmed paid defaults closed.
- All 21 migrations applied to a fresh local D1 database. Production and
  staging Worker dry-runs completed with isolated D1/KV resources and no R2 or
  paid bindings. `npm audit --audit-level=high` reported zero vulnerabilities.
- The strengthened public smoke passed 11 checks against each live origin.
  Production reported configured AI; staging reported unavailable AI; both
  reported current schemas, available free capabilities, unavailable private
  storage/email delivery, and closed checkout/fulfillment.
- The sample Architecture Design Document rendered as a tagged, unencrypted,
  27-page A4 PDF. All rendered pages were visually inspected as a contact sheet;
  the eight-row responsibility matrix stayed together on its own page and
  screen-only skip navigation was absent from the final render.

PR [#61](https://github.com/prakhar267/grihagrid/pull/61) subsequently released
this candidate as exact SHA `737f1df28dbb2dba4e809fa82ea2d1473df3e6fa`.
Exact-SHA CI, CodeQL, staged deployment, authenticated canaries, public smoke,
and a 30-minute production observation passed. The observation completed 20
samples and 220 checks with zero invocation/server-error events. The
human/external evidence in the table above remains independent of this result.

## Noncommercial operations release — 2026-09-06

- Release artifact actions are upgraded to their reviewed Node 24 generations
  and remain pinned by commit SHA.
- A protected-`main`, twice-daily production D1 workflow exports, records a Time
  Travel point, encrypts with authenticated AES-256-GCM, decrypt-verifies the
  checksum, restores into isolated local D1, and gates SQLite integrity and
  foreign-key checks. It retains only ciphertext and a bounded manifest for 7
  days and removes runner material unconditionally.
  The imported application database is opened read-only with Node SQLite for
  these PRAGMAs because workerd correctly rejects `integrity_check` with
  `SQLITE_AUTH`; the workflow never weakens the Worker SQL sandbox.
- Backup and hourly public-smoke failures each own one bounded GitHub issue,
  assign it to the repository owner, and close it after recovery. Both expose a
  deliberate manual failure exercise that must be followed by a successful run.
- Cloudflare credentials and the backup passphrase remain step-isolated. The
  workflow cannot enable checkout, paid fulfillment, a paid-plan allowlist, or
  private uploads.

PRs [#62](https://github.com/prakhar267/grihagrid/pull/62) and
[#64](https://github.com/prakhar267/grihagrid/pull/64) merged these controls as
exact main SHA `cae4f34187b29decaff37053e5405aef513d595e`. Exact-main
[CI](https://github.com/prakhar267/grihagrid/actions/runs/34030486356),
[CodeQL](https://github.com/prakhar267/grihagrid/actions/runs/34030486016), and
[deployment](https://github.com/prakhar267/grihagrid/actions/runs/34030813096)
passed. Production readiness passed 20/20 samples at 264 ms p95, and the
30-minute exact-version monitor passed 220/220 checks with zero invocation or
server-tail events.

Normal encrypted backup
[34032877094](https://github.com/prakhar267/grihagrid/actions/runs/34032877094)
proved encryption, checksum, isolated restore, SQLite integrity and zero
foreign-key violations, retained only ciphertext plus the bounded seven-day
manifest, and closed the earlier restore incident. Deliberate pre-export
failure [34033189322](https://github.com/prakhar267/grihagrid/actions/runs/34033189322)
opened owner-assigned incident
[#65](https://github.com/prakhar267/grihagrid/issues/65); recovery backup
[34033502508](https://github.com/prakhar267/grihagrid/actions/runs/34033502508)
closed it only after repeating the full backup proof. Deliberate public-smoke
failure [34033801131](https://github.com/prakhar267/grihagrid/actions/runs/34033801131)
opened owner-assigned incident
[#66](https://github.com/prakhar267/grihagrid/issues/66), and normal smoke
[34033824978](https://github.com/prakhar267/grihagrid/actions/runs/34033824978)
passed both origins and closed it.

A real remote recovery drill, independent two-region monitoring, human
accessibility/security/practitioner review, qualified legal approval, and named
staffing remain external evidence and are not inferred from automation.
