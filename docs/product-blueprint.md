# GrihaGrid product blueprint

**Current direction:** an editable house environment, room exploration and
directed camera tours, connected to existing private project history.
This document defines the product and acceptance contract; dated verification
belongs in [spatial verification](spatial-verification.md) and exact release
records. A requirement is not proof that a device, provider or deployment passed.

## 1. Executive decision

The primary product is the **2D/3D house studio**. A household can review a
floor plan, change the space, enter the corresponding furnished house, direct a
camera tour and export through local Blender. The environment preserves actual
geometry, materials, objects and spatial relationships as the camera moves.

The primary promise is:

> **Edit your house. Explore every room. Direct the tour.**

“Know what fits. Know what it costs.” remains the supporting planning promise.
Estimation, reports, project ownership, Change Study, revision history,
comparison and sharing are preserved. They support the house rather than force
a report/pricing funnel before the user can explore it.

This change is **local implementation and review only**. Deployment, remote
migrations, paid infrastructure and service activation are excluded. Existing
releases, controls and evidence remain intact; earlier authorization to deploy
another cut is not a deployment claim for this one.

### Product principles

1. **One house, consistent views.** A 2D edit changes the same model used in 3D
   and native export. Geometry, dimensions and stable IDs must agree.
2. **A complete experience first.** A furnished connected house with useful
   camera control matters more than numerous unfinished controls.
3. **Human review of inferred input.** Drawing recognition proposes walls and
   dimensions; calibration and correction precede an accepted concept.
4. **Deterministic geometry, optional AI direction.** AI suggests valid subjects
   and shot intent. Geometry code resolves and checks the camera route.
5. **Private accepted history.** Dirty drafts, accepted revisions, stale tours,
   conflicts and archived records have explicit states.
6. **Honest capability boundaries.** A tab-local sample is not a saved house;
   manual output is not AI; local Blender is not hosted rendering.
7. **Concepts need professional validation.** The studio never certifies safety,
   approval, construction readiness or exact cost.

## 2. Users, jobs and product language

The primary user is an Indian or NRI household exploring a proposed home with
family members. They need to understand room relationships, edit a concept,
see what changed, walk through it and communicate a clear direction. A licensed
professional can use the retained handoff evidence without being represented
as endorsing an automatically generated model.

| User job | Useful outcome |
| --- | --- |
| Understand a house quickly | A furnished model opens; room hover and selection match the floor plan |
| Correct a drawing interpretation | Source review, scale calibration and editable room/wall geometry |
| Try a layout change | Valid 2D edits update the 3D scene and expose affected tour assumptions |
| Experience circulation | Walking follows supported floors, stairs and usable openings |
| Explain a preferred view | Named viewpoints and a controllable, subject-directed tour |
| Keep personal work | A private house opens later with accepted model/tour/camera history |
| Produce a film | An inspected local Blender output with visible progress and recovery |
| Discuss cost or professional next steps | Existing indicative estimate, reports, comparison and handoff |

Use plain labels: **New house**, **My houses**, **2D Plan**, **3D Explore**,
**Camera Tour**, and **Render/Export**. Keep the Architectural Monograph design:
ivory `#f3efe6`, ink `#181511`, copper `#a7532f`, Cormorant Garamond, DM Sans,
thin rules, restrained controls and readable spacing. The viewport should
lead the exploration screen; the room navigator and inspector stay compact.

Do not market inactive prices, expert services or server uploads as the primary
product. Names and visuals must not imply construction, structural or municipal
approval. Blender materials are illustrative rather than measured specifications.

## 3. Primary journey and information architecture

```text
Open the demonstration or a saved house
  → inspect the 2D plan / review a drawing
  → edit and review a spatial Change Study
  → accept the concept revision
  → orbit, choose a room and walk through the furnished 3D environment
  → build / direct / play / pause / resume a camera tour
  → save viewpoints and tour revisions
  → pair local Blender, inspect previews and export a film
```

| Surface | Role |
| --- | --- |
| `/` and `/explore` | Public studio entry with a clearly labelled sample |
| `/houses/new` | Private New house flow establishing owner-scoped project data and a labelled starting concept |
| `/dashboard` | Your houses list; primary Open studio action, secondary Project details, clear loading/error/empty states |
| `/projects/:id/spatial` | Private model editing, exploration, tours, viewpoints and export |
| `/start`, `/estimate` | Secondary planning brief and editable calculator; valid shared scenarios keep their safe contract and malformed queries stay invalid |
| `/projects/:id`, `/report/:id` | Retained project planning/history and reports |
| Existing comparison, family and report-sharing routes | Preserve version, ownership and capability-link behavior |
| Account security/lifecycle | Preserve sign-in, export, password/session control and guarded deletion |

