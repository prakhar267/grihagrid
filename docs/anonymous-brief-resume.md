# Anonymous brief resume

## Customer problem and release decision

A visitor can spend several minutes shaping a plot and household brief before
creating an account. Closing the tab or leaving the planner currently loses
that work and restarts the four-step flow. DISC-06 closes that activation gap:
one unfinished brief can remain on the same browser for seven days, and a
returning visitor must explicitly choose **Resume brief** or **Discard and start
over** before any saved values are shown.

This is intentionally local-only. Cross-device resume is not part of the
release. Adding an anonymous server record would create an unauthenticated
write-abuse surface, a bearer or cookie lifecycle, deletion and retention jobs,
and broader breach scope without evidence that cross-device recovery is needed.

## User journey

1. A visitor enters or changes a supported planner value. GrihaGrid writes one
   strict browser envelope and shows its exact expiry. An untouched default
   brief is not written unless the visitor explicitly chooses **Save & exit**.
2. Only an actual user edit or step change advances expiry to seven days.
   Re-selecting the current choice, reads, reloads, the recovery prompt, and
   Resume do not extend it.
3. **Save & exit** first canonicalizes the visible form and exits only after that
   exact step and value set is confirmed as the current browser version. Invalid
   visible input keeps the planner open, focuses the field, and never substitutes
   an older saved value. **Discard draft** removes the exact active version. A
   stale tab cannot overwrite or delete a newer version.
4. A return to `/start` shows a value-free recovery choice before hydrating the
   form. Resume restores the exact step, structured values, estimator source,
   and project-creation idempotency key. Discard creates a fresh key and clean
   default brief.
5. Account navigation carries only a continuation marker, the opaque key, the
   expected write UUID and revision, and one bounded `public_estimator` or
   `shared_estimate` source marker. The full draft never enters a URL, query,
   cookie, `history.state`, or `sessionStorage`.
6. Immediately before an authenticated create can reach the Worker, the exact
   draft is marked `submitting` and becomes non-editable. A lost response or
   server failure becomes `retry_required`; the next attempt reuses identical
   project bytes and the original key.
7. A confirmed `201` creation or `200` idempotent replay conditionally consumes
   only the submitted browser version after the client validates the exact HTTP
   status and a bounded, canonical project envelope with a UUID. A malformed or
   unexpected `2xx` leaves the draft frozen for safe retry. A newer version is
   never erased by an older response.

## Browser contract

