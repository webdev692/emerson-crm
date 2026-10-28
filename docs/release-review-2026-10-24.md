# Emerson CRM release review — October 24, 2026

The authorized two-user synthetic rehearsal passed on the repaired preview. The owner then separately authorized publication. Production deployment `6adcc1b33195872cc470df71` is ready, and live owner access and data separation passed. This supports a small owner-operated internal pilot; production staff access and real pricing remain separate decisions.

## Reviewed candidate

- Netlify task: `6adcb005c816800de1515e71`.
- Final preview: https://6adcb9273f868bf1babe48cf--emerson-crm.netlify.app.
- Database branch: `agent-6adcb005c816800de1515e71`, independently matched to the deployment before fixture writes.
- Remote platform state: ready, deploy-preview, unpublished; `server` and `crm` Functions present. Agent Runner metadata exposed no build ID or source commit SHA; none is inferred.
- Application fixes: clear protected detail/forms during reload and failed access; retry a partially completed CSV row without bypassing unrelated duplicates; clarify service-start date; require current proposal and matching work order before delivery acceptance.
- Local and remote tests: 66 passing in nine suites; type checking and relevant formatting passed. The earlier local client/SSR build passed before the server-only delivery repair; the repaired preview subsequently passed the platform pipeline.

## Live result

Owner and contributor independently completed private sign-in, refresh, logout, and fresh sign-in. Both retrieved the same opportunity UUID at S9, revision 11, with separate immutable V1/V2, one exact-V2 work order and a server-stamped accepted handoff. Contributor membership remained active with commercial authority off, private owner data was excluded, and administrative/commercial permission probes returned 403.

Missing stage prerequisites, unapproved V2 sending, premature S8/S9, old-proposal work orders/handoffs and missing matching work order were rejected. Negative delivery requests caused no new records or opportunity revision change. Sending an approved proposal before its future service-start date passed. H1/H2 discovery holds, normalized permanent suppression across a new organization and changed source ID, blocked outbound activity, import exclusions/deduplication, filtered formula-safe export and an actual concurrent stale-write 409 passed.

Logout cleared business records, staff identity and totals; the contributor's open detail closed. After refresh, each account's cookie-bearing read, empty JSON write and CSV requests returned 401. Fresh sign-in restored the same completed graph and expected permissions. Detailed provenance is in [verification.md](verification.md).

## Authorized production publication

The reviewed task's **Agent Runs → Publish** code-shipping workflow and its production confirmation were used after explicit approval. The preview deployment ID was not directly promoted. Netlify documents the supported [Agent shipping flow](https://docs.netlify.com/build/build-with-ai/agent-runners/make-changes-with-agent-runners/#5-ship-your-agent-run-updates) and the database-enabled project's [preview-publishing restriction](https://docs.netlify.com/build/data-and-storage/netlify-database/backup-and-recovery/#when-auto-publishing-is-locked).

Approval covered the tested application changes, normal publishing/build credits and production owner verification. No rehearsal rows were copied, database branch replaced, contributor production membership granted or real catalogue prices set. The separate [Data changes → Apply to production](https://docs.netlify.com/build/data-and-storage/netlify-database/data-changes/#apply-changes-to-production) operation was not used. No schema or migration changes were part of the patch.

Fresh platform metadata established production context, `main`, database branch `production`, source `2017b20dd09a89c113b822a17d92bff15f57b446`, build `6adcc1b33195872cc470df6f`, published at 14:33:52 UTC. Signed-out page/read/empty POST/CSV returned 200/401/401/401. Identity remained Invite only, email confirmation required, email sign-in enabled.

The owner privately signed in to https://emerson-crm.netlify.app. GET returned 200 with the exact configured account, role `owner`, active true and commercial true; Dashboard and Staff access loaded normally. Production contained eight original offer drafts and one owner membership, with all known rehearsal UUIDs and PILOT TEST titles absent. The preview contributor was not a production member. The owner GET can securely bootstrap the configured invited/confirmed owner if absent; no claim is made about whether membership already existed before that request. No production environment change, staff grant or database restore occurred. Full S1–S9 results remain attributed to the isolated preview rather than production.

## Recovery and practical limits

The project dashboard showed daily backups with 30-day retention and the 10 most recent on-publish backups. The October 19 backup was linked to the previous production baseline; October 20–23 scheduled backups and Restore controls were available. Full production access for personal access tokens remained off. No restore or security setting change was performed.

After publication, the dashboard also showed an on-publish backup linked to new production deployment `6adcc1b33195872cc470df71`. The isolated rehearsal branch remained listed. Neither backup was restored.

For a database incident, the owner should inspect **Database → Backups**, select the appropriate pre-incident backup and review all data that would be replaced before authorizing Restore. A code rollback leaves database contents intact. See Netlify's [backup and recovery procedure](https://docs.netlify.com/build/data-and-storage/netlify-database/backup-and-recovery/). Recovery was documented and available backups were observed; destructive recovery was not rehearsed. Preserve Netlify account recovery, invited Identity account recovery, and secure owner configuration separately. CSV contains permitted records rather than memberships, settings, audit, Identity accounts or secrets.

This remains a single-owner internal pilot. Real Project Studio pricing/terms await D3. Outreach is manually logged and no messages were sent by the rehearsal. S9 means accepted delivery responsibility, with no payment or revenue inference. The exact fresh migration-register query, complete live role matrix, a distinct authorized wrong-delivery-lead case, recovery-email delivery and broader concurrency/disaster-recovery exercises are not claimed. These limits are recorded in the backlog rather than disguised as completed tests.

The source ZIP is a local source snapshot with these post-rehearsal documents; it contains no database export or runtime secrets. It is not a claim that the documentation was separately deployed. A public Git repository has not been created.
