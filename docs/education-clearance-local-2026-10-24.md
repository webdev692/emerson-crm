# Local synthetic HR clearance and EPDG handoff

This is a local source and synthetic-test milestone. Production, hosted previews,
Google Workspace records, Identity accounts and the operating EPDG rehearsal
runtime are unchanged. No billable Netlify run, publication or real-data import is
part of this work. The earlier 105-file readiness ZIP remains a separate,
historical candidate.

## Implemented boundary

The CRM owns applicant identity and onboarding evidence. A workflow stage of
`Active`, descriptive onboarding status, staff training completion, marketing
permission or a suppression does not establish education eligibility.

In the explicitly enabled local rehearsal, an authenticated active synthetic
owner or HR writer reviews four requirements: identity, onboarding, agreements
and HR approval. A viewer cannot issue a decision even with an HR flag. The API
reloads the member inside the same advisory lock used for source edits and staff
permission changes. It stamps each requirement with the actual reviewer, time
and evidence reference; client-supplied approver fields are rejected.

Decisions bind the current application and person revisions, import source key,
source fingerprint/version and the fixed fictional program mapping. Clearing
requires all four affirmative reviews and no identity/source/withdrawal hold.
Withdrawal is sticky until an explicit restoration review; changed evidence
requires a fresh review. A different current HR writer can revoke an earlier
review without impersonating its author.

`crm_education_decisions` is append-only. Each decision creates a durable outbox
event containing exact canonical JSON bytes and their SHA-256 hash. Database
triggers prevent editing/deleting decisions, replacing outbox bodies or erasing
attempt counts. A newer decision supersedes undelivered older events. Dispatch
reloads current evidence and reviewer authority under the shared lock and queues
a newer hold when an earlier clearance has become stale. It never selects an
older cleared event after revocation. Network failures preserve the body for a
freshly signed retry, with a new nonce and transport timestamp.

Observed changes to an already applied/excluded import create a deduplicated
audit observation while the original receipt stays intact. A rejected batch
creates no other preview rows. The observation blocks clearance against that
old source. A separately reviewed source version/application is required; there
is no override that clears a known source-change hold.

## Default-off controls

Clearance API availability requires all of the following, checked server-side:

- Request URL uses `http` and the exact host `127.0.0.1`.
- `CRM_SYNTHETIC_EDUCATION_ENABLED` equals `1`.
- `CRM_EDUCATION_ENVIRONMENT` equals `synthetic-local`.
- Hosted context indicators `SITE_ID`, `DEPLOY_ID`, `CONTEXT` and `NETLIFY` are absent.
- The reloaded actor has an active HR writing role and a fictional `.invalid` address.
- The application, person and CRM program have the pinned synthetic UUIDs.

Dispatch additionally requires `EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED` equal to `1`
and an independently supplied local `EPDG_SYNTHETIC_CRM_HANDOFF_KEY`. No key is
included in source, fixtures, browser responses, reports or ZIPs. Tests use
ephemeral keys. This work does not enable or configure these values in any
operating runtime. There is no authentication bypass, automatic Identity
invitation, staff grant or learner enrollment endpoint.

The only target is
`http://127.0.0.1:58000/internal/crm/onboarding-handoffs`. The raw HTTP sender
rejects alternative targets, redirects and browser/proxy/session headers. The
wire body contains only fixed identifiers, decision/version, reviewer ID,
requirement flags, withdrawal and protocol timestamps/constants. Applicant names,
emails, resumes, agreements, notes and evidence references stay inside the CRM.
Only a validated receipt updates delivery status. A revoked decision is shown by
the existing EPDG consumer as `withdrawn`, even when its separate withdrawal flag
is false.

## Local verification

Run commands from the CRM folder with the existing dependencies. No dependency
installation, hosted database connection or Netlify CLI is needed.

```powershell
node scripts/generate-routes.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/vitest/vitest.mjs run
node node_modules/vite/bin/vite.js build
```

The PostgreSQL suites are opt-in and create fresh random-port loopback clusters
with fictional records. They never read a hosted connection string or operational
EPDG key. The test helpers stop their own clusters and retain isolation/stop
receipts. On this workstation the sandbox blocks local DB sockets, so these
commands require the ordinary local-socket sandbox escalation:

```powershell
$env:CRM_EDUCATION_POSTGRES_TEST='1'
node node_modules/vitest/vitest.mjs run src/lib/education-postgres.test.ts
```

The separate consumer guard suite and its exact command are recorded with the
final acceptance evidence in
`build-evidence/emerson-crm-education/2026-10-24`. It verifies the forward-only
EPDG reviewer compatibility patch against a fresh private cluster; it does not
migrate or restart the existing EPDG runtime. Existing EPDG migrations and their
historical hashes stay intact. Apply its new migration only as an explicit future
local-runtime rollout, before starting the corresponding new EPDG build.

`scripts/build-education-review.mjs` creates a standalone read-only visual
artifact with fictional data and network access blocked by CSP. It is a review
tool, never an application entry or deployment asset. Browser policy blocked its
local file URL during this run; component behavior is covered by automated DOM
tests, and no manual browser pass is claimed.

## Limits and next gates

These tests exercise the actual CRM handler with mocked Identity, real isolated
PostgreSQL, ephemeral-key protocol tests and the local consumer guards. They do
not prove a live Netlify login, hosted HR permissions or a delivery to the
already-running EPDG service. No operating key was accessed for that purpose.

Reconciliation happens when current source changes are observed and when status
or dispatch is requested. There is no background Google Workspace freshness poll
or automatic external dispatch. An HR operator must observe new evidence and send
the current hold/revocation; a queued decision alone does not change portal access.
Delivery holds the CRM write lock for a bounded network attempt to prevent a
concurrent source/permission edit from exporting stale clearance.

Before any real-data use, verify the destination deployment/database and inherited
data boundary, live owner/HR/non-HR/viewer controls, the approved HR evidence policy,
real person/program mappings, source freshness and an approved import batch. A
production service transport, secrets/rotation, dispatch operations and real EPDG
mapping policy require their own review. This synthetic-only path cannot be
promoted by changing a flag. Production publication still requires the user's
approval.
