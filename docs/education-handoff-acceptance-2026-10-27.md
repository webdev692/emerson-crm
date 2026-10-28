# Local CRM-to-EPDG acceptance — October 27, 2026

The local handoff is now exercised against the running synthetic EPDG receiver.
The reviewed EPDG migration 008 was applied on October 24 with every retained row,
table/function privilege and prior ledger entry preserved. The existing local
stack was restarted on October 27 after it was found stopped. No migration was
reapplied, production changed, Workspace data imported or billable Netlify run
started during this acceptance run.

## What passed

The opt-in `src/lib/education-live-handoff.test.ts` invoked the actual CRM handler,
used a freshly migrated local CRM PostgreSQL database and sent its persisted
outbox bytes to the existing receiver at `127.0.0.1:58000`. Existing private local
credentials stayed in process memory. The CRM Identity SDK was a synthetic test
adapter; active membership, HR authority, source binding, decisions and delivery
all used the real CRM server/database code. This is not a Netlify Identity login
or browser acceptance pass.

The operator checkpoint bound the retained receiver version 9 to its verified
local state without creating earlier CRM decisions. Six genuine new test reviews
produced versions 10–15. Every outbox event was acknowledged by the actual
receiver. Tests checked:

- Cleared, held, revoked, withdrawn and explicitly restored states, including a
  different currently authorized HR reviewer issuing revocation.
- Learner onboarding, dashboard and direct program reads opening only while
  cleared. Unrelated practice stayed available.
- Exact-body retries acknowledged as duplicates with fresh nonces and no extra
  CRM decision. Retrying the old cleared event after revocation returned the
  current withdrawn state and did not restore access.
- Withdrawal could not be cleared without an explicit restoration review.
- Seven actual receiver rejections: wrong/malformed HMAC, replayed nonce,
  changed-body event collision, stale decision version, browser Origin and
  forwarded headers. Each preserved the receiver state.

The final actual receiver was held at version 15 with managed access false.
Protected account/role/membership/enrollment hashes and immutable learning
evidence hashes were unchanged. Exactly one existing synthetic learner session
was used and signed out. The fresh CRM test cluster was stopped; its data/evidence
were retained. A separate read-only postflight verified all four existing EPDG
identities remained synthetic, the mapping was still pinned, migration 008 was
present and backend health returned HTTP 200.

Current regression results: 185 ordinary tests passed; all 53 opt-in cases passed
separately (52 fresh-database tests and one live multi-step scenario). The fresh
hosted-policy tests simulate a hosted policy against local SQL only. TypeScript,
ESLint and the local client/SSR build passed. No actual hosted bridge acceptance
is inferred from those tests. The local frontend was not running; learner checks
were HTTP API checks rather than a manual browser pass.

Evidence is under workspace
`build-evidence/emerson-crm-education-live/2026-10-27/`: `live-handoff.json`,
`live-run.json`, `cleanup.json`, `postflight.json`, regression receipts and the
independent review. October 24 receipts and source ZIPs remain historical and
unchanged. The latest local source includes the immutable receiver checkpoint;
the old 120-file ZIP is not the current source package.

## Remaining publishing gates

1. Verify the exact source revision, isolated hosted deployment/database and
   inherited-data boundary in a separately authorized preview. Local build success
   is not platform build/deployment evidence.
2. Keep the hosted bridge disabled until its exact HTTPS endpoint, database
   identity, key/audience/rotation, actor policy and person/application/program
   mapping are approved and tested. The compiled hosted profile is currently
   disabled. Do not convert this loopback fixture into a hosted integration by
   removing its guards or pointing it at a tunnel.
3. Run live invited/confirmed Identity owner, HR, non-HR and viewer checks in that
   isolated target, including stale authority, browser access, export filtering
   and sign-out. Confirm the matching EPDG learner/mentor behavior and closed
   privileged controls with synthetic records there.
4. Review forward migrations, retained-data proof, failure/retry handling,
   monitoring, secret provisioning and containment/forward repair. A queued hold
   alone does not revoke remote access; it needs successful delivery. There is
   no automatic Google Workspace freshness poll or automatic dispatch.
5. Obtain explicit publication approval. Real Workspace imports remain a separate
   approved batch with source freshness, field mapping, duplicate/consent/HR
   review and a verified real-data destination. This test authorizes no real
   learner activation, account creation, invitation or privileged access.
