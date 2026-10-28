# Emerson CRM

An internal company relationship workspace for The Emerson Empire, with a shared people/organization directory, separate service/class/partner/investor/applicant workflows, reviewed intake, and a versioned template/training library. The tested Project Studio S1–S9 sales process and draft service catalogue remain in place. React/TypeScript, TanStack Start, Vite, Netlify Functions, invitation-only Netlify Identity, and Netlify Database with Drizzle ORM provide persistence and authentication. Migrations seed only eight draft service references; no workspace leads, applicants, approved prices or training approvals are invented.

The October 24 company foundation is a **local review candidate, not a new production release**. Read [the foundation guide](docs/foundation-build.md) for the new screens, permissions, import decisions, library versions and release limits. The published baseline was deployment `6adcc1b33195872cc470df71`, source `2017b20dd09a89c113b822a17d92bff15f57b446`. Local source was verified against all 88 baseline manifest files before this work.

## Deployment and owner setup

The deployment pipeline installs dependencies, builds the application, provisions the database on first connection, and applies `netlify/database/migrations`. The new additive migration adds explicit HR membership and record access scope without expanding any existing staff grant. Production target: https://emerson-crm.netlify.app. The new foundation requires isolated platform preview validation before production rollout; no new deploy was initiated during this local build.

A project administrator must complete these steps before staff can access CRM data:

1. In the dedicated Emerson CRM project, open **Project configuration → Identity**. Confirm Identity is enabled, registration remains **Invite only**, and email confirmation remains **Required**. Native Identity enforcement rejects public signup; no custom validation hook checks invitation timestamps before they exist. Keep these settings in every test target too.
2. In **Identity → Invite users**, invite Lyric using her real, verified email address. No email address is assumed by this application. She accepts the invitation at the deployed CRM and sets an individual password. Her account has no CRM data access yet.
3. Open her Identity account detail. Verify the account and copy its user UUID. The CRM bootstrap does not require an Identity `admin` role: its server-side Identity lookup uses the Functions operator context. Identity roles alone never grant CRM access.
4. Set `CRM_OWNER_ID` in secure project environment configuration, scoped to Functions/runtime, to that exact Identity UUID. Redeploy so the runtime receives the configuration. Do not prefix this setting with `VITE_` or place it in source code.
5. Lyric signs in again. The server verifies the configured UUID against the Identity admin API, checks invitation and email confirmation, and creates her active owner membership. Registration order and display names confer no authority. An inactive membership is never automatically reactivated.
6. Invite each staff member through Identity. After they accept and verify, use **Settings → Staff access** to grant their exact Identity UUID a role and active membership. Commercial approval is a separate explicit flag. Revocation is done by saving the membership with **Active membership** unchecked. Invitations remain a platform administrative operation in this release.
7. Assign Todor, Kenny, Adit, and other responsibilities to verified staff records. No accounts or staff addresses are invented. Select capacity reviewers and delivery leads by name from the staff selectors. Review calendar assumptions and complete the verification checklist before entering real customer records.

Until setup is complete, the public page requires sign-in and withholds business totals. Signed-in non-members, loading, failures, authorized empty results and populated results have distinct states. No records are embedded in server HTML; `/api/crm` rejects unauthenticated users and inactive/non-members.

## Roles and record access

- **Owner** manages membership, settings, commercial decisions, assignments, and records.
- **Manager** manages the team pipeline and assignments. No commercial approval authority is implied.
- **Contributor** prepares research, assigned opportunities, activities, discovery, tasks, and commercial drafts. Assigned records are editable; explicit reader access alone is read-only.
- **Delivery** reads assigned delivery opportunities and creates their work order/handoff records. Only the designated active delivery lead (or a designated owner) accepts a handoff.
- **Viewer** reads specifically granted records and the shared service catalogue. Exports include only readable records.

Owners grant HR authority separately in **Settings → Staff access**. Sales managers have no implicit HR access. Restricted scope is checked before role, assignment, reader and parent grants, including linked records, audit snapshots and CSV. Existing record-level grants remain in effect; new team directory entries are shared with active staff. Keep resumes and assessments on restricted applications. Managers can still grant permitted legacy record readers; commercial authority remains separate from opportunity ownership.

## Daily use and business rules

Use **Directory** to create and edit people and organizations, then add affiliations or distinct workflow cases. Existing contact and organization UUIDs are retained. Service inquiries open the existing **Opportunities** process when ready for commercial review. Records use stable UUID links and searchable selectors. Offer family references remain human-readable business codes. Research conversion still requires the approved outreach revision and actual contact activity. Separate cases do not inflate sales opportunity or revenue totals.

S1–S9, H1–H3, and X1–X4 codes are fixed. Stage changes require internal HTTPS evidence and reasons; later sales stages enforce cumulative evidence gates on every save. Acknowledgment must be logged or a verified auto-confirmation linked. Discovery uses five Met/Not met/Unclear criteria, with regulated need taking precedence over package mismatch, then all-met qualification, then uncertainty, then incomplete gaps. Follow-up/no-show closure requires a logged follow-up or reschedule offer; there is no automatic closure deadline. X3 reopens only after a newly recorded prospect-initiated contact with evidence. Research and notes never count as actual contact.

