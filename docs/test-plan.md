# QA test plan

## Critical paths

1. Home → adjust estimate → start project → complete four steps → dashboard → report.
2. Home → pricing → select plan → account route.
3. Login/register validation and demo dashboard handoff.
4. Dashboard → report → pricing upgrade.
5. Dark/light theme, mobile navigation, responsive cards and legal routes.

## API cases

- `GET /api/health`: 200 with no DB; 200 with D1 healthy; 503 with D1 failure.
- `POST /api/estimate`: valid result; defaults; malformed JSON; wrong content type; dimensions below/above bounds.
- `POST /api/leads`: valid email; invalid email; duplicate email; unavailable database.
- `POST /api/projects`: valid project, normalized estimate, length-limited name and invalid dimensions.
- Unknown `/api/*`: JSON 404. Unknown browser route: SPA fallback.

## Non-functional checks

- No horizontal overflow at 390, 768, 1024 and 1440 px.
- Visible focus and semantic labels for sliders, selects, form fields, nav and disclosure widgets.
- No console errors on core routes.
- Reduced-motion preference disables transition/scroll animation.
- Generated hero remains sharp and cropped intentionally at desktop/mobile.
- API responses never echo raw secrets or entire personal-data payloads.
