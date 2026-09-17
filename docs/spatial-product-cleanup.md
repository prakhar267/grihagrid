# Studio entry and repository cleanup — 17 September 2026

## Customer outcome

Opening GrihaGrid should immediately show the editable house studio. A person
can explore the example, create a private house, review and save its first
model, and reopen it from the house library. The former pricing and
cost-estimator marketing homepage no longer interrupts that journey.

This change is local implementation and review only. It does not deploy,
change customer records, enable payments/private uploads, or activate services.

## Acceptance and guardrails

- `/` and the retained `/explore` address open the same public house studio
  without account checks, price promotion or background estimate requests.
- Primary navigation connects the studio, My houses, New house and the guide.
  Library cards open `/projects/:id/spatial`; Project details retains planning
  history, reports, comparison, ownership and sharing behavior.
- New house creation uses the existing authenticated, CSRF-protected project
  contract. An uncertain response locks the submitted fields; an explicit
  retry uses the same idempotency key and payload. A changed account clears
  the former account's form, library and private studio component state.
- Plot details are explicitly a separate planning reference. They do not
  pretend to generate or resize the starter geometry. A house with no accepted
  model opens the 2D editor, visibly identifies the starter, and requires
  Change Study before the first saved model revision.
- Unsaved navigation protection, forced logout, expired-session fencing,
  conflict handling and archived read-only behavior remain intact.
- The estimator is available at `/estimate`. Shared scenarios retain their
  strict parsing, live recalculation and privacy contract; malformed links
  show an error instead of hydrating partial values.
- Remove retired homepage/pricing/FAQ components, their unused catalog hook,
  unreachable checkout branches, exclusive marketing CSS, and the obsolete
  social-preview image. Preserve shared assets, server contracts, activation
  controls, model fixtures, renders, backups and dated evidence.
- README, architecture, product blueprint, documentation index, metadata and
  manifest describe the spatial product and the actual local Blender pipeline.
  `/pricing` remains a compatibility address for the studio guide.

The acceptance KPI is zero unexpected writes on public entry, exactly one
logical house creation across an uncertain-response retry, exactly one
explicitly accepted first model, and zero horizontal overflow in the tested
studio/library/form viewports. These are local correctness checks, not measured
production conversion or performance claims. No new analytics were introduced.

## Reproducible verification

Run the repository's locked install, full check, fresh-D1 migrations, both
Worker dry runs, dependency audit and whitespace check. Then use:

```sh
APP_RECOVERY_BUILT=1 node scripts/check-app-recovery.mjs
node scripts/check-spatial-ui.mjs
node scripts/check-spatial-cross-browser.mjs
```

The recovery harness uses isolated mocked accounts and exact allowlisted
project/model writes; it never contacts the user's account or Gemini. It
exercises a missing first model, preview/accept/reload, uncertain creation
retry, loading/error/empty states, route focus, lazy-load recovery, and private
navigation/logout races. Backend ownership and first-save contracts also run
against local D1 in the full repository suite.

The spatial UI harness covers root/alias entry, keyboard selection, editing,
stale-tour fencing, playback, export, 390px layout, reduced motion, 720px CSS
reflow, print, and WebGL fallback. Only the optional renderer health probe is
mocked; this check does not pair a service, create a render job or verify a
new film. Firefox/WebKit runs exercise real local browser engines. CSS reflow
is not physical-phone or native browser-zoom certification. Previously deferred
iPhone and spoken VoiceOver checks remain deferred.

Local logs and screenshots are under `qa-artifacts/`; generated house scenes
and films remain in `output/`, now excluded from commits. The exact draft PR
head and its hosted checks determine review status; this document does not
claim a deployment or turn historical evidence into a new live verification.
