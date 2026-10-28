# Synthetic website intake review bridge

This feature is default-off and preview-only. It transfers fictional website
inquiries into the existing CRM intake review queue under the signed-in owner's
or manager's current membership. It never creates a contact, application,
permission, account, enrollment or message. Test rows cannot be applied.

The producer is a separate Supabase Edge function and three new tables/RPCs.
The existing `send-consultation-email` function and its five migrations remain
unchanged. There is no mail library, notification callback or email transport in
the new producer.

## Contract

- Project: `gqlyofoazfkumirhbnmc` (legacy company website intake, not EPDG).
- External function base:
  `https://gqlyofoazfkumirhbnmc.supabase.co/functions/v1/website-intake-synthetic`.
- Public POST `/capture`: exact configured preview Origin, JSON up to 4096 bytes,
  exact six-field synthetic schema and at most 20 new receipts per database
  minute. The only email shape accepted is
  `pilot-<fictional-slug>@intake.invalid`. Names begin `PILOT TEST`; resources
  begin `PILOT-`. HR/application workflows and arbitrary narrative/resume fields
  are rejected. Browser Origin is a synthetic gate, not authentication.
  After the exact capture route and Origin pass validation, capture errors retain
  that exact Origin's CORS headers so the preview can read validation, collision
  and throttle statuses. Foreign origins and private pull/ack errors receive no
  CORS headers; private errors do not fabricate a response signature.
- Private POST `/pull` and `/ack`: independent 32-byte HMAC key, exact canonical
  public URL/project/audience/body hash, timestamp within 120 seconds and UUIDv4
  nonce. Every accepted nonce is stored atomically; replay is rejected.
- Supabase may strip `/functions/v1` before invoking the handler. Only the exact
  function-name-prefixed runtime paths and bounded project/internal runtime
  hosts normalize to the fixed compiled public signing URL. No forwarded host
  or protocol header is trusted. Unknown paths/hosts/query strings are rejected.
  Actual hosted routing remains an acceptance gate after deployment.
- Signed responses bind status, body digest and the originating request nonce.
  CRM rejects redirects, unknown event fields and unverified payload digests.
- Caller-generated event UUID and canonical six-field payload hash are immutable.
  Same UUID/content returns the same receipt; a collision returns 409. PostgreSQL
  independently recomputes the canonical SHA-256 before accepting storage.
- The current CRM member is checked before fetch, again under the existing queue
  transaction lock, and before acknowledgment. No synthetic/fake staff actor is
  used. Separate workflow batches may commit before a later step fails; no source
  events are acknowledged until every queue batch has committed successfully.
- A failed acknowledgment reports committed rows and requests a safe retry.
  The next fetch returns the same source IDs; the existing queue deduplicates
  them. Exclusion remains a deliberate human decision with the real actor audit.

The new events table grants the service role SELECT, INSERT and UPDATE of only
`acknowledged_at`; DELETE, TRUNCATE, TRIGGER and broad UPDATE are explicitly
removed even when Supabase-style default ACLs previously granted them. Rate and
nonce cleanup tables have specifically required DELETE. Browser roles have no
table/RPC access. All three tables use RLS with no browser policies. No legacy
table grant or global default privilege is changed.

## Runtime configuration

Root must provision one newly generated independent key privately to only these
two destinations after review and exact preview/database verification:

| Destination                                         | Variables                                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase function secrets, old company project only | `WEBSITE_INTAKE_MODE=synthetic-preview`, `WEBSITE_INTAKE_PREVIEW_ORIGIN=<exact HTTPS preview origin>`, `WEBSITE_INTAKE_HMAC_KEY=<43-character base64url encoding of 32 random bytes>` |
| Netlify Functions, exact CRM branch context only    | `CRM_WEBSITE_INTAKE_MODE=synthetic-preview`, `CRM_WEBSITE_INTAKE_PREVIEW_ORIGIN=<that CRM preview origin>`, `CRM_WEBSITE_INTAKE_HMAC_KEY=<same independent key>`                      |

Supabase's existing service-role key remains solely inside Supabase. Never copy
it into CRM, a browser, Git, a test fixture or an artifact. The signing key is not
an account or user credential. Do not output either key or command arguments
containing a key.

CRM additionally requires an unpublished `branch-deploy` or `deploy-preview`
context and the exact configured CRM preview origin. Its real production origin
cannot satisfy this gate. The fetch button appears only when this gate is true
and the viewer is an owner/manager. This is not a production form transport;
held company forms and editable mail drafts remain unchanged.

## Local verification

Ordinary unit/UI tests run through `pnpm test`. The SQL acceptance suite is
explicitly opt-in on Windows:

```powershell
$env:CRM_WEBSITE_INTAKE_POSTGRES_TEST='1'
pnpm exec vitest run src/lib/website-intake-postgres.test.ts --maxWorkers=1
```

It creates and stops a new random-port loopback-only PostgreSQL cluster using
the bundled workspace harness. It never reads a hosted connection, operational
key or real Identity session. It runs the actual CRM handler, current-actor queue
transactions, producer handler and migration RPCs. Private HTTP transport is
injected to invoke the same producer handler locally; it is not hosted proof.
The fixtures in `src/test/website-intake` are the reviewed producer/migration
snapshot, not production application entry points. Their protocol is checked
against the CRM signing module. Linux CI intentionally skips the Windows SQL
suites; its ordinary quality gate uses Node 22.23.1 and frozen pnpm 11.25.0.

Before any hosted acceptance, review and merge the exact producer/migration,
verify the new database objects and unchanged legacy grants, pin an isolated CRM
database branch and owner session, provision only the private destinations above,
and rebuild that exact preview. Then submit only a fictional capture from the
pinned preview, fetch it through Import review, verify one `test` row, exact retry,
apply denial and deliberate exclusion. Record receipt/status/counts only. Do not
invoke the legacy notification endpoint. A passing hosted test will not authorize
real addresses, real Workspace imports or production form activation.
