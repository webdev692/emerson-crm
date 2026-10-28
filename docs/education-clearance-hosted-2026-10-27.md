# Hosted synthetic CRM education bridge candidate

This hosted synthetic bridge is separate from the existing loopback rehearsal.
The October 28 enablement candidate changes only the compiled enable boolean;
its target, reviewer commitments and immutable seed snapshot remain pinned.
The deployment and acceptance checkpoints below distinguish preparation from
the live owner verification and signed handoff tests that still must pass.

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
fictional source key and explicitly verified existing reviewer commitments. Each
reviewer has `memberIdSha256 = SHA256(exact lowercase UUID)` and
`identitySha256 = SHA256(UUID + '|' + lowercase email)`, encoded as lowercase hex.
The email must already have no surrounding whitespace. These commitments hide
the raw account UUID/address from public source; they are not credentials and
never replace current authentication, invited/confirmed Identity verification
or active owner/HR membership checks.
The initial reviewed profile has verified target/database pins and reviewer
commitments with `enabled: false`. A separately reviewed enablement release can
change that boolean while preserving the seed's immutable snapshot and every
other pin. Runtime URL variables cannot replace these pins.

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
Its private `reviewer_ids` values remain exact UUIDs. The runtime hashes those IDs
to match the compiled ID commitments without consulting mutable email values.
Email/role revocation therefore invalidates the earlier reviewer while another
currently authorized HR reviewer can still queue a hold or revocation; it does
not turn the immutable marker into an unavailable database identity.

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
The seed selects exactly one existing active owner by both compiled hash pins;
it contains no raw owner UUID/email and does not create or grant membership.
Current server-side Identity verification is an independent prerequisite; a hash
match alone is not proof of current authorization. Public tests rehearse the
same template/control flow with explicit fictional hash substitutions. An exact
configured production seed must reject a local fictional owner whose hashes do
not match; positive local execution is not claimed for those production bytes.

Forward migration `20261028153655_hosted-synthetic-hash-pinned-seed` renders that
template using the exact production database and existing owner commitments
verified read-only on October 28. It records the hash of the reviewed disabled
profile bytes as audit provenance. Those exact LF bytes are retained permanently
in `docs/operator-migrations/20261028153655-hosted-seed-profile.json`, with SHA-256
`117a911b086c9b185b4975476f31129ef4c4f1fdb6b0affac67840f910d553c8`.
The audit binds this immutable snapshot, rather than every later runtime profile
serialization. Tests permit the runtime `enabled` boolean to change while every
other key, target, source, identity and reviewer pin must still match the snapshot.
Changed, missing or additional pins are rejected. Enabling the runtime must never
require editing an applied seed or changing its audit hash.

Native Identity detail and the active owner membership were matched; current
invited/confirmed Identity remains independently required by the server before
any decision. The seed inserts no observation, decision, outbox, staff, account or
permission. The seven earlier applied migrations remain unchanged. The CRM marker
identity names this immutable bridge scope, not a receiver's physical database
instance; replacing an EPDG instance does not replace the CRM marker UUID.

Disposable SQL fixtures use a compiled test-only operator-DML registry with exact
name, path, SHA-256, type and reason. Its current default contains only this seed.
Every registered file must exist and match its bytes; every unregistered
directory is applied normally, including similarly named directories. A future
receiver observation can be registered only after its actual capture and exact
reviewed file/hash exist. No observation or timestamp is fabricated for tests.
The registry returns each deferred SQL body and retains `seedSql` compatibility.
Comment-only fictional unit fixtures prove that additional exact entries still
reject missing or changed bytes; they are never accepted receiver observations.

A separate fresh loopback `netlifydb` rehearsal must reject the exact configured
seed without effects when only a fictional owner exists. Its positive control
substitutes only the two fictional reviewer commitments, preserving the actual
database/source/fixture guards and showing unchanged member rows and no decision
or receiver state. Narrow `.gitattributes` rules preserve the reviewed seed,
runtime profile and immutable profile snapshot LF bytes across checkouts.

