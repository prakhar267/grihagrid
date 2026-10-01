# Go-live goal — 2 October 2026

The customer outcome is a usable, supportable house-planning service with tested
recovery and operating controls. Existing styling and the shared 2D/3D/tour model
remain the product baseline. The owner's launch scope and domain/private support
choices are pending; provider-dependent features keep their existing gates.

## Private backup acceptance

The prepared receiver must accept the current source restore evidence, reject
older or incomplete schema evidence, and fail CI when migration requirements
change without a corresponding receiver review. The receiver uses only an
expiring workflow token, copies verified encrypted bytes to an existing private
repository, preserves the source expiry, and never decrypts SQL or widens access.

The previous implementation expected 83 schema objects and 173 columns, while the
current restore verifier checks 93 objects and 192 columns. Updating the pins
and adding a regression against every applied migration prevents this mismatch
from remaining hidden behind the earlier account billing block.

A working private destination requires actual workflow execution, source ZIP
permission, private artifact verification, and bounded retention. A successful
local test, metadata request or empty repository is insufficient. No billing
limit change, new subscription, broad token, or database deletion is authorized
by this work. The manual copy and its private artifact have now been verified; recurring copies
were enabled by private repository PR #2 after exact-head verification. No schedule delivery or human notification
receipt has yet been observed.

KPI: a current encrypted backup can be retained privately and verified, with no
plaintext/customer records in logs and no private expiry beyond the source's
expiry. The source workflow continues publishing encrypted public artifacts
with its existing seven-day retention. An additional private copy does not
change the access or expiry of either existing or future source artifacts.


## Evidence and remaining acceptance

- Manual private copy: run 36932350443 attempt 2, artifact 11196941803;
  identical ciphertext/manifest, private anonymous access 404, expiry bounded.
- Reviewed scheduled receiver: private main 17d506fc2389f99ca197184a55229ca781af2aa7;
  exact-head permission probe 36933045083 and post-merge manual copy 36933139846
  passed. Scheduling remains subject to provider delivery and existing budget.
- Source regression suite: 43 focused tests passed; all current migrations
  require exactly 93 objects / 192 columns.
- Final local Node 24 and exact-main CI runs each passed 956/956 tests, with no
  failures or skips. The original timeout/disk/fixture failures and superseded
  diagnostic attempts are retained separately; they are not passing evidence.
- External prerequisites: owned sender domain and private support destination,
  delivery/recovery provider evidence, independent monitoring destination and
  alert receipt, governed remote-restore access, physical iPhone and spoken
  VoiceOver verification. Paid offer/provider credentials and R2 subscription
  decisions remain necessary before activating those separately gated services.

## Dependency security cut