The public demonstration does not silently persist an account or house. An
empty owned studio starts from an explicitly labelled sample; dimensions and
cost inputs are not silently converted into invented architectural decisions.
A new-house action must lead to a usable owned studio without removing the
full planning-brief workflow.

Unknown or failed session validation must offer recovery without exposing
private content. Unsaved layout, tour and camera changes require navigation
protection. Confirmed logout or invalid session still fences private screens.

## 4. Spatial acceptance contract

| Area | Required behavior |
| --- | --- |
| Shared model | Versioned canonical millimetres; stable building/floor/room/wall/opening/object IDs; explicit browser/Blender axes |
| Drawing review | Browser-local import and OCR; visible source and proposed geometry; user scale calibration and correction; no fabricated room on blank input |
| Layout editing | Independent rooms, walls, doors, windows and furniture; validated boundaries, sizes, opening attachment, rotation and floor placement |
| Multi-floor geometry | Floor elevations, supported stairs and actual apertures; an unavailable path is reported rather than traversed through empty space |
| Furnished house | Coherent interiors, usable openings, courtyard/garden and deterministic surroundings; no floating or intersecting objects accepted silently |
| Overview and rooms | Orbit/pan/zoom/reset, presentation cutaways, hover without camera movement, keyboard-accessible room focus |
| Walking | Eye-height controls, floor support and clearance against walls, furniture, glass and door leaves; touch and keyboard controls |
| Guided tour | Play/pause/resume/restart, skip, speed, progress and manual takeover without competing camera controllers |
| Directed shots | Establishing/approach/interior/reveal/look-around/final views; explicit cuts/fades; full smoothed path checked for clearance |
| Tour editor | Stop order, duration, subjects, shot preview, saved camera viewpoints and regeneration after layout change |
| Optional AI | Bounded structured references and intent; server-side credentials; unsupported or stale result rejected; deterministic fallback labelled honestly |
| Private persistence | Read-only preview, accepted immutable model revisions, separately versioned tours/cameras, source fences, ownership and conflict recovery |
| Local rendering | Fixed reusable Python modules; scene/GLB/manifest/previews/MP4; bounded jobs, progress, cancellation and verified resume |
| Export verification | Scale, room/object IDs, camera direction/FOV and placement checked through GLB round trip and reopened Blender scene |
| Accessible fallback | Useful 2D view without WebGL, keyboard room list, reduced motion, small-screen layout and clear errors |

Detailed current bounds and formats live in [spatial-workspace.md](spatial-workspace.md).
[spatial-blender.md](spatial-blender.md) defines the local pairing and rendering
contract. The 20–30-second 1080p/30fps demo-film target is a verification task,
not a promise of instant rendering on every computer.

## 5. Implementation, validation and measurement

React/SVG handles 2D editing; Three.js/React Three Fiber handles browser 3D.
Shared geometry validates the model and camera path. The Cloudflare Worker
handles authentication, validation, metadata, accepted revisions and bounded AI
intent. D1 owns persistent history and KV supports admission controls. A
separate paired local Node service runs Blender and FFmpeg. The Worker cannot
execute Blender. No Cloudflare Queue or cloud PDF/render pipeline is implemented.

The shared scene bundle is `{model, tour, viewpoints}`. Browser/glTF uses
`[x,z,-y]/1000`; Blender uses `[x,y,z]/1000`. Geometry and camera motion agree,
while browser and Blender lighting/shaders can differ. See
[architecture](architecture.md) for module boundaries and security details.

The release-independent local acceptance journey is: open a furnished house,
match 2D and 3D room selection, enter and walk through three connected spaces,
control a tour, edit the plan and observe the matching geometry/stale-tour
state, save/reload an owned revision, and inspect a real native export when
local dependencies permit. Also check failure, retry, conflicts, archive,
unknown session, keyboard, touch emulation, reduced motion and WebGL fallback.
Run repository-required checks and inspect the preview; do not stop at a plan.