Apply schema and the configured seed once through reviewed migrations, with the
hosted profile/runtime disabled. Verify the resulting marker, fixtures and exact
owner/target before a separately reviewed enablement release. The second release
may change only the runtime enablement boolean while preserving the immutable
snapshot and applied seed bytes. Receiver readiness and a fresh verified
observation remain independent gates; enabling the profile without an
observation authorizes no decisions. These setup steps have no short clock
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

## October 28 isolated disabled-seed preview

The integrated source at `404feba7bd36ca560a200b736767151748d28942` passed
GitHub quality run `40745960820`, 198 ordinary and 102 fresh SQL checks, followed
by 14 focused lifecycle unit and 26 focused SQL checks. The seven applied
migrations, published intake implementation and original local checkout were
preserved. The compiled education profile remains disabled.

The separately reviewed EPDG bootstrap at source
`f5f493d46ad151cf4ac8de67a95477c382110a04` completed its actual restricted
Supabase/TLS/managed-schema checks on October 28. This establishes bootstrap
preparation; it does not establish a running Supabase-backed API, receiver
acceptance or an HR decision window.

The next native Git preview may apply the exact forward seed only to the
isolated `codex/hosted-education-alignment-20261028` database branch. Verify its
four fixed HR fixtures, existing owner, immutable marker, audit provenance and
eight migrations while the profile is disabled. Independently verify production
still has its seven migrations and no education marker or fixture.

Production seed promotion remains held until the actual new API and synthetic
learning flow pass acceptance. Profile enablement, a real fresh receiver
observation and explicit signed decisions are subsequent steps. This preview
does not import Workspace data, grant access, activate a learner or send email.

## October 28 production seed and guarded enablement candidate

The isolated preview subsequently passed its exact-source native build, private
owner HR application load and read-only seed postflight. The repaired Supabase
receiver at source `62f0b09dbf74f0650005ee61de88e7d6cf7b5db2` passed the nine
initial learning checks and six guarded continuation checks, preserving its
existing mentor draft. Recovery, fixture restoration and independent source
review also passed. These results allowed the already authorized disabled seed
release to proceed.

Production deployment `6ae25841945d1dc981bcc5ae` published source
`e1456fcf5fcf7aa90d0084576ca582a9ea932f32` at 20:17:43 UTC. The platform reports
the exact eighth seed migration applied. Read-only operator queries confirmed
12 records, the same one active commercial owner, four synthetic HR fixtures,
and no decisions, outbox entries or local checkpoints. The limited-operator
postflight also verified all four exact fixture bindings and audit rows, the
immutable snapshot hash, all five enabled guard bindings, and absence of browser
grants. The supplied role was confirmed as `netlifydb_readonly`.

The operator connection is subject to row security on the hosted identity and
observation tables. Its zero visible rows do not establish that those tables
are empty. Netlify documents read-only production connection access for Developer
roles, unlike other branches. Preserve that boundary; do not replay the seed,
change grants or disable RLS to make an operator query pass. Full production
metadata acceptance still requires the normal owner application server path.

This candidate enables only the compiled boolean. Every other runtime pin,
the immutable disabled-profile snapshot, and all eight migration files remain
unchanged. Before any receiver capture or decision, verify the existing owner
session against the deployed profile. The normal `education-status` path checks
the exact marker and database guards, current invited/confirmed Identity, HR
authority and fixed source binding before requiring an initial observation.
Its expected missing-fresh-checkpoint response therefore verifies those prior
guards without recording a decision. A different error keeps the release held.

Local enablement validation passed typecheck, 201 ordinary tests, lint with zero
errors or warnings, and build; 103 opt-in SQL skips are reported separately.
These checks do not replace the pending production server verification, actual
fresh observation or signed roundtrip. Real Workspace imports, real learner
activation, external mail and privileged portal controls remain held.