The fresh audit rejected the original lockfile: DOMPurify 3.4.15 is affected by
[GHSA-p98j-92pf-mc4p](https://github.com/advisories/GHSA-p98j-92pf-mc4p), and
Wrangler's Undici dependency had newly published advisories. Upgrade DOMPurify
to 3.4.16 and Wrangler to 4.146.0, resolving Undici 7.29.1. The locked tree now
reports zero vulnerabilities. GrihaGrid does not use the DOMPurify IN_PLACE /
afterSanitize hook combination described by that advisory; patching still keeps
the sanitizer current. Preserve existing strict SVG import restrictions.

Review of the published Wrangler 4.146.0 source confirmed unchanged keepalive,
reconnection intervals and warning formatting. Align the isolated release CLI
pin and its exact-version formatter test; never loosen tail failure detection.

The initial local full gate failed with a timeout, a fixture that assumed umask
022, and ENOSPC errors. The synthetic symlink fixture now establishes its intended
0644 permissions explicitly before asserting that the target remains untouched.
Original failure logs were retained. The corrected full suite passed with the
patched dependencies; this result supersedes neither the failed attempts nor
the separate requirement for exact-version production observation.

Passing source tests does not establish readiness of unconfigured providers.

Wrangler's updated Miniflare schema removed `workers[].config.type`. The first
patched diagnostic run exposed that change before D1 setup. Only that obsolete
fixture field was removed in the ten direct-Miniflare test files; bindings,
migrations and assertions were preserved. The corrected logout race passed
with the patched runtime in 1.4 seconds and subsequently in the full suite.
The superseded patched diagnostic run was stopped and is not acceptance evidence.

## Runtime release evidence

- Source: [PR #96](https://github.com/prakhar267/grihagrid/pull/96), squash commit
  `83d32c0415faf1b2a008806808c17e5522cb75b5`.
- Exact-main [CI 36935105034](https://github.com/prakhar267/grihagrid/actions/runs/36935105034)
  passed 956/956 tests with no skips. [CodeQL 36935104525](https://github.com/prakhar267/grihagrid/actions/runs/36935104525)
  passed JavaScript/TypeScript, Python and Actions analysis. The release gate
  independently checked exact-commit analysis and open alerts.
- [Production](https://grihagrid.prakhargupta267.workers.dev/) Worker:
  `083e405c-660a-4bbc-b600-d712b022b264`.
  [Staging](https://grihagrid-staging.prakhargupta267.workers.dev/) Worker:
  `b84143cc-d4b6-4b65-862b-7cad3dc21e72`.
- [Protected release 36935942679](https://github.com/prakhar267/grihagrid/actions/runs/36935942679)
  is the authoritative record for deployment, canaries, cleanup and production
  observation. The observation step began 1 October at 22:48:33 UTC. Acceptance
  requires a complete successful 30-minute window and the final version fence;
  elapsed wall time or passing canaries alone do not establish that result.
  The first attempt was rejected for `transient_connection_loss`; the existing
  bounded policy began attempt 2 at 23:12:37 UTC. That interrupted first window
  is not passing evidence. No duration, error classification or retry limit was
  relaxed for this release.
- No new migrations; all 25 validate locally and neither deployed environment
  had a pending migration. Staging's 66-request authenticated canary left zero
  residue and restored its exact session baseline. Staging readiness passed
  20 samples with p95 258 ms, below the unchanged 500 ms gate.
- Bounded load checks made 60 requests at concurrency six per environment:
  zero failures, p95 133 ms staging / 137 ms production. These are single-source
  checks of health/readiness/estimate, not traffic-capacity or SLO certification.
- Current browser verification covers three-floor edit/stair/rebuild/tour and
  camera-restore behavior, Chrome downloads and production sanitized SVG input,
  and native desktop Safari plan/tour rendering. The downloaded Courtyard model
  also completed six native Blender previews; geometry and camera round trips
  stayed within 0.002 mm. This is not a new paired-render or full-film check.
- The download-event API timed out in both automated browser adapters. Chrome's
  actual new files were verified independently. This run did not establish an
  IAB download result; the dated 26 September evidence remains historical.
  Safari's download-permission prompt was cancelled, so no new Safari download
  success is claimed. No test model was committed to a private customer house.

## Unresolved owner and provider dependencies

Fresh inspection still found no GrihaGrid sender domain in Resend and no private
support inbox. Domain/inbox choices and real verification/reset email delivery
remain required. Independent monitoring needs its intended alert destination,
activation and a delivered alert. The configured private-copy schedule also
needs an observed scheduled run and human failure-notification receipt.

D1 is at 10/10 databases; the local OAuth grant lacks D1 scope. The current
read-only restore preflight failed before any export, creation, import or
deletion. A governed remote rehearsal needs a fresh isolated slot and scoped
access. No existing database was removed or subscription upgraded.

iPhone Mirroring requires the owner's Mac unlock. Physical iPhone/Safari and
spoken VoiceOver remain unverified. Desktop browser evidence does not close
those checks. R2 remains unsubscribed, and paid activation still needs the
intended offer, provider credentials and concrete subscription/terms decisions.
Payment, fulfillment and private-upload controls remain closed.
