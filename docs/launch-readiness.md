# Launch readiness and runbook

## Current readiness

The marketing, calculator, onboarding, dashboard, report preview, Cloudflare Worker API, database schema and production build are implemented. A public deployment can safely demonstrate and collect free feasibility leads.

Paid selling remains gated on the following owner-supplied or third-party items:

- Trademark/domain clearance and final company identity.
- Legal review of privacy, terms, refund policy, disclaimers and architect contracting.
- Razorpay live key, webhook secret, GST/invoice configuration and a real end-to-end ₹1 test/refund.
- Transactional email domain, sender verification and delivery provider key.
- AI/report provider keys, documented prompts, evaluation set and human escalation policy.
- Verified architect supply, SLA, licensing checks and professional-indemnity decision.

## Pre-launch gates

### Product and QA

- [ ] Test every supported city/finish/floor combination against known fixtures.
- [ ] Test registration, session expiry, project ownership and account deletion.
- [ ] Exercise payment success, failure, retry, duplicate webhook, refund and partial outage.
- [ ] Validate at least 30 representative plots with licensed architects; publish accuracy bands.
- [ ] Run keyboard, screen-reader, 200% zoom, color contrast and mobile-device testing.
- [ ] Test slow network, offline navigation, upload cancellation and report retry.

### SRE

- [ ] Create external uptime check for `/api/health` and the homepage.
- [ ] Alert on 5xx rate >2% for 5 minutes, payment-webhook failure, queue age and D1 errors.
- [ ] Confirm structured logs contain request ID, route, latency and outcome but no personal data.
- [ ] Export D1 backup, restore it into staging and record restore time.
- [ ] Document provider outages: keep free calculator available; queue reports; never retry charges blindly.
- [ ] Add a kill switch for new checkout and a banner for report delays.

### DevOps

- [ ] Protect GitHub default branch; require build/test checks and review.
- [ ] Use short-lived Cloudflare deployment credentials in GitHub Actions.
- [ ] Separate preview/staging/production bindings and secrets.
- [ ] Apply migrations before deployment and use additive/expand-contract changes.
- [ ] Pin provider webhook IP/signature rules where supported.
- [ ] Verify DNS, TLS, HSTS, CSP and email SPF/DKIM/DMARC.

## Incident priorities

- **SEV-1:** duplicate/incorrect charges, cross-account data access, leaked private files, widespread outage. Disable affected capability, preserve evidence, notify owner immediately.
- **SEV-2:** report queue stalled, login unavailable, material estimate corruption. Stop fulfillment, display honest status, recover within four hours.
- **SEV-3:** isolated generation failure, cosmetic regression, delayed email. Queue/retry safely and resolve in normal support flow.

## Rollback

Redeploy the last known-good Git SHA. Do not roll back an irreversible D1 migration; use additive corrective migrations. Pause checkout before rolling back code that changes order semantics. Confirm `/api/health`, a free estimate and one synthetic project after recovery.
