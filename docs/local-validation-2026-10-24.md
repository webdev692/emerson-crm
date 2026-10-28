# Local release candidate — October 24, 2026

This candidate starts from the source ZIP for published deployment
`6ad68a2282aaef83ccd6334c`. It has not been deployed or published.

## Changes

- Refreshing the workspace clears the selected record and protected dialogs.
  Failed authorization or loading also clears staff and calendar state. A record
  detail can no longer fall back to its previously loaded contents after a failed
  refresh. Authentication dialogs remain usable, and successful import refreshes
  retain mapping and results.
- A CSV row can retry after its organization was saved but its research write
  failed. The retry reuses only the organization with that row's exact source key.
  Completed source IDs and unrelated organizations with the same domain remain
  duplicate holds. Import stays busy until refresh finishes.
- The commercial field now reads **Effective date (service starts)**. The owner
  confirmed that an approved proposal may be sent before this service start date.
  No new restriction on future service dates was added.
- Local pnpm setup explicitly permits the locked esbuild and sharp setup scripts.
  The local package store is excluded from source control.

No API, schema, migration, production configuration, account, membership, business
record, pricing, or stage change was made.

## Validation

Dependencies were installed with the existing frozen lockfile. On this Windows
host the store was kept inside the project, packages were copied, and dependencies
were hoisted to avoid restricted directory symlinks. The install passed.

The bundled Node executable ran the repository's existing tools directly because
pnpm 11's automatic pre-run dependency verification attempted a default store
outside the project:

```text
node scripts/generate-routes.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node node_modules/vite/bin/vite.js build
node node_modules/prettier/bin/prettier.cjs --check src/workspace.tsx src/workspace.test.tsx src/lib/fields.ts pnpm-workspace.yaml
```

Route generation and TypeScript passed. All **60 tests in nine suites** passed.
The focused workspace suite passed **17 tests**, including 401/403/503 refresh
failures with an open detail, partial import failure/retry, and unrelated duplicate
protection. Formatting passed. The production client and SSR build passed, and the
Netlify adapter generated its SSR entry point.

These are local and mocked results. They do not establish live Identity,
PostgreSQL transaction behavior, database isolation, staff permissions, or a
successful platform deployment of this candidate.

## Preview blocker and next live gate

A bounded retry of the previously authorized preview failed after three seconds.
Its environment log (`6adcaccb7ba3878e30471f8d`) now exposes the cause: Netlify cloned
current `main`, then could not apply the old task's patch. Documentation hunks did
not apply; `identity-policy.mts` was already absent and the invitation contract
test already existed. This attempt did not reach an application build.

Use a fresh task based on the current published source, with the prepared patch,
after authorization for a replacement isolated preview/database branch. Verify
the new deployment-to-database mapping and migrations before any synthetic writes.
Do not treat a matching CLI alias as evidence of isolation. Do not repeat the old
task's redeploy or publish this candidate to production.

The live owner/contributor rehearsal remains pending: membership flags, the same
permitted record UUID across sessions, denied staff/commercial actions, S1–S9 and
commercial-version guards, suppression/import/conflict behavior, and clearing on
sign-out. Pricing decision D3 remains pending; S9 means accepted delivery
responsibility, not payment.
