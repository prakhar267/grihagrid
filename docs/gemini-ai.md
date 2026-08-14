# Gemini AI planning brief

## Purpose and boundary

GrihaGrid uses Google Gemini only for an optional, owner-triggered second reading
of an explicitly generated, current deterministic planning report (schema v2).
Gemini does not calculate the
server-side estimate, decide whether a plot is compliant, create a construction
drawing, authorize a payment, or replace a licensed professional.

The integration is deliberately fail-closed. The deterministic report remains
available when Gemini is missing, rate-limited, blocked, times out, or returns an
invalid response.

## Data flow

```text
Authenticated adult project owner
  -> POST /api/projects/:id/ai-brief (same origin + CSRF + acknowledgement)
  -> Worker requires the owner-scoped project's exact current v2 report in D1
  -> Worker builds an allowlisted, sanitized source record
  -> Google Gemini Interactions API (store: false, structured JSON)
  -> Worker validates syntax, shape, lengths, and advisory boundaries
  -> D1 stores the validated brief with model/prompt/source versions
  -> owner-scoped GET returns the cached brief
```

The provider request may include plot dimensions, broad city, facing, floors,
room programme, finish preference, derived area/cost ranges, deterministic risk
flags, and next actions. It excludes account name/email, project title, phone,
precise address, coordinates, authentication data, payment data, and uploaded
files. Gemini never receives the API key from the browser.

## Configuration

- `GEMINI_API_KEY`: encrypted Cloudflare Worker secret; never put it in source,
  Wrangler variables, client bundles, logs, URLs, or GitHub.
- `GEMINI_MODEL`: non-secret pinned model ID. Production currently uses
  `gemini-3.6-flash`, a stable generally available model rather than a moving
  `-latest` alias.
- D1 migrations `0005`, `0006`, and `0012`: required for the saved brief,
  atomic generation counters, expiring per-project lease, and immutable current
  report source. KV remains a
  best-effort authentication/checkout abuse brake, not the AI spend boundary.

Create or rotate the secret with `npx wrangler secret put GEMINI_API_KEY` and
verify it through a synthetic authenticated generation before retiring the old
credential. Prefer a current Google **Authorization key** restricted to the
Gemini API. Google states that Standard keys will stop working in September
2026, so legacy keys must be rotated before then.

The currently linked Google project is on the free tier and shares quota with an
older application. Before material customer volume, move GrihaGrid to a
dedicated Google project and configure usage monitoring or billing controls.

## Privacy and consent

Generation requires an explicit, unchecked acknowledgement that the user is 18
or older and consents to sanitized planning facts being processed by Google.
The Worker enforces the acknowledgement; the browser control is not the only
gate.

Every provider call sets `store: false`. On Google's unpaid service, submitted
content may still be reviewed and used to improve Google products under the
applicable Gemini API terms. Therefore GrihaGrid sends only the allowlisted,
sanitized planning record. Do not add names, addresses, uploads, free-form
personal notes, or confidential drawings without a new privacy review and an
appropriate paid/zero-data-retention arrangement.

## Provider controls

- Stable `POST https://generativelanguage.googleapis.com/v1/interactions`.
- Server-side `x-goog-api-key` authentication.
- `store: false`; no Search grounding or provider tools.
- Structured JSON schema plus independent application validation.
- Google's built-in core-harm protections plus a narrow, allowlisted planning
  prompt. The public Interactions API currently rejects custom
  `safety_settings`; those settings are limited to Google's Enterprise Agent
  Platform, so GrihaGrid does not send an unsupported field.
- Bounded output and overall deadline.
- Retry only transient network, `408`, `429`, and `5xx` failures with backoff;
  never retry invalid requests or credentials.
- Cache by deterministic report input hash and prompt/model version to avoid
  unnecessary provider requests.
- Admit generation with one transactional D1 batch: at most six generations
  per user per UTC hour, at most 200 reserved provider attempts platform-wide
  per UTC day, and one live lease per project. A request reserves up to two
  provider attempts before calling Google; the reservation is not refunded on
  provider failure. Cache hits are free, while explicit refreshes are admitted.
- Fence persistence with the live lease, immutable report bytes, and the
  owner project's still-active exact input revision/source bytes. An edit or
  archive completed during provider work returns `409 ai_generation_superseded`
  and stores no stale AI row. Reject
  generated claims of assured compliance/approval, structural certainty,
  professional bypass, or instructions to begin construction.
- Log route outcome, duration, model, and token counts only; never log prompts,
  provider bodies, project inputs, or the credential.

## API behavior

- `GET /api/projects/:id/ai-brief` returns the owner's saved brief or
  `404 ai_brief_not_found`.
- `POST /api/projects/:id/ai-brief` accepts
  `{ "acceptedAiTerms": true, "refresh": false }` and returns a cached or newly
  generated structured brief.
- AI routes never create, promote, or refresh a deterministic report. When the
  current project revision has no explicitly generated schema-v2 report, POST
  returns `409 report_required`; generate the report first through
  `POST /api/projects/:id/report`.
- Missing acknowledgement is `400 ai_terms_required`.
- Authentication, ownership, same-origin, CSRF, and rate-limit failures use the
  standard API error envelope.
- Missing configuration or a provider outage returns an honest temporary error;
  it never fabricates a brief or exposes provider details.
- Concurrent same-project work returns `409 ai_generation_in_progress`; an
  exhausted strict allowance returns `429 ai_rate_limited`.

## Operational checks

1. Confirm `/api/readiness` reports AI configured without revealing any secret.
2. Confirm AI POST returns `409 report_required` before report generation.
   Explicitly generate the synthetic project's current v2 planning report,
   then generate one AI brief and confirm a subsequent cached read.
3. Confirm a second account receives `404` for both GET and POST.
4. Confirm POST without CSRF and without `acceptedAiTerms` fails.
5. Race two refreshes and confirm only one provider call is admitted. Confirm
   the user-hour/platform-day counters and expired-lease cleanup.
6. Inspect logs for provider status/latency only and verify no prompt or project
   body is present.
7. Delete all synthetic project, session, and user rows.

## Official Google references

- [Gemini models](https://ai.google.dev/gemini-api/docs/models)
- [Interactions API v1](https://ai.google.dev/api/interactions-api-v1)
- [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [API-key security](https://ai.google.dev/gemini-api/docs/api-key)
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Retry guidance](https://ai.google.dev/gemini-api/docs/troubleshooting)
- [Safety settings](https://ai.google.dev/gemini-api/docs/safety-settings)
- [Gemini API terms](https://ai.google.dev/gemini-api/terms)
