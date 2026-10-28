# Company foundation — October 24, 2026

Implemented locally: shared people/organization directory with multiple affiliations; service/class/community/college/investor cases and restricted program/sales applications; explicit HR access; source-qualified CSV review and atomic decisions; versioned template/training resources and learning assignments. Existing UUIDs, S1–S9 gates, commercial authority, audit/revision rules and permanent suppression are preserved. See [foundation-build.md](foundation-build.md) and the current verification entry.

Release pending: platform-built isolated preview, verified database separation, real owner/non-HR/HR/viewer checks and final production rollout. The current site still serves the previously released baseline. Local Netlify CLI configuration access returned `EPERM`; no new deployment was started. The read-only offline synthetic review has not been visually inspected because browser policy blocked the file URL.

Next deliveries, after source/permission decisions: canonical active Forms/destinations and current catalog approval; bounded reviewed real-data intake; class occurrences/enrollment/payment evidence; sales onboarding depth and approved curriculum; Gmail/Calendar OAuth with read/draft/reply logging first; pagination and monitored source ingestion; approved sending later; paid discovery last. Do not treat account access by assistant connectors as an application-side connection. D3 and compensation/class authority conflicts remain unresolved.

Historical October 19 activation gates below are retained as evidence and superseded by the later released owner/two-user verification, not reopened by this build.

---

# Current invitation fix gate — October 19, 2026

The premature `invitedAt` validation hook was removed in favor of native Invite only enforcement. Live settings confirmed Invite only and required confirmation; public signup returned 403, unauthenticated invitation returned 401, and signed-out CRM read/write/export returned 401. Typecheck and all 55 tests in nine suites passed. See [verification.md](verification.md) for lifecycle evidence and its limits.

Platform review deployment URL/ID/build validation and an authorized invitation on an isolated Identity target remain pending. No emails or accounts were created; production was not published. Acceptance, password setup, confirmation, exact owner UUID configuration and owner membership remain pending. Preserve both native settings and all CRM guards. Review/approve the fix before production rollout and the supervising assistant's owner invitation retry. Earlier Open-registration findings below are historical and superseded.

---

# Release gates and remaining work

## Current bounded gate — October 19, 2026, 20:48 UTC

Owner and limited-staff access remain unproven. A fresh lookup confirmed production deployment `6ad68082945013df884a640f`, source `3c300f1eddbd7cca8a3d070112686aa387370118`, ready, database branch `production`. Signed-out read/write/export each returned 401. Registration remains Open, confirmation is required, and project environment metadata still contains no `CRM_OWNER_ID` key. Identity user lookup returned 401, so current invitation/confirmation status is unknown.

This pass changed documentation only. No blocking code defect was demonstrated; no tests were added or rerun in place of activation. Earlier passing typecheck and 52 mocked/pure tests are historical evidence. No account/configuration/membership changes, records, approvals, migration changes or production publication occurred.

Complete the precise owner-run checklist in the current section of `verification.md`. Owner authorization is required for registration, invitations, configuration, permission changes and deployment. No isolated rehearsal URL/deployment/database branch or authenticated sessions were verified; create no fixtures until isolation is confirmed. Production readiness is not established.

After activation/access passes, propose the isolated S1–S9 and commercial-version rehearsal as the next bounded milestone. Broader work remains deferred. Preserve pricing pending D3, manual outreach logging, and S9 as accepted delivery responsibility rather than payment.

## Historical broader backlog

The verification pass fixed access-state ambiguity, essential record selectors, calendar saving and validation defects. Pure rules, mocked API guards and jsdom interactions were exercised; authenticated production workflows remain unverified. No customer data was imported and no real staff account was invented.

1. **Owner/platform setup and rehearsal:** change public signup to Invite only (it remained enabled at inspection), invite and verify Lyric, configure her exact UUID, preserve the two already applied migrations, inspect the new platform build results, then run the complete two-user checklist in `verification.md`. Fix any runtime/build defects before permitting real-data usage.
2. **Expand automated integration verification:** exercise the deployed API with owner, manager, contributor, delivery and viewer fixtures; assert stage guards, suppression across imports, stale writes, commercial version changes, export scope and idempotent delivery creation. The 11 pure rule tests passed; selected API guards and workspace/SDK wiring also passed mocked tests. Real Identity/Postgres integration and concurrency tests remain required. Add browser interaction/accessibility checks in an environment with browser tooling.
3. **Import and migration tooling:** research CSV is implemented; opportunity/activity/discovery workbook mapping and import, full relational restore, source-file digest tracking and richer duplicate-review workflows remain. No merge is exposed. Persisted import summaries currently list successful/failed accepted rows and aggregate skipped/duplicate/invalid counts; richer skipped-row reasons are a follow-on.
4. **Workflow polish:** add one-click research conversion with defaults, direct navigation among linked records, task completion from queues, and paginated server-side search for larger datasets. Current conversion is available through the new opportunity form's searchable research selector. Essential contact/proposal/delivery/staff/reader links now use searchable selectors; initial membership administration still requires the verified Identity UUID. Offer family reference is a business code, not a copied UUID.
5. **Configuration:** editable stage display labels, service routing/business contact details, named responsibility defaults, configurable clock/hold policies, and more granular per-record report scopes remain. Current stage labels are defaults in code; weekdays/holidays are editable; same-local-time and continuing hold clocks are explicit fixed policies. Commercial term/waiver/disclaimer content and prices require founder decisions rather than invented defaults.
6. **Commercial refinements:** dedicated catalogue-approval linkage into client proposal drafts, richer recurring plan quantities, custom quote deadline commitment policies, change-request notifications and capacity assignment queues. Current quotes capture scope, missing information, owner and an optional committed deadline; current queue uses generic record details and commercial decisions. Approved offer versions are immutable snapshots, but composing a proposal does not automatically copy an offer snapshot.
7. **Operational hardening:** indexes/pagination for scale, tighter structured payload schemas, configurable holiday calendars, comprehensive membership change concurrency tests, audit export/backup automation, and retention policy documentation. Suppression is conservative at organization level in this version. Sensitive document collection remains excluded.

