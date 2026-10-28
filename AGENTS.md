# Emerson CRM architecture

This is the dedicated internal CRM; do not modify public company websites. React 19, TypeScript, TanStack Start and Vite render a responsive workspace. Netlify Functions own all protected operations; Netlify Identity authenticates individual staff; Netlify Database is the sole authoritative persistent store.

## Important paths

- `src/workspace.tsx`: workspace navigation, dashboard, tables/pipeline, authentication callbacks, record forms/details, staff/calendar settings, mapped research CSV import and relationship directory.
- `src/components/foundation-workspace.tsx`, `src/lib/foundation.ts`: shared directory, affiliations, distinct workflows, reviewed intake, versioned template/training resources, and learning assignments.
- `netlify/functions/lib/foundation.mts`: foundation validation/transactions and shared access policy. Restricted scope is checked before role, assignment, readers, parent inheritance, audits and exports. Sales management never implies HR access.
- `src/lib/fields.ts`: form field definitions by record kind.
- `src/lib/rules.ts`: fixed stage codes/default labels, five-criterion rubric, business-day calculator, identifier normalization, CSV safety, historical service references.
- `netlify/functions/crm.mts`: authenticated API, active membership and permissions, optimistic revisions, transactional stage/approval/suppression/handoff guards, import summaries, and filtered export.
- Netlify Identity's native Invite only setting rejects public registration. Do not gate pre-creation validation on `invitedAt`: invitations receive that timestamp after validation.
- `db/schema.ts`, `db/index.ts`, `drizzle.config.ts`: Drizzle schema and supported Netlify adapter. Keep `drizzle-orm` and `drizzle-kit` on the supported beta integration version.
- `netlify/database/migrations`: generated migrations with self-referential record foreign keys; the relationship migration also seeds eight draft service entries with null prices.
- `docs/verification.md`, `docs/backlog.md`, `README.md`: execution status, release gates, limitations, setup and recovery.

## Data and conventions

Record kinds use a shared `crm_records` envelope with real organization/parent/member foreign keys and a versioned JSON payload. This keeps varied CRM workflows linked without conflating organizations, research, opportunities or activities. `crm_members`, `crm_audit`, and `crm_settings` are separate tables. Do not introduce browser/local-file persistence for CRM data. No deletion API is provided. Immutable events and commercial versions preserve provenance. Never import blank preassigned workbook IDs or synthetic EXAMPLE prospects.

Foundation records use `access` (`record`, `team`, `hr`); existing records retain `record` access after the additive migration. An owner or explicit `members.hr` grant is required for restricted scope, independently of commercial authority. Applications and applicant intake are always restricted. Keep resumes, assessments and private applicant notes out of shared contact payloads. Do not downgrade HR records or expose private IDs through snapshots or duplicate suggestions. Organization/contact editing uses the foundation allowlist; the older sales write path must not bypass it.

Intake source keys combine stable source name and original source row ID. Preview persists review rows only; applying a reviewed row atomically links/creates a person and a distinct workflow case. Never automatically merge people, apply tests, grant staff access, assume payment or upgrade marketing consent. Permanent restrictions use canonical suppression events and survive changed identities and reimports. Library approvals are owner-stamped immutable versions and do not authorize sending, pricing or compensation.

Use camelCase in TypeScript, snake_case database columns, UTC timestamp storage, and America/New_York operational date calculations. Inputs currently use the device timezone and explicitly disclose it. Essential text must meet accessible contrast. Preserve keyboard dialog focus handling, labels, mobile layout, errors and empty states.

Authenticate and check active membership before any database record response. Never trust display names, user metadata, client-supplied approver/acceptance fields, or assignment as approval authority. Initial ownership requires an exact administrative `CRM_OWNER_ID` and an invited, confirmed Identity account retrieved server-side. Identity invitations are managed in the platform UI. Staff edits are owner-only and verify the target Identity account. No secrets belong in browser imports or generated assets.

All writes affecting stages, suppression and approvals use a shared transaction advisory lock. Revisions reject stale edits. Preserve the cumulative gates on updates even when the stage code is unchanged. Scope/price/terms changes require a new immutable offer/proposal version, with new approval. A won handoff is delivery acceptance, never revenue. A suppression is permanent and independently normalized; never erase it on import, reassignment, reopening or duplicate encounters.

## Validation

The local education rehearsal lives in `netlify/functions/lib/education-clearance.mts`,
`education-handoff.mts` and `education-transport.mts`. It is default-off, exact-loopback,
fictional-ID-only and unavailable in hosted contexts. Keep HR decisions append-only,
source/current-authority checks under lock 7031926, and outbox retry bytes immutable.
Never turn stage labels or CRM staff training into applicant clearance. See
`docs/education-clearance-local-2026-10-24.md` for the local-only limits and tests.

Follow the current run instructions for which commands may execute. The initial run prohibited build/start/test commands, so it only read source files and formatted edited files. Do not claim the authored tests have passed. Subsequent authorized environments should run the README commands and two-user verification checklist. Generate a migration for every schema change. The platform handles deployment, commits and review integration; do not create those manually unless explicitly authorized by the active run instructions.

The October 24 foundation build is explicitly authorized for local implementation and testing. Its PostgreSQL test is opt-in and creates a fresh local loopback-only synthetic cluster; never substitute a hosted database URL. `scripts/foundation-review.mjs` and `scripts/build-foundation-review.mjs` are synthetic visual-review tools, not application entries or deploy artifacts. Keep their mocked Identity/data out of production bundles. Production rollout and live Identity/role verification remain separately recorded release steps.
