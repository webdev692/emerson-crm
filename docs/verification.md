# Hosted synthetic education bridge candidate — October 27, 2026

The separate hosted education policy, strict fixed HTTPS transport and generated
immutable bridge-identity migration and append-only hosted receiver observations
are implemented locally. The compiled profile
remains disabled/unconfigured; no hosted settings, database, accounts, grants,
outbound delivery or deployment changed in this work. Existing default-local
guards and loopback protocol remain in force. See
[the hosted bridge guide](education-clearance-hosted-2026-10-27.md).

Fresh checks passed: 186 ordinary unit/UI cases and 61 separately opted-in SQL
cases across new loopback clusters: 15 hosted-policy, 27 default-local clearance,
15 foundation and four backend consumer-guard cases. This includes the five new
hosted observation groups for expiry/fresh append, monotonicity/future rejection,
guard/grant tampering, first-decision concurrency and disabled-template rehearsal.
The ordinary run skips 62 opt-in cases. The one live-receiver case deliberately
remains opted out because it uses the operating local EPDG configuration rather
than fresh-only test infrastructure; its historical result is not current hosted
acceptance. Full TypeScript checking, full lint, scoped formatting and the
client/SSR production build passed. No assertion, lint rule, auth gate or dependency policy was relaxed.
The real backend service and this CRM parser also passed their exact-seven-field
receipt cross-contract check in memory; it was not a hosted network delivery.

The two operator DML templates are outside auto-applied migrations, disabled and
unconfigured. They split the non-expiring fictional seed/marker from actual fresh
receiver observations. They contain no credentials, staff creation/grants or
assumed approval. A rehearsal substituted only explicit fictional pins in a
disposable SQL cluster; no production template was enabled or deployed. Applied
migrations remain unchanged. See the hosted guide for stale never-applied versus
already-applied observation handling.

Release-source review also corrected a queued foundation-write authority race.
After acquiring the shared lock, foundation writes now reload the current active
member with the same ID/email before any scope, HR, manager or owner decision.
Four real PostgreSQL queue regressions verify HR revocation, viewer demotion,
inactive membership and changed email while the request waits: every request is
denied without records or audit writes. Existing education Identity/reviewer
checks remain in place. The historical live test's negative-check helper is now
curated under `src/test/`; it reads no configuration/key and is not imported by
the production graph. The live operating-receiver scenario remains opted out.

Hosted policy requires actual Netlify site/production context, the current
invited/confirmed Identity account, exact existing HR reviewer binding, immutable
DB identity and explicit fictional source. Pending/failed outbox delivery is not
learner revocation until acknowledged. Configured hosted packaging, the actual
target/reviewer/database pins and end-to-end cloud/browser acceptance remain root
release gates. Owner/admin controls and real HR activation remain closed.

---

# Company foundation review candidate — October 24, 2026

The owner approved implementation of the HR-workspace audit's revised foundation. All 88 local baseline source files matched the released manifest before editing. The published baseline is deployment `6adcc1b33195872cc470df71`, source `2017b20dd09a89c113b822a17d92bff15f57b446`; its historical owner activation and bounded two-user sales rehearsal passed. Pending activation statements below describe earlier October 19 runs, not that published state.

The new local candidate adds Directory, distinct Workflows, Import review and Library screens; explicit HR access independent of sales management; a generated additive migration; transactional source review; immutable owner-approved resources; and approved-version learning assignments. See [foundation-build.md](foundation-build.md).

Local verification: 99 tests passed across 11 suites with the nine opt-in PostgreSQL cases skipped in the ordinary run. The isolated PostgreSQL run separately passed all nine cases, applying all three migrations to a fresh loopback-only cluster with mocked Identity/database factory. It verified real rollback, concurrent apply/revision conflicts, shared identity, duplicate decisions, HR JSON/CSV/audit/legacy denials, private applicant-organization provenance, library authority and old-identity suppression after change/reimport. Type checking and the production client/SSR build passed. New interface checks include restricted-dialog clearing on failed access refresh. Focused lint has 22 JSON/API `any` typing errors consistent with the existing envelope; whole-repository lint is not claimed clean. Ref lifecycle and Node-global findings were corrected.

No new live Identity session, platform preview build, production deployment, real workspace import, invitation, sharing change or external send occurred. Netlify CLI status stopped with `EPERM` opening its local configuration, before a remote deployment; no deployment log URL exists. Browser policy denied opening the offline local review file, so visual inspection is not claimed. The source candidate and synthetic offline review are local artifacts. Platform preview/database mapping, fresh owner/non-HR/HR/viewer sessions and subsequent authorized production rollout remain release gates.

---

# Invitation runtime fix — October 19, 2026, 21:01 UTC

The custom pre-creation validation hook was removed because it rejects authorized invitations before their invitation timestamp exists. Native Identity **Invite only** registration and **Required** email confirmation were preserved. CRM authentication, active membership, explicit permissions, and exact UUID/invited/confirmed server-side owner bootstrap were unchanged. No emails, accounts, roles, owner configuration, business records, schema or migrations were changed. Production was not published.

## Cause and evidence

The supplied production observation was an administrator invitation returning `422 Failed to handle signup webhook`, with `identity-policy` returning 401 at 20:54:21.528Z and two retries; first request ID `01M5AZ38JRK8QJYP8PG515PCKN`. A historical CLI log query for that function and deploy from 20:54–20:58 UTC independently returned three entries at 20:54:21.669Z, 20:54:22.343Z and 20:54:22.465Z. Those entries exposed neither a validation payload nor the reported HTTP status/request ID. The 401 correlation comes from the supplied observability evidence, not newly captured payloads.