Default calendar: America/New_York, Monday–Friday, no holidays initially configured, next working date at the same local clock time, with clocks continuing on holds. Weekdays and holiday dates are configurable. Clock and hold policies are explicit but fixed in this release. Existing commitments are not recalculated after calendar changes. Date/time inputs use the operator device timezone; stored event/deadline timestamps normalize to UTC and displayed date labels use New York. New inquiries create acknowledgment tasks; logged discovery calls create documentation tasks. Staff complete tasks manually after doing the work.

Offers/proposals are immutable versions. Correct a draft by creating another version. Unknown prices remain blank/null with `pending`; genuine free services use `free` with an explicit zero. Prices quoted in the review are historical May 2026 references, never approvals. Project Studio prices await D3. Each approval records the exact revision, reason, actor, timestamp and snapshot. Catalogue, outreach, and client-specific proposal decisions are separate. Only a specific approved, valid proposal can be logged as sent and used at S7+. Create a work order after written acceptance and confirmed capacity; the assigned delivery lead then accepts the handoff. S9 closes the commercial handoff and implies no payment.

No-contact entries are immutable. Matching uses normalized email, phone, and official domain, independently of opportunity assignment. Suppression updates affected opportunity stages to X4 and blocks outbound activity logging. Research may remain stored and flagged. Exact identifier duplicate candidates are shown in record details; no automatic name merges or merge operation are supported. Outreach is performed manually outside the CRM and logged afterward; no email is sent by saving an activity.

## Imports, export, and recovery

**Import review** maps bounded CSV intake for service, class, partner, college, investor, program and sales-applicant workflows. Preview persists review rows only. Apply/exclude requires an explicit reviewed decision and reason; duplicate people require a matching-email selection. Applying is atomic and repeat-safe. Applicant sources require explicit HR authority. Tests, invalid rows and unresolved conflicts remain held. Stable source IDs, Unknown marketing permission and permanent suppression survive retries. No Google Workspace connector is automatically ingested. See [the foundation guide](docs/foundation-build.md).

**Research → Import CSV** accepts research records only. A manager maps columns, supplies a stable source name and original source ID, reviews accepted/skipped/duplicate/invalid rows, then imports accepted rows. Blank numbered and EXAMPLE rows are skipped. Reuse the source name and IDs on subsequent imports. Exact source uniqueness is enforced in Postgres. Official-domain matches are held as duplicates for manual review; similar organization names are not merged. Each row is auditable and retains source, row number and import date. A persistent batch summary and downloadable report record the results. A failed research row may leave its successfully created organization available for retry, but it does not inflate opportunity/research counts.

**Export** downloads all records permitted to the current user, preserving UUIDs, foreign-key relationships, revision and JSON details. Spreadsheet-formula prefixes are neutralized. Store exports in an access-controlled location. This is a portable record extract, not a complete platform backup: membership/settings/audit restoration requires an authorized database administrator. Use Netlify's managed database backup/restore capabilities or an authorized Postgres backup procedure; never put credentials in browser code. Full CSV restore/import of opportunity history and approvals is not implemented.

## Local development and verification

Use Node 22+, `pnpm install`, then `netlify dev --port 8889` in an authorized environment linked to the dedicated project. Identity/database runtime configuration is supplied by Netlify. Generate migrations after schema changes with `pnpm exec drizzle-kit generate --name descriptive_change`. Do not edit migration snapshots manually.

For a subsequent authorized verification session:

```sh
pnpm test src/lib/rules.test.ts
pnpm typecheck
pnpm build
```

The rules suite passed all 11 cases in the verification pass. Type checking now includes Functions and generates the TanStack route tree before running; tests also generate that tree without a build. Additional jsdom and mocked API checks cover access states, SDK callback wiring, searchable selection, permission guards, stale revisions, selected stage rules, immutable versions, suppression and filtered CSV. These do not replace Identity/Postgres rehearsal.

The owner authorized local implementation and verification of the October 24 foundation. Local tests, type checking, real PostgreSQL rehearsal and the production client/SSR build are recorded in the build receipt outside this application. They do not establish a new Netlify platform build or live Identity role check. The earlier published baseline had completed owner activation and a bounded two-user sales rehearsal; do not interpret older October 19 pending activation notes as its current state. The new foundation still needs an isolated platform preview and live role verification before rollout. D3 pricing remains pending.

The separately authorized local HR clearance and EPDG handoff milestone adds
structured source-bound reviews, immutable decisions and an exact-body outbox.
Its synthetic-only API is disabled in hosted contexts. See
[local clearance scope and verification](docs/education-clearance-local-2026-10-24.md)
before running it. It does not import Workspace records, configure a production
sender or create learner accounts.

The October 27 local CRM-to-EPDG handoff acceptance passed against the running
synthetic receiver. See [the local acceptance and publishing gates](docs/education-handoff-acceptance-2026-10-27.md).
This closes the local connection-test gate; hosted Identity/browser acceptance,
real-data imports and production publication remain separate approvals.