| Metric | Meaning and limit |
| --- | --- |
| Completed house journey | Edit → review/accept → explore → tour → save/reopen, without mismatch or lost work |
| Geometry/camera correctness | Zero accepted inconsistent views, obstacle-crossing routes or stale tours presented as current |
| Exploration responsiveness | Measured load/edit latency and active FPS on named hardware; about 30 fps is the representative-mobile target |
| Render reliability | Real job completion, usable artifacts, cancellation and recovery without changed source or reused corrupt frames |
| Recovery clarity | Explicit provider, session, save-conflict and renderer errors with useful retry or fallback |
| Privacy and history | Zero ownership bypass, credential disclosure, source-fence bypass or mutation of accepted historical artifacts |

These metrics are acceptance criteria, not a claim that a new analytics system
is installed. Do not send drawing content, camera libraries, project text or
provider secrets to product telemetry.

Physical iPhone and spoken VoiceOver checks remain user-deferred, not passed.
Historical Gemini, film and browser evidence retains its original hardware,
source revision and date. Current navigation changes require fresh local QA;
they do not revalidate providers or deploy an updated site.

## 6. Prioritized functional use cases

This retained contract catalogue preserves existing use-case IDs for account,
planning, report and operational work. It is **not the primary studio roadmap or
an inventory of live features**. The original P0/P1/P2 labels express priority
within each supporting or gated capability; they do not authorize selling,
uploads, provider setup or deployment. Current implementation and availability
come from the linked feature/API documentation and readiness contract. In
particular, FILE, PAY and premium REV requirements remain gated.

### A. Discovery and evaluation

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| DISC-01 | P0 | Visitor understands the offer | The studio opens a labelled house; the next action edits, explores or creates a private house; the concept boundary is visible. |
| DISC-02 | P0 | Visitor adjusts an instant estimate | Width, length, floors, city, and finish update a range without reload; invalid values are bounded and explained; basis is linked. |
| DISC-03 | P0 | Visitor inspects a representative sample | The furnished demonstration has usable room geometry and a controllable tour; supporting report samples retain assumptions, exclusions and their concept boundary. |
| DISC-04 | P0 | Visitor understands capability availability | Local, saved, AI-assisted, renderer-dependent and unavailable states are distinguishable; no inactive tier is advertised as purchasable. |
| DISC-05 | P0 | Visitor verifies trust and contact details | Methodology summary, privacy/terms/refund pages, support contact, and professional boundary are reachable before account creation. |
| DISC-06 | P1 | Returning visitor resumes an unfinished anonymous brief | Draft is restored locally with explicit expiry/clear control; sensitive uploads are never stored anonymously. |
| DISC-07 | P1 | Visitor shares a non-personal estimate scenario | Versioned link encodes only the five safe inputs, recalculates live without auth or anonymous storage, and can continue with aggregate-only first-create attribution; no price, address, account, token, or private project identifier enters the URL. |
| DISC-08 | P2 | Visitor switches language/units | Core flows support selected Indian languages and ft/m without changing canonical stored units. |

### B. Identity, session, and consent

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| ID-01 | P0 | Customer registers | Unique normalized email, strong password handling, generic error messages, rate limiting, and a secure session are created. |
| ID-02 | P0 | Customer signs in/out | Session rotates on authentication; logout revokes or proves absent the current server session before the private UI is cleared; ambiguous failures remain visibly signed in with an accessible retry; the control remains available on mobile; cookies are HttpOnly, Secure, and appropriately SameSite. |
| ID-03 | P0 | Customer recovers account access | One-time, expiring reset flow avoids account enumeration and revokes old sessions after password reset. |
| ID-04 | P0 | System protects mutating requests | CSRF defence, origin validation, request-size limits, and per-account/IP abuse controls are enforced. |
| ID-05 | P1 | Customer verifies email | Verification status is visible and required before paid fulfillment or external sharing. |
| ID-06 | P1 | Customer reviews active session boundaries | The current cut shows the current session plus at most 20 other current-authentication, unexpired start/expiry records with an honest truncation signal and lets a current-password-confirmed customer replace the boundary atomically. It exposes no session ID, UA/browser/device, IP, location or last-active data. Important-security-event notifications remain future work, so ID-06 is partial. |
| ID-07 | P1 | Customer records communication consent | Transactional and marketing purposes are separate, timestamped, revocable, and not preselected. |
| ID-08 | P2 | Customer adds another family collaborator | Invite is scoped to one project, role-limited, expiring, revocable, and fully audited. |

#### ID-04 bounded request-admission cut