The sole persisted full-payload key is `grihagrid.anonymousDraft.v1`. Its exact
envelope contains:

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "writeId": "123e4567-e89b-42d3-a456-426614174001",
  "step": 1,
  "updatedAtMs": 1786935600000,
  "expiresAtMs": 1787540400000,
  "projectCreationKey": "123e4567-e89b-42d3-a456-426614174000",
  "entryPoint": null,
  "status": "editing",
  "draft": {}
}
```

The draft has exact own keys for project name, width, length, city, facing,
floors, bedrooms, optional bathrooms, parking, optional road width, plot shape,
accessibility, future use, optional working budget, exterior direction, and
finish. Every scalar, enum, finite-number boundary, nullable value, timestamp,
UUID, serialized length, schema version, and envelope key is validated before
read, write, or submit. Unknown or nested fields reject the record.

`entryPoint` remains exactly `null` or `public_estimator`, preserving the
published v1 format accepted by the previous application version. A shared-link
continuation instead uses `grihagrid.anonymousDraftAttribution.v1`, whose exact
source-only shape is:

```json
{
  "schemaVersion": 1,
  "projectCreationKey": "123e4567-e89b-42d3-a456-426614174000",
  "entryPoint": "shared_estimate",
  "expiresAtMs": 1787540400000
}
```

The sidecar is accepted only when its UUID and expiry exactly match a valid,
unattributed v1 envelope. It contains no tuple, brief value, account field,
stable browser identifier, price, token, or server record. A stale, orphaned,
malformed, mismatched, or expired sidecar is always ignored and is removed when
the non-blocking boot Web Lock is acquired; contention or unsupported locks may
leave the inert record until a later eligible boot. Create, discard, and
abandonment compare-delete the matching record.
If storage fails, the fixed source remains only in same-tab memory/navigation.
The sidecar is measurement metadata only: it cannot alter the draft, estimate,
owner, or authorization decision. On an asset rollback, the prior client ignores
the unknown sidecar and continues to read the unchanged v1 draft; it may omit
the new attribution, but it cannot delete the brief or misclassify it as the
landing-page estimator.

The browser envelope has no dedicated fields for:

- uploads, file names, bytes, object URLs, base64, EXIF, or storage keys;
- address, coordinates, email, password, account ID, project ID, session cookie,
  CSRF value, bearer capability, provider identifier, or arbitrary metadata;
- a public estimate, saved report, AI output, server response, or error detail.

The project name is user-entered text inside the allowlisted draft. It can contain
identifying or sensitive text if a visitor types it, so the recovery UI discloses
that boundary and visitors should use a neutral label rather than an address,
email, credential, or other personal information.

Browser storage is plaintext to the browser profile, extensions, and other
people using that profile. Product copy says “saved on this browser,” never
“encrypted” or “private.” Browser eviction can occur before seven days. Expired
or corrupt records are removed when GrihaGrid next runs only when a non-blocking
exclusive Web Lock is available; a contending planner is never read or changed.
There is no claim that a closed browser executes a timer.

If Web Storage is blocked or quota-limited, the planner remains usable and one
same-page application continuation can use an in-memory copy. The UI says that
the brief is kept only in the open tab. Reloading in that condition recovers the
last confirmed browser version, when one exists, and never falls back to browser
history. A failed update preserves that confirmed version and keeps the newer
exact copy in memory for the live tab. The client remembers that exact confirmed
baseline: deletion or replacement by another context freezes the ephemeral
branch instead of resurrecting it. If removal cannot be verified, the client
does not claim that explicit discard or post-create cleanup succeeded.

## Concurrency and stale-page rules

The `/start` → explicit `/login` or `/register` workflow holds one same-origin,
exclusive Web Lock before any shared-storage read or mutation. A contending tab
shows a value-free busy state and performs no storage operation; browsers
without Web Locks use only same-tab memory. `pagehide` releases the lock and
`pageshow` must reacquire and revalidate before controls are enabled.

Inside that critical section, each edit creates a new UUID write identity and
compares the exact canonical envelope, including creation key, monotonic
revision, write identity, timestamps, step, state and payload. Equal-revision
forks are conflicts rather than aliases. The expected write UUID and revision in
bounded auth navigation state prevent substitution during handoff. Storage,
focus, `pageshow`, and visible-page events recheck the active version. A missing,
expired, different, or newer record freezes the stale page and prevents any
subsequent autosave, discard, cleanup, or submit. If a new estimator handoff is
present while an older browser draft is offered, choosing Resume consumes and
scrubs the different handoff before restoring the saved key; its tuple/source
cannot be rebound to or attribute the older brief.

## Existing backend and migration boundary

No Worker endpoint, D1 table, KV namespace, cookie, cron, or forward migration
is added. Authenticated `POST /api/projects` remains the only server transition.
It already provides:

- session, trusted-origin, CSRF, KV admission, and per-account controls;
- strict request allowlists and Worker-owned normalization/calculation;
- a `user_id`-scoped digest of the project-creation key;
- a normalized request digest and unique partial index from migration `0014`;
- `201` on first insert, canonical `200` on an exact replay, and
  `409 idempotency_conflict` when the same key is reused for different input.

The frontend persists and reuses the original key; it does not weaken or
replace any backend authority. Existing migrations `0001`–`0017` remain
unchanged and no `0018` is warranted for a browser-only capability.

## Success measure and guardrails

The customer outcome is fewer abandoned four-step briefs caused by navigation
or tab closure. The launch measure remains the server-tied daily attributed
brief-start count after successful authenticated project creation; this release
does not add anonymous tracking or a stable browser identifier merely to build a
resume funnel. A future conversion metric requires a separate privacy review.

Release guardrails are:

- zero full-brief payloads in URLs, history/session storage, auth requests, logs,
  or analytics; the separate bounded estimator tuple is consumed from navigation
  and session storage as soon as the first anonymous envelope owns those values;
  the shared source-only sidecar is exact-key/expiry-bound and rollback-ignorable;
- zero duplicate projects in one account across exact retry and lost-response tests;
- zero stale-tab resurrection after discard, expiry, or successful consumption;
- no anonymous API or database write;
- no dedicated file or credential field persistence; user-entered project-name
  text remains explicitly disclosed;
- full planner usability when local storage is unavailable;
- keyboard, focus, 390 px, 200% zoom, reduced-motion, no-overflow, and clear
  loading/error/recovery states.

## Verification

Automated contract tests cover exact round trips, strict keys and values,
oversize/corrupt inputs, timestamp and expiry boundaries, passive non-extension,
blocked storage, exclusive-lock acquisition/contention/fallback, exact-baseline
fallback, compare-and-set conflicts, discard, conditional consumption,
auth/body separation, source/key/write-version continuity, stale-handoff
rejection, sidecar expiry/orphan/compare-delete behavior, rollback parsing, and
legacy removal.

Browser acceptance covers a partial edit, blocked invalid Save & exit,
save-and-exit, prompt-before-values, explicit Resume, exact restored step and
values, mobile reflow, 200% zoom, keyboard focus, console/network health, and
the value-free missing/expired copy. The real Worker/D1 project-creation fixture
proves exact `201`/`200` replay, concurrent reconciliation, changed-body
conflict, same-key cross-account isolation, the 49→50 race, one canonical row,
and at-most-once estimator attribution.
