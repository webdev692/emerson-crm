# Public source release — October 28, 2026

This source snapshot comes from reviewed CRM commit
`6ebfbeed806b3d7fd6986f1e50661c03159ca40b`. The private repository retains its
complete history. Historical handoff archives and private review evidence are
not included in this public snapshot.

Two files use reserved synthetic examples in place of historical owner account
identifiers: `docs/operator-migrations/hosted-fixture-seed.sql.template` and the
matching substitutions in `src/lib/education-hosted-postgres.test.ts`. Runtime
application code includes one additional reviewed security repair in
`netlify/functions/crm.mts`: protected writes reload current actor authority after
acquiring the shared write lock. This prevents a queued write from retaining
permissions that were revoked while it waited. Thirty additional SQL cases in
`src/lib/foundation-postgres.test.ts` cover queued revocations and permitted writes.
Other runtime code and all seven migration SQL/snapshot pairs retain their
reviewed content. The operator templates remain disabled and are not part of
automatic migration execution.

Two test-only paths were corrected in `src/test/local-postgres.ts` and
`src/lib/foundation-postgres.test.ts`: fresh SQL tests now load migrations from
the application being tested rather than another workspace checkout. The first
public-copy SQL attempt stopped when that older path encountered an unrelated
new migration in the other checkout; it did not contact a hosted database. Its
failed attempt and fresh-cluster shutdown evidence were retained privately.

No HR/applicant records, private imports, database exports, credentials or runtime
configuration are included. The hosted education bridge remains disabled with
null deployment/database pins and no reviewers. A public source repository does
not grant CRM access or activate EPDG learners or privileged controls.

Final local revalidation passed: 186 ordinary tests, 91 fresh synthetic SQL tests,
TypeScript, ESLint with zero errors or warnings, changed-file formatting and the
Vite client/SSR build. The ordinary suite used two workers after an earlier run
encountered worker startup timeouts. All seven migrations applied to four fresh
loopback databases, and all four stopped cleanly. Formatting changed only line
endings in the security repair; its LF-normalized bytes and TypeScript syntax
trees remained identical to the tested source. Hosted Identity, exact
database/deployment mapping, production migration results and browser acceptance
remain separate release evidence. The actual EPDG receiver was not contacted.