The bounded platform problem is a malformed, understated, or chunked request
that can otherwise make the Worker retain more bytes than the API contract
allows before rejection. Every ordinary JSON body is counted as received while
streaming and accumulates at most 65,536 accepted body bytes before UTF-8
decoding and object parsing. A present `Content-Length` is accepted only as
decimal digits and is used solely for early upper-bound rejection; a missing,
zero, or understated value never bypasses streamed byte counting. The exact
limit is accepted; a delivered chunk that would cross it is rejected and the
unread remainder is cancelled best-effort.

Professional Handoff and Family Alignment preserve their smaller anonymous
envelopes and generic capability-miss responses. Razorpay webhook admission
uses the same primitive at 262,144 raw bytes so its signature still covers the
exact received bytes before strict UTF-8 JSON decoding. Rejected requests do
not start post-admission PBKDF2, domain D1 writes, payment verification, or AI
provider work; origin, session, CSRF, and deliberate perimeter admission may
still precede body parsing where their existing security order requires it.
This cut adds no UI, analytics, or migration and does not make closed uploads
available.

#### ID-06 implemented cut

The bounded customer problem is a signed-in owner who wants to inspect and
close possible copied or forgotten sessions without first changing a password
they still trust. Account security shows one current row and up to 20 newest
other valid rows using only start and expiry time. `hasMore` communicates a
truncated list without creating a device-fingerprinting or location-history
product.

The primary action remains available in the current-only state because a copy
of the current bearer cannot truthfully appear as another device. The owner
confirms the exact current password; success atomically advances the account
authentication generation/revision, deletes every session and creates one
replacement while preserving all password fields, `password_changed_at` and
the login-attempt fence. Every old bearer fails, but anyone who knows the
unchanged password can sign in again. The product therefore directs suspected
credential compromise to the adjacent password-rotation flow.

Acceptance requires current-plus-20/`hasMore` accuracy, read-only behavior,
zero identifier/fingerprint leakage, same-origin/CSRF and shared five-per-
account/15-minute current-password admission, one-winner atomic concurrency,
complete failure rollback, copied-bearer invalidation, unchanged-credential and
login-fence proof, and accessible current-only/truncated/error/success states.
No migration is added: migration 0015 explicitly supports the generation-only
transition. Release and rollback must preserve completed boundaries and never
recreate deleted sessions. Email/push/in-product security notifications remain
a separately designed Phase 1 outcome.

### C. Project and brief management

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| PROJ-01 | P0 | Customer creates a project | Project receives an opaque ID, owner, draft state, created/updated timestamps, and private-by-default access. |
| PROJ-02 | P0 | Customer records plot facts | Width, depth, road edge, facing, city/state, unit, and known irregularity are validated; unknown is a valid explicit answer. |
| PROJ-03 | P0 | Customer defines building programme | Floors, rooms, parking, household needs, accessibility, rental/dual-use needs, and future expansion are captured as structured fields. |
| PROJ-04 | P0 | Customer records preferences and constraints | Finish, style direction, budget, timeline, and optional Vastu preferences remain distinguishable from factual constraints. |
| PROJ-05 | P0 | Customer reviews before generation | A human-readable assumption summary shows missing/contradictory fields and requires confirmation. |
| PROJ-06 | P0 | Customer edits, archives, or deletes own project | Authorization is ownership-based; deletion explains effects on files, reports, and legally retained order records. |
| PROJ-07 | P0 | Customer sees project state | Unsaved sample, owned project, accepted concept, stale tour, save conflict and archived/read-only states have meaningful next actions. Supporting report/review state retains its existing contract. |
| PROJ-08 | P1 | Customer creates a revision | Existing project remains immutable as a prior version; changed inputs and resulting estimate deltas are visible. |
| PROJ-09 | P1 | System checks input quality | Implausible dimension/unit combinations, extreme ratios, missing access, and budget/programme conflict generate non-blocking or blocking guidance. |
| PROJ-10 | P1 | Customer adds site address | Address is optional until operationally required, encrypted or minimized where practical, and never shown in public links. |
| PROJ-11 | P2 | Customer imports a survey/document | Extracted facts require explicit human confirmation and retain provenance to page/source. |

