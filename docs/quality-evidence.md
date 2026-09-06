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

This is pre-merge engineering evidence. Protected exact-SHA CI, CodeQL,
staging/production promotion and post-deploy canaries remain required, and the
human/external evidence in the table above remains independent of this result.
