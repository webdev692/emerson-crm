# Hosted synthetic CRM education bridge candidate

This source candidate is separate from the existing loopback rehearsal. Its
compiled profile is disabled and unconfigured. No hosted database/configuration,
staff access, account, message or deployment was changed by this implementation.

## Authorization and data boundary

The normal CRM Identity login remains authoritative. Hosted education additionally
requires the exact compiled Netlify site and production deployment context, the
canonical CRM origin, explicit server-side feature variables, a current confirmed
and invited Identity account retrieved through the admin read API, and the existing
active non-viewer HR/owner membership under advisory lock `7031926`. Display names,
client approver fields and user metadata grant nothing. No staff writer or owner
bootstrap was added.

The server selects the hosted policy; browser input never selects a policy, URL,
reviewer, database or signing key. The default policy in `education-clearance.mts`
retains its `.invalid` staff restriction, local environment, local target and
original checkpoint source. Hosted mode cannot fall back to it.

Only the three fixed fictional person/application/program IDs and a compiled
`epdg-hosted-synthetic:` source key may be used. All four linked source records
must be explicit synthetic fixtures with synthetic titles; the learner email is
`learner-b@epdg.invalid`. Real applications cannot be exported through this bridge.
Application/person/source revisions, current withdrawal, prior reviewer authority
and four separately reviewed evidence criteria are reloaded under the same lock.
Each decision and exact outbox body remains append-only/immutable.

## Compiled profile and migration gate

`netlify/functions/lib/education-hosted-profile.json` contains only non-secret
deployment pins: site ID, canonical CRM/backend origins, database name/identity,
fictional source key and explicitly verified existing reviewer UUID/email pairs.
The checked-in profile has `enabled: false`, null target/database pins and no
reviewers. Runtime URL variables cannot replace these pins.

Migration `20261027132453_hosted_education_identity` was generated using the
repository's pinned Drizzle tool. It adds an immutable operator identity table,
enables RLS, revokes PUBLIC access and checks the exact site/fixed fixture scope.
It adds no fixture or membership rows. It preserves local checkpoint behavior
while allowing a fresh operator observation of the pinned hosted receiver.

A separate reviewed operator DML migration must seed the fictional records and
verified bridge marker after the actual hosted database, reviewer account and
target have been checked. The marker must match the compiled
database/site/origins/source/reviewer pins; RLS, trigger and grant readiness is
checked before every education transaction. The marker has no browser/API writer.

Migration `20261027142059_hosted_receiver_observations` adds a separate hosted
append-only operator observation stream. The existing one-shot local checkpoint
table and all earlier migration bytes are unchanged. Each hosted observation is
bound to the exact immutable identity and receiver target under lock `7031926`.
Its actual UTC observation time must be no more than five minutes old and cannot
be in the future. Observation times strictly increase, receiver versions cannot
decrease, and an unchanged version must retain the same canonical state hash.
Updates/deletes and any append after the first CRM decision are rejected. RLS,
the precise guard trigger and absence of browser grants are checked at runtime.
The first decision uses the latest fresh observation; later decisions use the
existing append-only CRM sequence. No earlier CRM approvals are invented.

Two reviewed templates live outside auto-applied migrations in
`docs/operator-migrations/`: `hosted-fixture-seed.sql.template` and
`hosted-receiver-observation.sql.template`. Both are deliberately disabled and
have null deployment pins. The seed has an exact `netlifydb` guard, verifies the
existing owner membership and aborts on any fixture/marker collision. It inserts
four fictional HR-scoped records, the immutable marker and explicit audit rows;
it never writes staff, roles, decisions, outbox, clearance or receiver state.
Current server-side Identity verification is an independent prerequisite; the
historical owner UUID in the template is not proof of current authorization.

Apply schema and the configured seed once through reviewed migrations, with the
hosted profile/runtime disabled until verified. These steps have no short clock
window. Complete packaging/provider/authentication checks before capturing a
receiver observation. The separate observation migration records a real captured
timestamp, exact receiver version, canonical state SHA-256 and a private evidence
source identifier. Never replace the captured timestamp with `now()` or a future
time. A receiver state hash is over a deterministic stable projection of the
fixed mapping and current decision version/status, excluding observation time,
request nonce and other changing transport metadata. The retained private
evidence source must establish which actual deployed receiver was inspected.

