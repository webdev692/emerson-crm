// Disposable test databases apply all schema migrations, deferring only these
// exact reviewed production DML bytes. A separate fresh netlifydb test proves
// their rejection and fictional-hash-substituted positive control flow.
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

export interface OperatorDmlMigration {
  readonly migration: string
  readonly path: string
  readonly sha256: string
  readonly type: 'seed' | 'receiver-observation'
  readonly reason: string
}

export const hostedSeedMigration = Object.freeze({
  migration: '20261028153655_hosted-synthetic-hash-pinned-seed',
  path: '20261028153655_hosted-synthetic-hash-pinned-seed/migration.sql',
  sha256: '511598562eeca74d8eed86690b6c99b1815485dda1f0e44c8ef7e587c59d737c',
  type: 'seed' as const,
  reason:
    'Exact production owner commitments; rejection and fictional-hash positive control exercised in fresh loopback netlifydb',
})

// Compiled test-only defaults. Add an actual observation only after its exact
// capture, review and SHA are known; an unregistered directory is never skipped.
export const reviewedOperatorDmlMigrations: readonly OperatorDmlMigration[] =
  Object.freeze([hostedSeedMigration])

export const hostedSeedProfileSnapshot = Object.freeze({
  path: 'docs/operator-migrations/20261028153655-hosted-seed-profile.json',
  sha256: '117a911b086c9b185b4975476f31129ef4c4f1fdb6b0affac67840f910d553c8',
})

// The seed audits these immutable disabled-profile bytes, not every future
// runtime serialization. Enablement may change only its boolean; all target,
// identity, source and reviewer pins remain exactly the reviewed snapshot.
export function assertHostedSeedProfileProvenance(
  seedSql: string,
  snapshotBytes: Uint8Array,
  runtimeProfile: unknown,
) {
  const snapshotSha256 = createHash('sha256')
    .update(snapshotBytes)
    .digest('hex')
  if (snapshotSha256 !== hostedSeedProfileSnapshot.sha256)
    throw new Error('Reviewed seed profile snapshot hash drift')
  const snapshot = JSON.parse(
    Buffer.from(snapshotBytes).toString('utf8'),
  ) as Record<string, unknown>
  if (
    !runtimeProfile ||
    typeof runtimeProfile !== 'object' ||
    Array.isArray(runtimeProfile)
  )
    throw new Error('Runtime seed profile pins changed')
  const { enabled: reviewedEnabled, ...reviewedPins } = snapshot
  const { enabled, ...runtimePins } = runtimeProfile as Record<string, unknown>
  if (
    reviewedEnabled !== false ||
    typeof enabled !== 'boolean' ||
    !isDeepStrictEqual(runtimePins, reviewedPins)
  )
    throw new Error('Runtime seed profile pins changed')
  if (!seedSql.includes(`compiled_profile_sha256 text := '${snapshotSha256}'`))
    throw new Error('Seed audit does not bind the reviewed profile snapshot')
  return snapshotSha256
}

export async function rehearsalMigrationPlan(
  root: string,
  registry: readonly OperatorDmlMigration[] = reviewedOperatorDmlMigrations,
) {
  if (
    registry.filter((entry) => entry.type === 'seed').length !== 1 ||
    new Set(registry.map((entry) => entry.migration)).size !==
      registry.length ||
    new Set(registry.map((entry) => entry.path)).size !== registry.length ||
    registry.some(
      (entry) =>
        !/^\d{14}_[a-z0-9_-]+$/.test(entry.migration) ||
        entry.path !== `${entry.migration}/migration.sql` ||
        !/^[0-9a-f]{64}$/.test(entry.sha256) ||
        !['seed', 'receiver-observation'].includes(entry.type) ||
        !entry.reason.trim(),
    )
  )
    throw new Error('Invalid exact operator DML registry')
  const all = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const schemaMigrations: string[] = []
  const operatorDmlSql: (OperatorDmlMigration & { sql: string })[] = []
  for (const migration of all) {
    const entry = registry.find((item) => item.migration === migration)
    if (!entry) {
      schemaMigrations.push(migration)
      continue
    }
    const bytes = await readFile(join(root, entry.path))
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
      throw new Error(
        'Reviewed operator DML hash drift; deferral is not authorized',
      )
    operatorDmlSql.push({ ...entry, sql: bytes.toString('utf8') })
  }
  if (operatorDmlSql.length !== registry.length)
    throw new Error('Reviewed operator DML migration is missing')
  const seedSql = operatorDmlSql.find((entry) => entry.type === 'seed')!.sql
  return {
    schemaMigrations,
    deferredOperatorDml: operatorDmlSql.map(
      ({ migration, path, sha256, type, reason }) => ({
        migration,
        path,
        sha256,
        type,
        reason,
      }),
    ),
    operatorDmlSql,
    seedSql,
  }
}
