# Company CRM foundation — 24 October 2026

The owner approved the audit-based foundation: a shared directory, separate workflows, an import review queue, and template/training resources. This is the implemented local review candidate. The published production baseline remains deployment `6adcc1b33195872cc470df71`, source `2017b20dd09a89c113b822a17d92bff15f57b446`. No new production deployment or workspace import occurred during this build.

## Daily use

### Directory

Use **Directory → Add person / Add organization**. Existing contact and organization UUIDs are reused. Add an affiliation to link one person to additional organizations and relationship types. A person may have a class interest, customer relationship and application without becoming three people or three sales opportunities.

New directory entries can be team-visible or HR-restricted. Existing records retain their previous record-level visibility. A named owner, next action and due date keep pending work accountable. An exact email match requires review rather than silently making a second person. Common contact details belong here; resumes and applicant narratives belong on restricted applications.

### Workflows

Separate case types are available for service inquiries, classes, community partners, colleges, investors, program applications and sales applications. Each has its own stages. The service inquiry case records interest; **Service opportunities** opens the existing guarded S1–S9 sales process. Changing a workflow case does not approve a proposal, establish payment, create staff membership or bypass commercial gates.

Program and sales applications are HR-restricted. They can hold applicant/cohort/onboarding references and an HTTPS resume link. Class cases can hold topic/session/timezone/registration information; they do not establish that a class is approved, operating, attended or paid. Catalog scheduling and payment integration are later deliveries.

### Import review

Owners/managers can map a CSV, choose its workflow, provide a stable source name and original source row ID, and queue records for review. Applicant imports additionally require HR authority. The UI accepts up to 100 rows; the API caps requests at 200. Default ownership is the submitting reviewer. Every row needs a next action and due date.

Use a source name identifying the real Form/file/tab and source version. Preserve the original source row ID across retries. Do not use a new random source name to avoid duplicate detection. A repeat preview returns the registered row rather than overwriting its history. To correct an excluded or invalid source, review a corrected source version deliberately; completed review decisions are immutable.

Mapped dates must include `Z` or a numeric UTC offset. An unmapped due date uses the explicitly displayed operator-device timezone. Preserve source timestamps and source timezone in your reconciliation process; do not guess a timezone from a Drive modification date.

Queue outcomes are ready, duplicate, conflict, invalid, test, applied or excluded. No queue row is automatically applied. Review its source and permission evidence, enter a reason, and apply or exclude it. Duplicates require an explicit matching-email person selection. Invalid, test and unresolved conflicting rows are held for source correction/exclusion in the interface. Tests, EXAMPLE rows and `.invalid` addresses cannot be applied by the intake API.

Applying is transactional: the reviewed person link/create, optional organization, separate case, queue decision and audit entries either commit together or roll back. Concurrent requests return a conflict rather than making two cases. Unknown permission stays Unknown. A submission is not marketing consent; marking marketing permission requires explicit HTTPS evidence. Existing no-contact restrictions prevail over imported permission claims.

### Library

Create a template or training resource with text or an HTTPS asset URL, its audience, source and review responsibility. Files remain in their original Drive location and retain Google permissions. This build does not download or copy workspace documents, resumes or recordings into the application.

Resources move through Draft, Needs review, Approved and Archived states. Only the owner approves a version, with a reason and server-stamped actor/time. Approved versions are immutable; **New version** creates a draft in the same family and does not inherit approval. Type and audience remain fixed within a family. Copying template text requires an approved version. The application sends no email.

Managers can assign an approved training version to an active staff learner. Learners can record progress and an HTTPS worksheet link; managers verify completion. Resource version and assignee are fixed on an existing assignment. HR training requires an HR-authorized learner. Completion does not grant staff access, commercial authority or compensation rights.

## Permissions

| Permission        | Meaning                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Active membership | Required before CRM read, write or export                                                                       |
| Owner             | Existing owner authority, including HR; exact configured invited/confirmed Identity bootstrap remains unchanged |
| Manager           | Sales/team management and intake review; no implicit HR authority                                               |
| Explicit HR flag  | Owner-granted HR scope, independent of commercial authority and still subject to record access/ownership rules  |
| Contributor       | Manual directory/case preparation and assigned work; no manager import or owner approval authority              |
| Viewer            | Read-only permitted records                                                                                     |
| Commercial flag   | Existing explicit commercial decisions; does not imply HR access                                                |

The additive migration sets existing `members.hr` to false and existing `records.access` to `record`. It grants no new staff membership. Team scope is deliberately shared with active members; HR scope is checked before manager/global reads, assignment, readers and parent inheritance. Linked private records and nested snapshots remain private. CSV and audit responses use the same privacy boundary. Existing legacy contact editing routes to Directory; direct legacy writes cannot bypass the new allowlist/privacy guards.

## Restrictions and existing sales behavior

- Canonical normalized suppression events remain permanent. A contact/case marked Do not contact registers its identifiable restriction, retains old identifiers when contact details change, and propagates restrictions to matching contacts/cases, research and existing opportunity X4 status.
- A contact must have an identifiable email, phone or website to register a new permanent restriction. Name alone is not a normalized global identity.
- Marketing evidence cannot remove a prior no-contact restriction. Reimporting the old identity or changing the source ID cannot erase it.
- Existing commercial versions/approvals, research CSV imports, cumulative S1–S9 gates, accepted delivery handoff and stale-edit protection remain in place. S9 represents delivery responsibility, not payment.
- A resource approval does not approve service prices, D3, a contract, outreach, revenue sharing or commission. Conflicting workspace materials still need owner review.

## Scope boundaries

The foundation is usable for deliberate manual entry and reviewed CSV intake. Automatic Google Forms/Gmail/Drive ingestion, Gmail OAuth/sending, scheduled follow-up, paid prospect discovery, class scheduling/payments and full hiring automation are not included. Audited workspace data has not been bulk imported. Existing training materials have not been declared approved or seeded automatically.

The API currently loads the authorized workspace snapshot; it is not a paginated high-volume ingestion system. Keep initial imports bounded and reconcile each source. Server query pagination and broader source connectors should precede importing the entire workspace at scale.

## Validation and release

See the private local build receipts under `build-evidence/emerson-crm-foundation/2026-10-24` outside this application. The opt-in PostgreSQL suite uses real SQL transactions and migrations with mocked Identity and database factory, not real Identity sessions.

The review HTML is a synthetic, read-only visual aid with inline scripts/styles, no production connection and blocked writes/network access. It is not the deployed CRM and is not a substitute for live role/Identity verification. Browser-tool policy blocked opening the local file, so visual inspection is not claimed.

Netlify CLI deployment access stopped on `EPERM` opening its local configuration. No remote build/deploy was started and no deployment log URL exists. The next rollout requires a platform-built isolated preview, verified database mapping and owner/non-HR/HR/viewer checks before production publication. Do not apply the migration directly to a hosted database; deploy the generated migration through the platform.