The installed `@netlify/functions` 6.0.2 / `@netlify/types` 3.2.0 define `invitedAt` as optional and document `deny()` as returning 401. The runtime maps raw `invited_at` to camelCase `invitedAt` and registers `userValidate` as `identity_validate`; the existing handler matches that supported shape. Official event guidance says only the user ID is guaranteed at this lifecycle stage. No code evidence requires replacing callback authentication or field casing.

The official GoTrue source demonstrates the timing conflict: `Invite` calls `signupNewUser`, which triggers `ValidateEvent`; only afterward does `sendInvite` set `InvitedAt`, after the mailer succeeds. The old `if (!event.user.invitedAt) return event.deny()` necessarily rejects this supported invitation lifecycle. `hooks.go` retries non-2xx responses and returns the exact observed 422 message. This establishes a deliberate policy rejection for the documented lifecycle, rather than treating timestamp absence as a captured production payload. Callback authentication failure cannot be independently excluded for the historical requests without additional platform tracing; no such trace or personal payload was recorded.

Sources inspected on October 19:

- [Identity registration and invitations](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/registration-login/): Invite only rejects public registration and still permits administrator invitations.
- [Functions event lifecycle and denial](https://docs.netlify.com/build/functions/trigger-on-events/): optional lifecycle fields, typed handlers, and 401 denial behavior.
- Official GoTrue [invite.go](https://github.com/netlify/gotrue/blob/master/api/invite.go), [signup.go](https://github.com/netlify/gotrue/blob/master/api/signup.go), [mail.go](https://github.com/netlify/gotrue/blob/master/api/mail.go), [hooks.go](https://github.com/netlify/gotrue/blob/master/api/hooks.go), and [api.go](https://github.com/netlify/gotrue/blob/master/api/api.go): invitation ordering, webhook failure, public signup gate and administrator credential middleware. These are upstream source references, not a claim about the exact deployed GoTrue revision.

Removing the hook lets the native service authenticate administrators and enforce registration. No replacement public HTTP endpoint accepts invitation claims or trusts user metadata. Invitation timestamps remain required later by the separate CRM owner/staff checks, where persisted invited/confirmed accounts are looked up server-side. Existing browser `handleAuthCallback` / `acceptInvite` wiring and SDK 2.0.0 callback contract were inspected and retained.

## Commands and actual results

| Scope                          | Check                                                                                                                                                                                          | Result                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Local                          | `pnpm typecheck`                                                                                                                                                                               | PASS, exit 0                                                                                                               |
| Local                          | `pnpm test`                                                                                                                                                                                    | PASS, exit 0; 55 tests across 9 suites                                                                                     |
| Local contract                 | `src/lib/identity-invitation.test.ts`                                                                                                                                                          | PASS, 3 cases: no native/legacy custom validation registration; pre-invite timestamp absent; pre-invite timestamp empty    |
| Existing mocked security tests | Signed-out requests, missing/inactive membership, arbitrary Identity admin, verified owner success, mismatched/uninvited/unconfirmed owner, inactive owner preservation, contributor authority | PASS in full suite; not live Identity/Postgres evidence                                                                    |
| Existing mocked browser tests  | Invitation callback/password submission, confirmation/recovery SDK wiring                                                                                                                      | PASS in full suite; not private acceptance evidence                                                                        |
| Activation                     | Identity feature activation script                                                                                                                                                             | PASS; activation marker retained; no registration settings changed                                                         |
| Live production                | GET Identity settings                                                                                                                                                                          | PASS, 200; `disable_signup: true`, `autoconfirm: false`                                                                    |
| Live production                | Empty unauthenticated POST Identity signup                                                                                                                                                     | PASS, 403 `Signups not allowed for this instance`; no email/address/password supplied                                      |
| Live production                | Empty unauthenticated POST Identity invite                                                                                                                                                     | PASS, 401 `This endpoint requires a Bearer token`; no email supplied                                                       |
| Live production                | Signed-out GET `/api/crm`, same-origin empty JSON POST `/api/crm`, GET `/api/crm?export=csv`                                                                                                   | PASS, each 401                                                                                                             |
| Isolated authorized invitation | Administrator invitation succeeds through the service after hook removal                                                                                                                       | PENDING; no isolated Identity target/admin session available; no email sent or account created                             |
| Review deployment              | New URL, ID, platform build and resulting-deploy HTTP checks                                                                                                                                   | PENDING; platform creates/validates the review after this run; no callable review pipeline trigger or result was available |
| Private activation             | Acceptance, password setup, confirmation, owner membership                                                                                                                                     | PENDING; none observed; `CRM_OWNER_ID` remains unset per supplied evidence                                                 |

The new tests discover the actual deployable function exports and guard against reintroducing the validation veto or legacy filename hook. Their fixtures represent the official invitation lifecycle; they do not simulate native administrator authentication or prove a successful delivered invitation. Public signup and unauthenticated invitation rejection above are actual service requests. An authorized isolated invitation remains an explicit unpassed release gate.

## Deployment and approval boundary

A fresh filtered `getSite` lookup confirmed the published baseline remains **6ad68272d72d53c4e7e6ac61**, source **c81c84558c66e14a764026c9a1cdbd46f3cc1d66**, state **ready**, build **6ad68272d72d53c4e7e6ac5f**, database branch **production**. Public checks targeted https://emerson-crm.netlify.app; its immutable baseline URL is https://6ad68272d72d53c4e7e6ac61--emerson-crm.netlify.app. That existing build does **not** validate this change. No database was queried. Neither applied migration was edited.

The fix is left as source changes for the platform-managed review deployment, not production publication. New review URL/ID/build status cannot truthfully be supplied before that pipeline runs. Local build commands were not run because this environment reserves builds for the platform. Require the review build to pass, confirm `identity-policy` is absent from its function/event registration, repeat signed-out probes there, and verify native settings for the actual Identity target. Confirm isolated Identity and database targets before an authorized invitation test; a preview hostname alone does not prove isolation.

After review approval and an approved production rollout, the supervising assistant retries the already-authorized owner invitation. Lyric completes acceptance, password setup and confirmation privately. Only then may the separately authorized exact UUID configuration and existing verified bootstrap activate membership. No Identity admin role or email-based authority is required. Owner and limited-staff access remain unproven. Do not proceed to business-data rehearsal or claim production readiness from local tests.

---

# Historical activation checks (superseded by the invitation investigation above)

# Current activation/access check — October 19, 2026, 20:48 UTC

Owner and limited-staff access remain **pending, not demonstrated**. This pass inspected the existing bootstrap, staff controls, authentication callbacks and prior evidence, then refreshed live deployment, configuration and signed-out HTTP checks. No blocking application defect was demonstrated. Only documentation changed; no tests were added or rerun as a substitute for activation. No accounts, registration, configuration, permissions, records, approvals, schema, migrations or production publication were changed.

## Actual deployment and database context

The fresh platform lookup confirmed https://emerson-crm.netlify.app still publishes deployment `6ad68082945013df884a640f`, source commit `3c300f1eddbd7cca8a3d070112686aa387370118`, state `ready`, production context, build `6ad68082945013df884a640d`, published `2026-10-19T20:42:04.093Z`. Its immutable URL is https://6ad68082945013df884a640f--emerson-crm.netlify.app. The supplied independent review confirmed platform build completion; this run confirmed ready publication, without rerunning the build or inspecting its log.

Deployment metadata identifies database branch `production`. No authenticated database query occurred. **No exact isolated rehearsal URL/deployment/database branch has been verified.** The production URL is a check target, not a fixture destination. Historical preview checks below do not establish isolation for any current deployed URL. Both applied migrations were preserved.

## Fresh evidence

| Check                                                                                         | Status                    | Actual evidence                                                                                                                            |
| --------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Published deployment                                                                          | Completed                 | Filtered `getSite` response matched the deployment/source above                                                                            |
| Public page                                                                                   | Completed                 | GET `/` returned 200; no authenticated browser assertion                                                                                   |
| Signed-out read/write/export                                                                  | Completed                 | GET `/api/crm`, same-origin empty JSON POST `/api/crm`, GET `/api/crm?export=csv` each returned 401                                        |
| Identity enabled; confirmation required                                                       | Completed                 | GET `/.netlify/identity/settings` returned 200; email enabled, autoconfirm false                                                           |
| Invite-only prerequisite                                                                      | Failed                    | `disable_signup` false: registration remains Open                                                                                          |
| Owner configuration prerequisite                                                              | Failed / missing metadata | Filtered project/account `getEnvVars` lookup found no `CRM_OWNER_ID` key; this is configuration metadata, not runtime inspection           |
| Current Identity accounts                                                                     | Pending                   | Read-only platform Identity users request returned 401; zero users is historical, not a current finding                                    |
| Lyric sign-in, authorized load, owner/commercial membership                                   | Pending                   | No authorized browser session available                                                                                                    |
| Chosen confirmed contributor, active, commercial off                                          | Pending                   | No authorized sessions or permission-change authorization supplied                                                                         |
| Shared PILOT TEST ID across refresh and fresh sessions                                        | Pending                   | Isolated deployed database and authorized sessions unavailable; no fixture created                                                         |
| Contributor staff/commercial denial through UI and direct API; assignment grants no authority | Pending live              | Source enforces owner-only staff actions and explicit commercial authority before decision processing; source inspection is not live proof |
| Sign-out clears workspace data                                                                | Pending live              | Existing source clears records/staff/member and invalidates late responses; no authenticated browser execution                             |

No new typecheck/tests/build were run because no application fix was required. The previous deployment's reported typecheck and 52 tests across eight suites remain historical local/mocked evidence. Build commands are reserved for the platform; there is no new build result or review deployment URL to claim in this run.

## Short owner-run checklist

Administrative steps below require the owner's explicit authorization and private dashboard/session use; this run performed none. Do not send credentials, tokens, codes or invitation links to the assistant.

1. In Emerson CRM → Project configuration → Identity → Registration, authorize changing **Open** to **Invite only**, keeping confirmation required. Inspect Identity users privately; invite Lyric only if needed and explicitly authorized, then verify accepted invitation and email confirmation. Account status could not be checked here. An Identity `admin` role is unnecessary.
2. Privately configure the exact confirmed, invited Lyric Identity UUID as `CRM_OWNER_ID`, scoped to Functions/runtime for the intended context, then authorize a deployment that receives it. On that exact URL Lyric signs in and loads the workspace. **Expected:** GET `/api/crm` succeeds; Settings & staff → Staff access shows her UUID, `owner`, `Active`, and the commercial shield. Confirm response `member.role === "owner"`, `member.active === true`, `member.commercial === true` in the browser Network response. An existing inactive membership is not automatically reactivated.
3. Before fixtures, record the isolated preview's exact URL, deployment ID, source revision and actual database branch. Verify its database is separate from `production` and contains no real customer data. Do not infer isolation from the hostname or this runner's preview database. Verify Identity configuration for that target. With explicit authorization, choose one invited, accepted, confirmed staff account; Lyric grants `contributor`, Active checked, commercial unchecked. **Expected:** owner-side staff response shows role contributor, active true, commercial false; contributor's own `/api/crm` member confirms the same. Contributor staff listings omit commercial details, so do not use a missing shield alone as proof.
4. Only on that confirmed isolated target, create the minimum clearly named `PILOT TEST` shared record and assign it to the contributor or explicitly grant reader access. Capture its `records[].id` from `/api/crm` privately. Owner and contributor each refresh, sign out and sign back in using separate browser profiles. **Expected:** both retrieve the same permitted record and identical UUID in every session. Do not create an approval or production fixture.
5. As that contributor, Settings must offer no membership-saving form, and an assigned commercial draft must offer no commercial decision controls. In the contributor's own same-origin browser DevTools, run the following permission probes. **Expected:** both return 403, with respectively `Only the owner manages staff access.` and `Explicit commercial approval authority required.` The probes intentionally omit mutation fields; do not submit a real approval or edit real staff. Confirm the contributor remains commercial false after assignment.

   ```js
   for (const action of ['staff', 'decide']) {
     const response = await fetch('/api/crm', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ action }),
     })
     console.log(action, response.status, await response.json())
   }
   ```

6. Sign out in each profile. **Expected:** records, staff and totals disappear; refreshing does not restore them. In a signed-out session repeat GET `/api/crm`, empty same-origin JSON POST `/api/crm`, and GET `/api/crm?export=csv`; all must return 401. Record only URL/deployment/database context, statuses and pass/fail evidence; keep session material and customer information private.

## Publication advice and next gate

Do not publish production or declare real-data readiness from this pass. Setup prerequisites remain missing and authenticated access is unproven. There is no application fix to publish. Any owner-authorized configuration rollout needs separate deployment review and live activation checks; any future demonstrated blocking code fix needs typecheck, relevant tests and platform build validation on a review deployment before approval.

After the owner and limited-staff checks pass on a verified isolated deployment, the next bounded milestone is the isolated S1–S9 and commercial-version rehearsal, including renewed approvals after material changes, suppression, stale-write protection, auditability and formula-safe exports. Pricing remains pending D3, outreach is manually logged, and S9 denotes accepted delivery responsibility, never payment.

---

# Historical activation/access pass (superseded by current evidence above)

# Owner activation and limited-staff verification — October 19, 2026

This bounded pass added regression tests only; no demonstrated activation defect required application changes. No accounts, registration settings, roles, memberships, environment settings, records, schema, migrations, or production publication were changed. The full S1–S9 rehearsal was not started.

## Exact target and evidence

The checked-out baseline was `9077b3041cdf30122abe058389a1464b53ffa905`, matching the refreshed published deployment `6ad67364fd5cfeab2a6bdad3` at https://emerson-crm.netlify.app. Its immutable URL is https://6ad67364fd5cfeab2a6bdad3--emerson-crm.netlify.app. The platform reported `ready`, production context, branch `main`, build ID `6ad67364fd5cfeab2a6bdad1`, and publication at `2026-10-19T19:46:12.507Z`. The supplied independent baseline reported that build completed; this run independently confirmed the ready published deploy, not a new build log.

Deployment metadata identifies database branch `production`. **No authenticated database access or production data verification occurred.** No isolated deployed rehearsal database was confirmed. Earlier preview schema/count checks below are historical preview evidence only. Both applied migrations and the four-table schema were preserved unchanged.

Fresh public Identity settings returned 200: Identity enabled, email sign-in enabled, email auto-confirmation false, signup disabled false (**registration remains Open**). A filtered `getEnvVars` lookup for this project/account found no `CRM_OWNER_ID` key; no values were printed. This checks environment configuration metadata, not runtime activation. Current Identity user count and invitation/confirmation status were not independently retrieved; the earlier zero-user observation is not asserted as current. No authorized owner/contributor/non-member browser sessions or browser automation tool were available.

## Results by evidence type

| Evidence              | Check / command                                                                  | Result                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local static          | `pnpm typecheck`                                                                 | PASS (exit 0), includes Functions and generated routes                                                                                               |
| Local mocked / pure   | `pnpm test`                                                                      | PASS: 52 tests across 8 suites                                                                                                                       |
| Local mocked API      | Verified configured-owner bootstrap                                              | PASS: active owner, commercial true, returned in staff, no Identity admin role required; repeat request does not reinsert                            |
| Local mocked API      | Mismatched ID, uninvited, unconfirmed owner                                      | PASS: rejected, no membership insertion                                                                                                              |
| Local mocked API      | Existing inactive configured owner                                               | PASS: GET/POST/export denied; no lookup/bootstrap/reactivation                                                                                       |
| Local mocked API      | Contributor administration and assigned commercial approval                      | PASS: both return 403; assignment confers no commercial authority                                                                                    |
| Local jsdom           | Sign-out clearing and late refresh success/failure                               | PASS: signed-out state persists; late response cannot restore records/totals or replace notice with stale failure                                    |
| Live production HTTP  | GET `/`                                                                          | PASS: 200; initial HTML contains neither business totals evidence nor a live workspace assertion. Client-rendered interface was not browser-verified |
| Live production HTTP  | GET `/api/crm`, empty JSON POST `/api/crm`, GET `/api/crm?export=csv`            | PASS: each 401, same-origin POST header supplied; no authenticated session                                                                           |
| Live configuration    | Invite-only policy                                                               | FAIL / owner action: registration remains Open; confirmation required                                                                                |
| Live owner            | Invitation acceptance, sign-in, authorized load, active owner/commercial display | PENDING: owner setup and owner-operated authenticated session required                                                                               |
| Live contributor      | Active contributor, commercial off; shared stable ID after refresh/fresh session | PENDING: authorized accounts and confirmed isolated deployment/database required                                                                     |
| Live authorization    | Accepted non-member, contributor admin/approval denial through UI and API        | PENDING: no authorized sessions; local mocks do not prove deployed behavior                                                                          |
| Live inactive fixture | Inactive-member denial                                                           | PENDING: requires explicitly authorized disposable fixture; real staff were not altered                                                              |
| New review deployment | Build and signed-out guards on resulting deployment                              | PENDING: platform creates/validates review deployment after this run; no new URL/ID is available yet                                                 |

Build commands are prohibited in this run and reserved for the platform pipeline. `pnpm build` was not run. Existing production readiness does not validate the added tests or documentation. Publication is not recommended at this point: retain the changes for platform-created review deployment, inspect its build, and repeat the three signed-out API checks there before owner review. No production publication was performed.

## Changed files and remaining owner steps

- `src/lib/crm-api.test.ts`: filled missing positive bootstrap, mismatched/uninvited/unconfirmed rejection, idempotence, and inactive-owner preservation coverage. The mocked insert models the membership default and is not Postgres evidence.
- `src/workspace.test.tsx`: added late successful/failed refresh regression checks after sign-out; retained existing SDK callback and sign-out clearing checks.
- `docs/verification.md` and `docs/backlog.md`: separated this pass from historical results, recorded setup blockers and the bounded release gate.
- `.netlify/results.md`: standalone outcome for review. No runtime application code changed.

An authorized owner/platform administrator must perform the following in the dashboard; this run did not perform or authorize these changes:

1. In **Emerson CRM → Project configuration → Identity → Registration**, choose **Invite only**, retaining required email confirmation.
2. Inspect **Identity → Users** first. If necessary, invite Lyric at her explicitly chosen CRM email. She accepts the invitation on the CRM and sets her password privately. Verify invitation acceptance and confirmation; never substitute her Netlify platform login identity.
3. Copy the exact Identity user UUID into **Project configuration → Environment variables → CRM_OWNER_ID**, scoped to Functions/runtime and the intended deployment context. Keep the value private. Configuration changes and any production redeploy require separate explicit owner authorization. An Identity admin role is not required by bootstrap.
4. After an authorized deployment receives configuration, Lyric signs in, loads data, then checks **Settings → Staff access** for her active owner membership and commercial authority. An existing inactive membership is intentionally preserved; it cannot be repaired by bootstrap.
5. With separate authorization, use an invited, accepted, confirmed staff account. Owner grants active contributor membership with commercial authority unchecked. Keep Identity account, CRM role, authority and assignment separate.
6. Record the review deployment URL/ID and its actual database branch/isolation before creating a minimal `PILOT TEST` shared record. Verify the same stable ID after refresh, a fresh session and contributor sign-in. Exercise UI/direct API denials with authorized accounts; inactive denial only with an expressly authorized disposable fixture. Keep client data out of reports. Never share passwords, codes, tokens or invitation links in chat.

**Owner/limited-staff access is not proven.** Complete this activation/access gate first. The next bounded milestone after it passes is the isolated synthetic S1–S9 and commercial-version rehearsal, including renewed approval after material changes. S9 remains accepted delivery responsibility, not payment; Project Studio prices remain pending Founder Decision D3, and outreach logging sends no messages.

---

# Historical register from the prior pass

The following records the earlier pass, not current deployment or database verification.

# Pilot verification register

Verified on 2026-10-19. Local source checks and mocked tests below cover this change. Live HTTP checks cover the **previous published application**, not these edits. No real customer records, account invitations, commercial approvals, or outreach were created during this pass.

## Deployment and database evidence

A fresh `netlify api getSite` lookup (output restricted to deployment metadata) confirmed production https://emerson-crm.netlify.app published deployment **6ad6653eb79ab5ce623e8630**, ready, published 2026-10-19T18:45:39.556Z. Its version URL is https://6ad6653eb79ab5ce623e8630--emerson-crm.netlify.app. The production HTML returned 200 and reproduced the signed-out “Live workspace” defect. These fixes have not been verified on a newly published deploy; the platform creates and validates that deploy after this run.

`netlify db status` inspected the run's preview database branch: both `20261019183109_create_crm_foundation` and `20261019183745_add_record_relationships` were applied, with zero pending migrations. Both original SQL files and snapshots were preserved. Read-only schema inspection found the four CRM tables; the record count query returned eight offers and no other record kinds. This is preview database evidence, not an authenticated production data check. No schema changes or migrations were needed.

Public Identity settings returned 200: Identity enabled, email sign-in enabled, email auto-confirmation disabled, **public signup still enabled**. The signup validation handler also rejects accounts without an invitation, but registration must still be changed to Invite only. A filtered project environment API lookup found no `CRM_OWNER_ID` key. No setting values or account details were disclosed. Account acceptance/confirmation and staff availability could not be inspected without an authorized account session.

## Commands and results

The installed package manager is pnpm 10.30.3 on Node 22.23.3. The CLI is installed at `/opt/buildhome/node-deps/node_modules/.bin/netlify`; bare `netlify db status` initially failed because `netlify` was absent from PATH, then succeeded using that executable.

| Check / command                                                                                                                          | Result                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial `pnpm typecheck`                                                                                                                 | Failed: missing generated route tree, optional invitation token, implicit callback type, undefined calendar `records`. Fixed.                                                                                                                                       |
| Initial `pnpm test`                                                                                                                      | Failed: SSR suite could not import generated route tree; other five suites passed, 22 tests. Fixed route generation.                                                                                                                                                |
| `pnpm test src/lib/rules.test.ts`                                                                                                        | Passed: 11 tests for discovery precedence, weekend, holiday, DST, normalization and CSV safety.                                                                                                                                                                     |
| `pnpm test src/lib/crm-api.test.ts`                                                                                                      | Passed: 13 isolated API guard tests with mocked Identity/database. Initial test fixture failures were corrected; inaccessible selector values now return 403.                                                                                                       |
| Final `pnpm typecheck`                                                                                                                   | Passed, including `.mts` Functions (previously omitted). Route generation runs first without building.                                                                                                                                                              |
| Final `pnpm test`                                                                                                                        | Passed: 8 suites, 46 tests, including existing tests, workspace/SDK wiring, named inquiry creation, selectors and mocked API guards.                                                                                                                                |
| `pnpm exec prettier --check` on changed source/config/docs                                                                               | Passed: all checked files used Prettier style.                                                                                                                                                                                                                      |
| `pnpm build`                                                                                                                             | **Not run.** This environment explicitly prohibits all build commands; the platform performs build validation after the run. A previous ready deployment does not validate these changes.                                                                           |
| `netlify db status` using installed absolute CLI path                                                                                    | Passed: two applied, zero pending, no missing migrations reported.                                                                                                                                                                                                  |
| `netlify db connect --query "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name" --json` | Passed: crm_audit, crm_members, crm_records, crm_settings.                                                                                                                                                                                                          |
| `netlify db connect --query "SELECT kind, count(*)::int AS count FROM crm_records GROUP BY kind ORDER BY kind" --json`                   | Passed: eight draft offers only on preview branch.                                                                                                                                                                                                                  |
| Read-only information_schema column inspection                                                                                           | Passed: column names/types matched the current Drizzle schema across all four tables.                                                                                                                                                                               |
| `node /opt/buildhome/.agents/skills/netlify-identity/scripts/enable.cjs`                                                                 | Passed: Identity activation confirmed.                                                                                                                                                                                                                              |
| Physical browser / deployed authenticated tests                                                                                          | **Not run.** No browser tool or browser executable, authorized test account sessions, or verified isolated deployed rehearsal target was available. React Testing Library/jsdom tests ran instead; they do not exercise real emails, cookies, Identity or Postgres. |

Tests now generate the route tree using the installed TanStack generator before executing. Type checking does likewise. No build artifacts were generated.

## Critical workflow results

“Pending” means not exercised against deployed authenticated services. Mocked API tests do not prove database transaction isolation, actual Identity sessions or cross-user persistence.

| Workflow                                                                | Status                                        | Actual evidence / remaining dependency                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed-out production read, write, export                               | **Pass**                                      | Fresh native-fetch GET `/api/crm`, POST `/api/crm` with same-origin header, and GET `/api/crm?export=csv` each returned 401 with sign-in error.                                                                                                                   |
| Production signup policy                                                | **Fail / action required**                    | Public settings show signup enabled. Administrator must select Invite only. No registration attempt was made.                                                                                                                                                     |
| Signed-out, membership pending, loading, empty, populated and failed UI | **Pass locally; deploy pending**              | Workspace tests also exercised inquiry creation through named organization/contact/staff choices and hide business totals until successful authorized loading; failed requests show retry; refresh hides prior totals; sign-out clears state.                     |
| Sign-in, invitation, recovery, refresh, sign-out                        | **Pass mocked wiring; live pending**          | SDK login, acceptInvite, recovery request, recovery callback/updateUser, reload and logout exercised in jsdom. Actual invitation email, password setup, cookies, session refresh and recovery email require real invited accounts. No credentials were requested. |
| Owner activation                                                        | **Pending**                                   | Explicit configured UUID required. Mock rejects arbitrary Identity admin and unconfirmed/uninvited bootstrap. No configured owner key found; no owner session available.                                                                                          |
| A: Inquiry → S9 normal sale                                             | **Pending**                                   | Requires isolated deployed database plus verified owner and limited staff sessions. Searchable linked-record/staff selectors implemented; no live sale or synthetic approval recorded.                                                                            |
| B: Refresh, new session, second-user persistence                        | **Pending**                                   | Requires the same two sessions and isolated test records. UI reload test is mocked, not persistence evidence.                                                                                                                                                     |
| C: Non-member/inactive/viewer/contributor boundaries                    | **Pass mocked guards; live pending**          | Non-member/inactive requests rejected; viewer writes blocked; contributor cannot edit inaccessible records, manage staff or approve an assigned proposal. Signed-out checks also passed live.                                                                     |
| D: Cumulative stage rules and immutable versions                        | **Pass selected mocked guards; live pending** | New S9 rejected; S1→S7 and unchanged S7 without acknowledgment rejected; immutable proposal edit rejected. Rubric precedence passed pure tests. Full approval/version renewal, H1/H2 and accepted S9 require live rehearsal.                                      |
| E: No-contact/import                                                    | **Partial local pass; live pending**          | Normalization and suppressed outbound activity guard passed. Opt-out write, equivalent-detail re-import, duplicate/invalid/blank/EXAMPLE files and saved batch summary not exercised live.                                                                        |
| F: Concurrent changes                                                   | **Partial local pass; live pending**          | Stale revision returns 409 in mock. Simultaneous Postgres writes, advisory-lock behavior and duplicate-sensitive races not exercised.                                                                                                                             |
| G: Export                                                               | **Pass selected mocked checks; live pending** | Mock viewer export filters restricted record, retains stable record/parent IDs and neutralizes a formula title. Actual owner/staff exports, complete linked graph and spreadsheet opening pending.                                                                |
| Database compatibility/history                                          | **Pass for inspected preview branch**         | Applied history preserved; no schema changes; supported pinned Drizzle beta adapter retained. Production DB was not directly queried.                                                                                                                             |
| Platform build of this revision                                         | **Pending**                                   | Reserved for post-run platform validation.                                                                                                                                                                                                                        |

## Owner and staff setup checklist

1. Open **Netlify → Emerson CRM → Project configuration → Identity → Registration** and choose **Invite only**. Confirm email confirmation remains required. Identity itself is already enabled.
2. Open **Identity → Invite users**, invite Lyric's chosen real email, and have her accept the invitation at the CRM, set her own password and confirm the account. In **Identity → Users → her account**, verify accepted/confirmed status and copy the **Identity user UUID**. Do not use a platform user, team or project ID. No account UUID or email is assumed here.
3. The bootstrap does **not** check for an Identity `admin` role. Server-side `admin.getUser` uses Netlify's Functions operator context, not Lyric's role. A platform administrator may maintain an Identity administrator separately; assigning that role alone never creates CRM access. This corrects the previous README's mandatory-admin-role instruction.
4. Open **Project configuration → Environment variables → Add variable**. Key: `CRM_OWNER_ID`; value: Lyric's exact verified Identity UUID from step 2. Scope it to **Functions/runtime**, including **Production** and the **Deploy Preview** context used for rehearsal. Keep the value out of source and browser-prefixed variables. Save, trigger a fresh deployment and confirm it succeeds. Do not set it to a test user's UUID merely to bypass owner verification.
5. Lyric signs in again on that deployment and refreshes. Confirm **Settings → Staff access** shows her active **owner** membership and explicit commercial authority. Existing inactive memberships are never reactivated by bootstrap; an existing owner administrator must restore them through staff management.
6. Invite the rehearsal staff member through **Identity → Invite users** and have them accept/confirm. Lyric then uses **CRM Settings → Staff access** to grant that verified account **contributor**, active, commercial authority unchecked. This administrative setup screen still uses the verified Identity UUID; daily sales forms use selectors. For delivery acceptance, grant the appropriate delivery role to a designated invited account (or designate Lyric as delivery lead). Assignment does not grant commercial authority.

## Isolated two-user rehearsal still required

Use a deploy preview with its own database branch and only `PILOT TEST` synthetic records. Verify the deployment context and account access before adding fixtures. Preview databases can begin as a copy of production; never export or expose unrelated production data during tests. Do not create synthetic approvals in production. Outreach remains a manual activity log and sends no message.

- **A:** Create organization/contact, inquiry at S1 with consent/source/next action/due date; assign responsibility and reader access. Log actual acknowledgment → S2; book discovery → S3; document held discovery → S4; all five criteria Met → S5. Obtain catalogue/client-specific decisions as required, record recommendation and capacity reviewer/evidence → S6. Create immutable proposal version, approve that exact revision, log that exact proposal as manually sent → S7. Record written acceptance, confirm capacity, designate delivery lead, issue linked work order → S8. Sign in as designated lead and accept linked handoff, then advance to S9. Assert no payment or revenue is implied. Real Project Studio prices stay pending D3; test prices/approvals belong only to the isolated test branch.
- **B/C:** Refresh and start a fresh session; retrieve the same record IDs/links as both authorized users. Through UI and direct API requests verify signed-out, accepted non-member, inactive, viewer and contributor boundaries. Contributors cannot grant reader access, assign other staff or approve their own assigned opportunity's commercial terms. An unrelated staff member must not retrieve or change restricted records or submit a forged selector ID.
- **D:** Attempt direct creation at S9 and cumulative bypasses on every later stage, including unchanged stage saves. Run regulated-need H1 and uncertain H2 discovery. Attempt editing an approved proposal; create a new version and confirm previous approval does not authorize it. Reject S9 before delivery acceptance, wrong lead, wrong proposal and missing work order.
- **E:** Record opt-out; re-import equivalent normalized email, phone/domain and changed source IDs; confirm permanent suppression and blocked outbound logging. Import duplicate, invalid, blank numbered and EXAMPLE rows; compare preview counts, persisted research counts and the saved import summary. Retry same source IDs and verify no duplicate records.
- **F:** Edit the same revision in two sessions; save one, then require visible 409 on the other. Send simultaneous duplicate source/version/work-order/handoff requests and verify exactly one allowed write and clear duplicate/conflict feedback.
- **G:** Export as owner and limited staff. Compare permitted rows, stable UUIDs, organization/parent links and JSON payloads; check formula-leading values in a spreadsheet. Export contains readable CRM records only: it excludes membership, settings and the separate audit table. A filtered extract may contain links whose target is outside that user's access; it is not guaranteed to be a complete recovery graph. No full relational CSV restore is implemented. Recovery needs authorized managed database backup/restore and Identity/configuration recovery procedures.

Recommendation: complete deployment validation and account setup, then begin a supervised synthetic rehearsal. A real-data internal pilot remains gated on the live A–G checks, especially normal S9 completion, two-user permissions, persistence and concurrent writes.

## Current results — October 24, 2026

This dated section supersedes the historical activation and rehearsal blockers above. All new fixtures, commercial decisions and membership grants were confined to the authorized isolated branch `agent-6adcb005c816800de1515e71`; no real customer records or outreach were involved. Production was not published or changed during this rehearsal.

The final reviewed preview is deployment `6adcb9273f868bf1babe48cf`, ready with `crm` and `server` Functions:

- Immutable URL: https://6adcb9273f868bf1babe48cf--emerson-crm.netlify.app
- Branch alias: https://agent-6adcb005c816800de1515e71--emerson-crm.netlify.app
- Platform metadata and the dashboard confirmed the exact isolated database branch above. Source migrations were preserved. A fresh migration-register query was **not obtained**; schema reads, catalogue seeds and successful live operations do not substitute for that query.

Local and remote validation passed **66 tests across nine suites** and type checking. The initial local client/SSR build passed before the server-only delivery repair; the latest remote deployment pipeline subsequently produced the ready repaired preview. These results have separate provenance and are not a claim that the final local build was rerun.

| Live check                     | October 24 result                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner and contributor          | Owner freshly authenticated on the final immutable deployment: `owner`, active and commercial true. Accepted staff authenticated as active contributor with commercial false; no Identity admin role was required.                                                                                                                                                                |
| Shared data and privacy        | Both users retrieved the same completed S9 record UUID and matching V2/work-order/handoff graph. Contributor responses and CSV omitted private owner records and staff emails. Refresh persistence passed.                                                                                                                                                                        |
| Permission boundaries          | Contributor staff/settings/audit changes, reassignment, reader grants and approval of an assigned proposal each returned 403. Assignment conferred no commercial authority.                                                                                                                                                                                                       |
| S1–S9                          | Staff completed acknowledgment, discovery, five-criterion qualification, founder review and proposal sending. Missing acknowledgment/assessment and premature S7/S8/S9 attempts were rejected. Exact V2 work order and designated owner's delivery acceptance enabled S9; no payment or revenue was inferred. Separate H1/H2 assessments and hold saves passed.                   |
| Commercial versions            | Approved V1 edit returned 400; separate V2 did not inherit approval. Unapproved V2 sending and S7 returned 400 until owner approval. Sending before the future service-start date passed, consistent with the owner's clarified meaning of effective date. Original V1 remained unchanged.                                                                                        |
| Delivery integrity             | Old approved V1 work-order/handoff requests and V2 handoff without a matching work order returned 400 without record/revision changes. Correct V2 work order/handoff succeeded; repeated work-order creation was blocked.                                                                                                                                                         |
| Suppression and imports        | Immutable normalized-domain opt-out remained active after attempted flag clearing, a new organization and a changed source ID; outbound logging was blocked despite previous outreach approval. CSV import persisted one valid row, held duplicate IDs, skipped blank/EXAMPLE rows, excluded an invalid date and prevented same-source reimport.                                  |
| Conflicts and export           | Actual Postgres writes from one revision produced one success and one 409, preserving the winning value. Owner and contributor exports returned 200 with permitted IDs; the owner export escaped a formula-leading value. Wider simultaneous duplicate/membership/decision races remain outside this pass.                                                                        |
| Owner and contributor sign-out | Both accounts cleared workspace data, staff identity and business totals; contributor logout also cleared an open detail. Refresh retained the signed-out state; credentialed read, empty same-origin POST and CSV each returned 401. Both then signed in privately again and retrieved the same completed S9 opportunity, V2 and delivery links with their expected permissions. |

Fresh owner and contributor sessions passed after logout on the final deployment and its verified alias. Distinct authorized delivery-user/wrong-assigned-lead behavior was not exercised live: the designated owner accepted this handoff, and assigned delivery-role success is covered by local mocked tests. No additional Identity account was authorized. Recovery-email delivery, complete role-matrix coverage and full disaster recovery are not implied by these passes.

The pilot currently has one owner. Before real-data rollout, identify and verify the administrator's supported managed-database backup/branch-restore procedure for records, memberships, settings and audit. Identity accounts and secure environment configuration need their own recovery plan. CSV is a permission-filtered record extract, not a database, Identity or configuration backup. Production publication and production contributor membership require a separate authorized rollout; preview success alone grants neither. Real Project Studio prices remain pending D3, and outreach remains manually logged.

Detailed nonsecret receipts are retained in the supervising workspace under `build-evidence/emerson-crm-supervision/2026-10-24/`, including `live-completed-graph-both-users.json`, `live-delivery-integrity-gates.json`, `live-permanent-normalized-suppression.json`, `live-owner-signout.json` and `live-staff-signout.json`. They contain statuses and synthetic identifiers rather than session credentials.

### Authorized production publication — October 24, 14:33 UTC

Following separate explicit owner approval, the reviewed task's native Publish workflow produced ready deployment `6adcc1b33195872cc470df71`, source `2017b20dd09a89c113b822a17d92bff15f57b446`, build `6adcc1b33195872cc470df6f`, production context on `main` and database branch `production`. No preview rows were applied to production; no schema, environment configuration, staff grant or database restore was performed.

Fresh public production checks returned page 200 and signed-out read/empty POST/CSV 401. Identity remained Invite only with required confirmation and email sign-in. The owner's private production sign-in returned GET 200, exact account UUID, active owner and commercial true; Dashboard and Staff access loaded. Production contained eight original offer drafts and one owner membership; known rehearsal UUIDs, PILOT TEST titles and the preview contributor membership were absent. The owner GET may securely bootstrap the configured invited/confirmed owner if absent; pre-GET membership existence is not inferred.

Managed backup availability and the documented recovery procedure were inspected: daily backups with 30-day retention, ten most recent publication backups and Restore controls. No restore test was executed. A small owner-operated internal pilot is supported by these results. Production contributor access, real D3 pricing/terms and the stated broader hardening gaps remain. See [release-review-2026-10-24.md](release-review-2026-10-24.md). Full two-user S1–S9 evidence above remains preview evidence.
