# GrihaGrid documentation

Start with the **editable 2D/3D house studio**. The current product cleanup is
local and reviewable; deployment and paid infrastructure are outside this task.
Supporting planning, reporting, account and operations contracts remain in
place, together with their historical evidence.

## Current product and implementation

| Read this | For |
| --- | --- |
| [Repository README](../README.md) | Product entry points, local setup, current boundaries and verification commands |
| [Product blueprint](product-blueprint.md) | Studio journey, acceptance criteria and retained supporting use cases |
| [Technical architecture](architecture.md) | Shared geometry, browser/Worker/local-renderer responsibilities and security |
| [Studio entry cleanup](spatial-product-cleanup.md) | Current cleanup scope, acceptance criteria and reproduction |
| [House scenario coverage](house-scenario-coverage.md) | Site and room briefs, generated studies, scenario matrix, persistence and honest limits |
| [Spatial workspace](spatial-workspace.md) | Building schema, drawing import, editor, navigation, tours, saved cameras and private API |
| [Blender studio](spatial-blender.md) | Pairing, reusable Python pipeline, output formats, job limits and recovery |
| [Spatial performance](spatial-performance.md) | Render budgets, idle behavior, quality modes and actual device measurements |
| [Visual polish](spatial-visual-polish.md) | Drawing recognition and materials work with dated verification |

Read dated spatial documents as evidence for their recorded scope. Their older
phrases such as “local implementation” or “release preparation” describe that
checkpoint, not the deployment status of every later revision. Current-source
claims need matching code and verification.

## Retained supporting contracts

These features support owned houses and existing projects. They are not a
replacement primary funnel, and their presence does not activate gated services.

| Document | Retained behavior |
| --- | --- |
| [Backend API](backend-api.md) | Endpoint, ownership, request validation, idempotency and configuration contracts |
| [Account security](account-security.md) | Sessions, login fences, password rotation and bounded session review |
| [Account lifecycle](account-lifecycle.md) | Recovery availability, data export and guarded deletion |
| [Public estimator](public-estimator.md) | Deterministic indicative range and safe scenario sharing |
| [Anonymous brief resume](anonymous-brief-resume.md) | Explicit same-browser planning draft and authentication continuation |
| [Project Home](project-home.md) | Supporting planning workspace and immutable project history |
| [Brief Check](brief-check.md) | Completeness, tensions, Change Study and accepted input revisions |
| [Decision Compare](decision-compare.md) | Two-option comparison, owner choice and preserved source snapshots |
| [Family Alignment](family-alignment.md) | Bounded family feedback and capability-link privacy |
| [Architect review pack](architect-review-pack.md) | Deterministic report and professional verification registers |
| [Gemini planning brief](gemini-ai.md) | Allowlisted advisory planning API, separate from tour direction |
| [Report feedback](report-feedback.md) | Version-bound feedback without rewriting report bytes |
| [Professional Handoff](report-handoff.md) | Owner-selected, expiring and revocable report sharing |
| [Professional review](professional-review.md) | Controlled reviewer workflow; no implied practitioner endorsement |
| [Private uploads](private-uploads.md) | Closed server-storage implementation and activation requirements |
| [Payments](payments.md) | Preserved state machine and disabled activation controls |

## Verification, release and operations

| Document | How to interpret it |
| --- | --- |
| [Spatial verification](spatial-verification.md) | Dated browser, geometry, AI and native-render results; iPhone/VoiceOver deferrals remain explicit |
| [Test plan](test-plan.md) | Repository regression and behavioral verification requirements |
| [Quality evidence](quality-evidence.md) | Recorded checks and remaining human validation boundaries |
| [Launch readiness](launch-readiness.md) | Existing launch controls and exact release evidence |
| [Free-production readiness](free-production-readiness.md) | Prior reliability/security/recovery cut and its acceptance contract |
| [Readiness completion plan](readiness-completion-plan.md) | Historical completion plan; not authority to expand the current task |
| [Readiness performance](readiness-performance.md) | Version-bound readiness performance and validation contract |
| [Operations runbook](operations-runbook.md) | Deployment, monitoring, backups, incidents, recovery and rollback |
| [Production operations](production-operations.md) | Dated private-runner billing, monitor activation and D1-capacity blockers |
| [Private backup receiver](../ops/backup-vault/README.md) | Prepared manual template; blocked execution is not working private storage |

A checked-in workflow or a passing test is not proof of a deployed version,
activated monitor, private backup copy or completed remote restore. Historical
artifacts retain their source, time and limitations. Do not remove render
outputs, backups or release evidence as part of product-copy cleanup.

## Reference history

[Naming audit](naming-audit.md) and [reference audit](reference-audit.md) preserve
the original research context. They do not override the current studio-first
[blueprint](product-blueprint.md) or justify resurrecting old pricing claims.