### D. Feasibility, estimate, and report generation

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| CALC-01 | P0 | System computes indicative built-up area and cost | Server uses versioned rules/factors, canonical units, bounded inputs, deterministic rounding, and records model/basis version. |
| CALC-02 | P0 | Customer understands the estimate | Low/high band, major inclusions/exclusions, city/finish factor, area basis, taxes/fees treatment, and basis date are visible. |
| CALC-03 | P0 | Customer changes a driver | Cost and fit response identify what changed; a paid/reportable estimate is recomputed server-side rather than trusted from the browser. |
| CALC-04 | P0 | Customer generates free feasibility | One idempotent request yields a stable input snapshot, estimate, fit result, constraints, and next steps or an actionable failure. |
| RPT-01 | P0 | Entitled customer requests paid report | Entitlement, current input hash, generation state, and idempotency key are verified before work starts. |
| RPT-02 | P0 | System generates a report | Every factual/quantitative output has a traceable input, rule, or evidence source; unsafe unsupported claims are rejected. |
| RPT-03 | P0 | Customer sees progress and failure | Status survives refresh; time expectations are honest; retries do not duplicate charges or concurrent versions. |
| RPT-04 | P0 | Customer views/downloads a versioned artifact | HTML and PDF identify project/version/date and carry disclaimers; download is authorized and expires when link-based. |
| RPT-05 | P0 | System quality-gates report output | Schema validation, missing-section check, numeric reconciliation, prohibited-claim check, and render verification pass before “ready.” |
| RPT-06 | P1 | Customer compares scenarios | Two project revisions show programme, area, estimate, and risk differences using the same basis version or clearly note version change. |
| RPT-07 | P1 | Customer provides report feedback | Accuracy/usefulness feedback is linked to version and section without silently changing the artifact. |
| RPT-08 | P2 | Operations reprocesses a failed job | Privileged retry is idempotent, reason-coded, audited, and does not bypass quality gates. |

### E. Files and evidence

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| FILE-01 | P0 | Entitled customer uploads a site photograph | Type is verified by content signature, size/count limited, malware policy enforced, object stored privately, and metadata linked to owner/project. |
| FILE-02 | P0 | Customer views/downloads/deletes own file | Every request rechecks project access; short-lived access does not reveal permanent bucket URLs. |
| FILE-03 | P0 | System handles abandoned/partial uploads | Uncommitted objects expire automatically; retries cannot orphan untracked objects. |
| FILE-04 | P1 | Customer labels evidence | Direction, location, capture date, and note can be added; inference is not presented as user-provided fact. |
| FILE-05 | P1 | System removes unnecessary image metadata | EXIF/GPS is stripped unless explicitly required and consented to for the service. |
| FILE-06 | P2 | Customer uploads drawing/survey files | File preview is sandboxed; extracted dimensions require confirmation; original remains immutable. |

### F. Purchase, payment, and entitlement

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| PAY-01 | P0 | Customer selects a paid tier for a project | Server determines SKU, price, tax treatment, currency, entitlement, and refund rule; browser-supplied price is ignored. |
| PAY-02 | P0 | Customer creates checkout | Order creation is idempotent; abandoned, failed, and expired orders are distinguishable; no entitlement is granted from redirect alone. |
| PAY-03 | P0 | Payment provider reports outcome | Signature and replay window are verified; raw event ID is unique; state transition is atomic and replay-safe. |
| PAY-04 | P0 | Customer receives entitlement | Only verified paid state grants generation/review; duplicate webhooks cannot duplicate work. |
| PAY-05 | P0 | Customer sees receipt/order history | Amount, tax/invoice status, provider reference, purchased scope, and support path are visible without exposing provider secrets. |
| PAY-06 | P0 | Support issues permitted refund | Policy eligibility, approver, reason, provider result, entitlement effect, and customer notification are audited. |
| PAY-07 | P0 | Finance reconciles provider and ledger | Daily process flags missing/duplicate/mismatched orders; exceptions have owner and resolution state. |
| PAY-08 | P1 | Checkout is temporarily unsafe | Kill switch blocks new checkout while preserving existing project/report access and displays honest service status. |
| PAY-09 | P2 | Customer buys a revision/add-on | Prior entitlement remains intact; add-on scope and expiry are explicit; price is server-owned. |