The next bounded task is to complete owner configuration and execute a two-user end-to-end Project Studio rehearsal, covering one clean inquiry, one regulated discovery, one opt-out/re-import, one stale edit, and one approved proposal through accepted delivery handoff. Record actual pass/fail results and fix failures before expanding functionality.

Payment processing, compensation/profit distribution, Gmail synchronization, automatic sending, and a full project-management suite remain outside this release by design. No invented profit splits or custom quote turnaround commitments are present.

## Current bounded gate — October 24, 2026

This section supersedes the historical setup blockers above. Owner activation, staff invitation acceptance and the controlled two-user sales rehearsal have now produced live evidence on isolated database branch `agent-6adcb005c816800de1515e71`. The final reviewed preview is deployment `6adcb9273f868bf1babe48cf`:

- https://6adcb9273f868bf1babe48cf--emerson-crm.netlify.app
- https://agent-6adcb005c816800de1515e71--emerson-crm.netlify.app

Fresh owner access, active contributor access with commercial authority off, shared S9 graph persistence, direct permission denials, immutable V1/separate V2 approval, future-service-start proposal sending, matching V2 work-order/handoff integrity, H1/H2 discovery holds, permanent normalized suppression across changed identifiers, CSV exclusion/deduplication, filtered formula-safe export and an actual stale-write 409 passed. Both accounts' logout cleared workspace data and retained 401 read/write/export after refresh; contributor logout also cleared an open detail. See the dated current-results section of [verification.md](verification.md) for precise evidence limits. Local and remote suites each passed 66 tests and type checking; initial local build and the final remote pipeline passed at their respective revisions.

Remaining release actions, in order:

1. Owner and contributor fresh re-login checks are complete: both retrieved the same S9 opportunity and matching V2 delivery graph after logout, with staff privacy and commercial restrictions retained. Preserve these receipts; do not repeat this gate in place of rollout review.
2. Verify the practical managed-database backup/branch-restore procedure and ownership of Identity/environment recovery. CSV alone cannot restore memberships, settings, audit or Identity. This is a single-owner pilot; do not assume an independent recovery administrator exists. A fresh migration-register query was not obtained, so do not report current migration-history verification from source preservation or live schema success.
3. Review and authorize the concrete production rollout and any production contributor grant. No production publication or production staff permission change occurred in this rehearsal. Synthetic records and approvals stay isolated; real Project Studio pricing still awaits D3.

Distinct authorized delivery-user/wrong-lead acceptance was not tested live; the owner was the designated delivery lead, and assigned delivery-role success has local mocked coverage. No extra Identity account was authorized. Complete role-matrix, recovery-email and broader concurrency/disaster-recovery exercises remain follow-on hardening. Full relational import/restore, supported merge, larger-scale search, broader configuration and integrations remain deferred rather than being prerequisites to repeating the already-passing synthetic workflow. Do not invent prices, automate outreach or treat S9 as payment.

### Production update — October 24, 14:33 UTC

The owner separately authorized publication and production owner verification. The reviewed code is now published as ready production deployment `6adcc1b33195872cc470df71`, source `2017b20dd09a89c113b822a17d92bff15f57b446`, database branch `production`. Owner GET 200 with active/commercial owner and normal workspace loading passed; signed-out read/write/export stayed 401. Production retained eight original offer drafts and no known rehearsal fixtures or preview contributor membership.

Owner and contributor fresh preview sessions are complete. Managed backup availability and the supported recovery procedure were verified without executing a restore. Immediate business actions are D3 real pricing/terms and a separate production contributor grant if desired. The remaining role-matrix, recovery and concurrency exercises are follow-on hardening; do not repeat resolved activation or preview gates as if still blocked.
