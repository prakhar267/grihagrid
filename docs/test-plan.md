# QA test plan

## Critical paths

1. Home → adjust estimate → start project → complete four steps → dashboard → report.
2. Home → pricing → select plan → account route.
3. Login/register validation and demo dashboard handoff.
4. Dashboard → report → pricing upgrade.
5. Dark/light theme, mobile navigation, responsive cards and legal routes.

## API cases

- `GET /api/health`: dependency-independent liveness returns 200.
- `GET /api/readiness`: 200 only with current D1 schema and KV; otherwise 503,
  while separately reporting AI schema/admission/config validity and optional
  upload and checkout capability.
- `POST /api/estimate`: valid result; defaults; malformed JSON; wrong content type; dimensions below/above bounds.
- `POST /api/leads`: valid email; invalid email; duplicate email; unavailable database.
- `POST /api/projects`: valid project, normalized estimate, length-limited name and invalid dimensions.
- Unknown `/api/*`: JSON 404. Unknown browser route: SPA fallback.
- Gemini brief: owner isolation; explicit 18+ consent; CSRF/origin enforcement;
  sanitized allowlisted prompt; structured validation; advisory-policy
  rejection; cached replay; refresh; atomic user/platform limits; one-project
  single flight; expired-lease recovery; unchanged-report persistence fence;
  provider timeout/retry mapping; missing/revoked configuration; no secret in
  readiness, responses, bundles, or logs.

## Non-functional checks

- No horizontal overflow at 390, 768, 1024 and 1440 px.
- Visible focus and semantic labels for sliders, selects, form fields, nav and disclosure widgets.
- No console errors on core routes.
- Reduced-motion preference disables transition/scroll animation.
- Generated hero remains sharp and cropped intentionally at desktop/mobile.
- API responses never echo raw secrets or entire personal-data payloads.