### G. Architect review

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| REV-01 | P0 for premium | Operations assigns a qualified reviewer | Identity, jurisdiction/relevance, declared conflicts, SLA, and accepted scope are recorded. |
| REV-02 | P0 for premium | Reviewer opens a sanitized project pack | Least-privilege access expires after assignment; customer contact and unrelated projects remain hidden. |
| REV-03 | P0 for premium | Reviewer requests clarification | Customer receives specific questions; SLA pauses/resumes by policy; all messages are retained against the version. |
| REV-04 | P0 for premium | Reviewer submits notes | Notes distinguish observed issue, recommendation, required local validation, and limits; reviewer identity/date/version are fixed. |
| REV-05 | P0 for premium | Customer uses included revision | Revision scope and deadline are enforced; old and new outputs remain accessible and attributable. |
| REV-06 | P1 | Customer rates the review | Rating and issue categories feed reviewer QA; complaints trigger an independent escalation path. |
| REV-07 | P1 | Operations audits review quality | Sampled reviews use a rubric; unsafe or templated output can suspend assignment eligibility. |
| REV-08 | P2 | Reviewer collaborates in structured annotations | Section-level comments and disposition states replace free-form document exchange. |

### H. Sharing, support, privacy, and administration

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| OPS-01 | P0 | Customer downloads their data | Export covers profile, project inputs, versions, report metadata, orders, and user-authored communications in a readable format. |
| OPS-02 | P0 | Customer requests account deletion | Current-password and authentication fences protect the atomic ordinary-account deletion. Financial, professional or private-file blockers fail closed; a rejected request must not partially delete data or revoke the valid session. |
| OPS-03 | P0 | Support finds a case safely | Search uses opaque IDs or exact verified identifiers; role permissions and access are audited; no sensitive request bodies enter logs. |
| OPS-04 | P0 | Support resolves generation/payment issue | Timeline shows state changes, provider references, safe error code, retry/refund eligibility, and customer communication. |
| OPS-05 | P0 | Admin changes cost rules/content | Versioned change requires preview, approver, effective date, rollback path, and audit entry; prior reports do not mutate. |
| OPS-06 | P0 | Operator sees service health | Readiness, bounded smoke/monitor evidence and local render-job progress identify actual failures. An independent external monitor must be activated and exercised before it is claimed active. |
| OPS-07 | P0 | System performs scheduled hygiene | Expired sessions, abandoned uploads, stale orders, and deletion jobs are processed idempotently with outcome metrics. |
| OPS-08 | P1 | Customer shares a report | Recipient gets a revocable, expiring, version-specific link; sensitive sections default off; access is logged. |
| OPS-09 | P1 | Operations manages feature/kill switches | Checkout, new generation, uploads, and external sharing can be independently disabled without redeploy. |
| OPS-10 | P1 | Analyst measures funnel safely | Events use pseudonymous IDs, documented schemas, consent boundaries, and no raw address/photo/report text. |
| OPS-11 | P2 | Business manages organizations/professional teams | Tenant isolation, role-based access, seat lifecycle, and audit export are explicit. |

## 7. Preserved data and feature boundaries

The primary spatial records are `spatial_revisions`,
`spatial_tour_revisions` and `spatial_camera_revisions`, linked to owned projects
and exact input/model revisions. Accepted records are immutable; a newer save
cannot be overwritten by an older preview, provider reply or retry. Archive
makes the project read-only. Account export includes the owner's spatial history;
ordinary deletion follows the existing atomic account/retention contract.

Planning estimates remain deterministic. Report versions and purchased
snapshots retain their own immutable inputs and history. Comparison, Family
Alignment and Professional Handoff preserve their scoped, revocable links.
Changing which screen opens first does not modify those data contracts.

Private uploads/R2, paid checkout and paid fulfillment remain closed. Optional
camera AI does not broaden the planning-brief provider payload. Account recovery
and email verification stay visibly unavailable without sender configuration.
No broad deletion or migration of supporting APIs, records, documents, generated
outputs or backups belongs to this cleanup.

## 8. Documentation and operations contract

[The documentation index](README.md) distinguishes the current studio product,
retained supporting contracts and dated implementation/release evidence. Keep
security, API, operations and historical verification links valid. Remove
obsolete primary pricing/report-funnel claims rather than advertising a new
commercial offer.

The current task does not deploy, provision or purchase infrastructure. Existing
protected-release procedures remain documented for a separately authorized
release. [Production operations](production-operations.md) retains the known
private Actions billing, external-monitor activation and isolated-D1 capacity
blockers. A local build does not close them.

Future hosted rendering, additional private storage, paid plans, professional
services or new provider integrations require their own scoped design,
verification and authorization. The present goal is a coherent, reviewable
house studio using the infrastructure and local renderer already available.
