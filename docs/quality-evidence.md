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
