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
expiry. The original encrypted public artifact remains public until its existing
expiry; an additional private copy does not change that fact.


## Evidence and remaining acceptance

- Manual private copy: run 36932350443 attempt 2, artifact 11196941803;
  identical ciphertext/manifest, private anonymous access 404, expiry bounded.
- Reviewed scheduled receiver: private main 17d506fc2389f99ca197184a55229ca781af2aa7;
  exact-head permission probe 36933045083 and post-merge manual copy 36933139846
  passed. Scheduling remains subject to provider delivery and existing budget.
- Source regression suite: 43 focused tests passed; all current migrations
  require exactly 93 objects / 192 columns.
- One initial account-deletion race timed out under the local Node 23 full suite.
  The unchanged case passed in isolation under bundled Node 24 in 4 seconds.
  Full-suite and exact-head CI results must be recorded independently.
- External prerequisites: owned sender domain and private support destination,
  delivery/recovery provider evidence, independent monitoring destination and
  alert receipt, governed remote-restore access, physical iPhone and spoken
  VoiceOver verification. Paid offer/provider credentials and R2 subscription
  decisions remain necessary before activating those separately gated services.

Do not treat these operating changes as a new application deployment, or passing
source tests as evidence that the unconfigured providers are ready.
