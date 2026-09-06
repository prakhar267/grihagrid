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