If delivery of an observation migration takes longer than five minutes, it fails
without inserting a row or advancing CRM history. A never-applied candidate may
be replaced with newly captured and reviewed evidence; preserve its failed
attempt in release evidence. Once applied, its bytes and observation are never
changed. If setup then takes too long before the first review, the API returns
409 and a new migration appends a freshly reobserved checkpoint. There is no
permanent one-row checkpoint trap and no approval/freshness bypass. After the
first decision, observations are closed and normal explicit reviews advance the
sequence. No HTTP observation writer, staff grant or hidden runtime refresh exists.

The CRM continues to use Netlify Database through its supported adapter. There is
no separate browser store or arbitrary hosted PostgreSQL connection option. Its
existing server database owner is the trusted application boundary; this marker's
RLS is not represented as per-staff SQL isolation. API authorization still enforces
HR scope before data responses.

## Wire and runtime settings

Feature variable names only:

- `CRM_HOSTED_EDUCATION_ENABLED`: explicit `1` to enable the compiled hosted policy.
- `CRM_EDUCATION_ENVIRONMENT`: exact `synthetic-hosted`.
- `EPDG_HOSTED_PRACTICE_HANDOFF_ENABLED`: explicit `1` for outbound delivery.
- `EPDG_HOSTED_PRACTICE_HANDOFF_KEY`: independently generated canonical base64url
  encoding of 32 bytes, provided securely in Functions runtime scope.

Local rehearsal flags/keys must be absent. The key is never imported into browser
code, stored in the profile, included in the payload, or logged.

The strict body retains the local minimal fields but uses environment
`synthetic-hosted`. The target is the compiled HTTPS backend origin followed by
`/internal/crm/onboarding-handoffs`. The key ID is `synthetic-hosted-v1`.
`X-EPDG-Handoff-Audience` and `X-EPDG-Handoff-Source` equal the two compiled origins.
The HMAC-SHA256 input is the newline join of:

1. `EPDG-CRM-HOSTED-PRACTICE-V1`
2. `POST`
3. `/internal/crm/onboarding-handoffs`
4. Exact backend origin
5. Exact CRM origin
6. Unix-second transport timestamp
7. Fresh UUID nonce
8. SHA-256 of the exact stored UTF-8 body

There is no final newline. The key is decoded to binary before signing. Requests
use Node's HTTPS transport with certificate verification, fixed host/path, no
redirect/proxy/header override, bounded bodies and an absolute timeout. Retry
preserves body bytes and changes only transport nonce/timestamp/signature.

The receipt is exactly seven fields: `success`, `environment`, `event_id`,
`result`, `received_at`, `current_status`, `decision_version`. Additional fields,
wrong environments/IDs, contradictory status and stale versions are rejected.
`revoked` means `withdrawn` even when the separate withdrawn boolean is false.
An older exact duplicate can acknowledge the receiver's newer current state.

## Delivery and release limits

This remains an explicit-dispatch synthetic workflow. Source/reviewer changes can
queue a held decision; receiver access changes only after a successful dispatch.
Pending/failed delivery is not equivalent to a receiver acknowledgement, and no
autonomous worker, staff service account or hidden human impersonation was added.
Real learner rollout needs a separately reviewed delivery/freshness policy.

The receiver rejects a never-applied decision whose source issue time is older
than five minutes. Do not rewrite its outbox bytes to refresh it. Obtain an explicit
new current review if the receiver cannot recognize the exact retry.

Unit tests mock HTTPS rather than contacting a service. PostgreSQL tests use fresh
random-port loopback clusters and mock only platform Identity/context and the DB
factory. They do not establish hosted Identity/database/deployment acceptance.
The production round trip, configured migration application, operator confirmation,
current hosted function packaging and published-artifact/browser checks remain
root release work. Owner/admin controls and real HR activation remain closed.
