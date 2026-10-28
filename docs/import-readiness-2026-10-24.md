# Controlled import readiness — 24 October 2026

This candidate repairs full-repository lint without suppressing rules, preserves
the existing authentication and access boundaries, and adds bounded intake and
mobile accessibility corrections. Production publication and real-data import
require separate owner decisions. Verification results belong in the supervising
task's evidence register; this source document is not a live acceptance receipt.

## Source review before applying a row

Stable source name and original row ID identify one review entry. The server
fingerprints normalized mapped source fields, including source version and the
HR details where applicable. Re-uploading identical content keeps the same UUID
and decision. Changed pending source content puts the original entry on an
audited conflict hold and invalidates stale review revisions. Its original
payload is retained; an existing-person link cannot bypass the hold. Exclusion
remains available. Applied and excluded receipts are not rewritten by a changed
upload.

A held entry does not automatically become ready when the original content is
uploaded again. Exclude it, retain its history, and separately review the new
source identity/version. Do not invent row IDs to evade duplicate review. There
is no automatic Google Drive freshness check, continuous Forms ingestion, or
hold-resolution override in this build.

Applicant-only CSV mapping preserves source applicant ID, program/position,
cohort, HTTPS résumé reference, and descriptive onboarding status on restricted
intake/application records. Those fields are not copied onto shared contacts,
organizations, or ordinary workflow records. Source version, row, and URL remain
available as provenance. A description such as “Complete” or a stage named
“Active” is not an HR clearance decision and grants no staff or learner access.

## First real-data pilot gates

1. Obtain approval for the exact staging deployment/database and a bounded source
   batch. The current rehearsal remains synthetic-only. Verify inherited data,
   recovery boundaries, the selected source revision, and live owner/HR/non-HR/
   viewer read, write, audit, and export behavior on that exact target.
2. Review the current source and mapping, stable row IDs, duplicates, contact
   permissions, source versions, and withheld records. No automatic merging,
   consent upgrades, outreach, or staff grants are authorized by an import.
3. Start with an explicitly approved ordinary-lead batch and reconcile intended
   rows, actual person/case links, excluded rows, and audit entries. A successful
   local PostgreSQL test does not establish a successful hosted apply.
4. For real applicant/onboarding batches, first implement and rehearse the
   approved HR adapter for identity holds, current withdrawal/revocation state,
   source timestamps and per-field provenance. These fields are not covered by
   the five-field preservation correction alone. Stage historical work as source
   evidence; do not fabricate native receipts or backdate completion.
5. Keep education transfer and learner activation disabled. A future clearance
   and handoff needs a current authorized human HR decision, server-stamped
   evidence/policy/revision, scoped server authentication, idempotency, and
   revocation/stale-decision checks. CRM staff training remains separate from
   education enrollment. Marketing suppression is not education eligibility.

## Training content and interaction checks

Resources retain their original Drive sharing. A valid HTTPS link or successful
metadata read does not prove that a staff Google account can play a video or
open its worksheet. Check the selected approved resources in their intended
accounts; do not make files public to satisfy a check. Content approval,
especially service and compensation statements, remains an owner decision.

The mobile navigation hides closed controls from keyboard focus, reports its
expanded state, and supports Escape dismissal with focus restoration. Dialog
focus trapping, labels, narrow-screen forms, and overflow need browser checks
on the resulting preview. These checks do not replace a comprehensive assistive
technology audit.

Synthetic/test and invalid intake identities remain rejected by the application
path. The opt-in PostgreSQL suite uses its own fresh loopback-only synthetic
cluster and must never be pointed at a hosted or real-data database.
