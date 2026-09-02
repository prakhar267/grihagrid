# Professional review workflow

Migration `0020_professional_review_workflow.sql` adds controlled reviewer
profiles, exact-report review requests, immutable messages, and immutable event
history. It is an advisory workflow and never changes the report or represents
permit, structural, architectural, legal, or construction approval.

## Flow and authority

1. A project owner requests review of the current immutable report revision.
   The request stores revision, schema version, and content hash plus a bounded
   optional note; idempotent retry returns the same request.
2. Only an account with reviewer/admin role and a verified professional profile
   can see the de-identified queue and exclusively claim a request.
3. Before displaying detail, the Worker recalculates the source report hash.
   Queue and review payloads withhold the owner's email and workspace.
4. The reviewer may ask clarifying questions. Owner responses return the request
   to the reviewer. Completion is blocked while a question is open.
5. Completion records a bounded summary and immutable event. An owner may cancel
   only an unassigned request.

There is no public route for granting reviewer role or marking a profile
verified. A human operator must validate identity, discipline, jurisdiction, and
license/reference with an authoritative source and record evidence outside
customer-visible fields before provisioning. Reviewer account deletion is
blocked until governed offboarding is complete.

The workflow test proves owner isolation, unverified denial, exclusive claim,
clarification, completion gating, immutable history, replay, and cancellation.
It does not prove that a real practitioner was verified or that a report is
professionally correct.
