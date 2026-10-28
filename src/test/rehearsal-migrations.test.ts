// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertHostedSeedProfileProvenance,
  hostedSeedMigration,
  hostedSeedProfileSnapshot,
  rehearsalMigrationPlan,
  reviewedOperatorDmlMigrations,
  type OperatorDmlMigration,
} from './rehearsal-migrations'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true })),
  )
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'crm-reviewed-migrations-'))
  temporary.push(root)
  const seed = await readFile(
    fileURLToPath(
      new URL(
        `../../netlify/database/migrations/${hostedSeedMigration.path}`,
        import.meta.url,
      ),
    ),
  )
  await mkdir(join(root, hostedSeedMigration.migration))
  await writeFile(join(root, hostedSeedMigration.path), seed)
  return { root, seed }
}
async function profileInputs() {
  const bytes = await readFile(
    fileURLToPath(
      new URL(`../../${hostedSeedProfileSnapshot.path}`, import.meta.url),
    ),
  )
  const runtime = JSON.parse(
    await readFile(
      fileURLToPath(
        new URL(
          '../../netlify/functions/lib/education-hosted-profile.json',
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  ) as Record<string, unknown>
  return { bytes, runtime }
}
describe('exact reviewed operator DML deferral for disposable SQL fixtures', () => {
  it('defers only the one exact reviewed seed and applies all other migration names', async () => {
    const { root, seed } = await fixture()
    const ordinary = [
      '20260101000000_schema',
      '20260102000000_other_hosted_seed',
    ]
    for (const name of ordinary) await mkdir(join(root, name))
    const plan = await rehearsalMigrationPlan(root)
    expect(plan.schemaMigrations).toEqual(ordinary)
    expect(plan.deferredOperatorDml).toEqual([hostedSeedMigration])
    expect(plan.seedSql).toBe(seed.toString('utf8'))
    expect(plan.operatorDmlSql).toEqual([
      { ...hostedSeedMigration, sql: seed.toString('utf8') },
    ])
    const { bytes, runtime } = await profileInputs()
    expect(bytes.includes('\r\n')).toBe(false)
    expect(
      assertHostedSeedProfileProvenance(plan.seedSql, bytes, runtime),
    ).toBe(hostedSeedProfileSnapshot.sha256)
  })
  it('rejects missing or changed seed bytes rather than broadening the deferral', async () => {
    const { root, seed } = await fixture()
    await writeFile(
      join(root, hostedSeedMigration.path),
      Buffer.concat([seed, Buffer.from('\n')]),
    )
    await expect(rehearsalMigrationPlan(root)).rejects.toThrow('hash drift')
    await rm(join(root, hostedSeedMigration.migration), { recursive: true })
    await expect(rehearsalMigrationPlan(root)).rejects.toThrow('missing')
  })
  it('permits only a boolean enabled transition while preserving immutable seed audit bytes and every other profile pin', async () => {
    const { seed } = await fixture()
    const { bytes, runtime } = await profileInputs()
    const sql = seed.toString('utf8')
    for (const enabled of [false, true])
      expect(() =>
        assertHostedSeedProfileProvenance(sql, bytes, { ...runtime, enabled }),
      ).not.toThrow()
    expect(createHash('sha256').update(seed).digest('hex')).toBe(
      hostedSeedMigration.sha256,
    )
    expect(JSON.parse(bytes.toString('utf8')).enabled).toBe(false)
    for (const key of Object.keys(runtime).filter((key) => key !== 'enabled')) {
      const changed = { ...runtime, [key]: null }
      expect(() =>
        assertHostedSeedProfileProvenance(sql, bytes, changed),
      ).toThrow('pins changed')
    }
    const reviewers = runtime.reviewers as Record<string, unknown>[]
    for (const key of ['memberIdSha256', 'identitySha256'])
      expect(() =>
        assertHostedSeedProfileProvenance(sql, bytes, {
          ...runtime,
          reviewers: [{ ...reviewers[0], [key]: 'b'.repeat(64) }],
        }),
      ).toThrow('pins changed')
    for (const enabled of [null, 'true', 0, undefined])
      expect(() =>
        assertHostedSeedProfileProvenance(sql, bytes, { ...runtime, enabled }),
      ).toThrow('pins changed')
    expect(() =>
      assertHostedSeedProfileProvenance(sql, bytes, {
        ...runtime,
        extraPin: 'unreviewed',
      }),
    ).toThrow('pins changed')
    const missing = { ...runtime }
    delete missing.fixtureSourceKey
    expect(() =>
      assertHostedSeedProfileProvenance(sql, bytes, missing),
    ).toThrow('pins changed')
    expect(() =>
      assertHostedSeedProfileProvenance(
        sql,
        Buffer.concat([bytes, Buffer.from('\n')]),
        runtime,
      ),
    ).toThrow('snapshot hash drift')
    expect(() =>
      assertHostedSeedProfileProvenance(
        sql.replace(hostedSeedProfileSnapshot.sha256, 'a'.repeat(64)),
        bytes,
        runtime,
      ),
    ).toThrow('does not bind')
  })
  it('defers an additional exact fictional registry fixture only, rejecting its missing or changed bytes', async () => {
    const { root, seed } = await fixture()
    const fixtureSql =
      '-- FICTIONAL registry fixture only; never an actual observation.\n'
    const name = '20000101000000_fixture_operator_note'
    const entry: OperatorDmlMigration = {
      migration: name,
      path: `${name}/migration.sql`,
      sha256: createHash('sha256').update(fixtureSql).digest('hex'),
      type: 'receiver-observation',
      reason: 'Fictional comment-only unit fixture; not provider evidence',
    }
    await mkdir(join(root, name))
    await writeFile(join(root, entry.path), fixtureSql)
    const unrelated = '20000102000000_fixture_observation_unregistered'
    await mkdir(join(root, unrelated))
    const registry = [...reviewedOperatorDmlMigrations, entry]
    const plan = await rehearsalMigrationPlan(root, registry)
    expect(plan.schemaMigrations).toEqual([unrelated])
    expect(plan.deferredOperatorDml).toEqual([entry, hostedSeedMigration])
    expect(plan.operatorDmlSql).toEqual([
      { ...entry, sql: fixtureSql },
      { ...hostedSeedMigration, sql: seed.toString('utf8') },
    ])
    expect(plan.seedSql).toBe(seed.toString('utf8'))
    await writeFile(join(root, entry.path), fixtureSql + ' ')
    await expect(rehearsalMigrationPlan(root, registry)).rejects.toThrow(
      'hash drift',
    )
    await rm(join(root, name), { recursive: true })
    await expect(rehearsalMigrationPlan(root, registry)).rejects.toThrow(
      'missing',
    )
  })
  it('rejects invalid or ambiguous registries rather than allowing path, name or hash wildcards', async () => {
    const { root } = await fixture()
    const invalid: readonly OperatorDmlMigration[][] = [
      [hostedSeedMigration, hostedSeedMigration],
      [{ ...hostedSeedMigration, path: '../unreviewed/migration.sql' }],
      [{ ...hostedSeedMigration, migration: '20261028153655_hosted-*' }],
      [{ ...hostedSeedMigration, sha256: 'A'.repeat(64) }],
      [{ ...hostedSeedMigration, reason: '' }],
      [
        {
          ...hostedSeedMigration,
          type: 'unknown' as OperatorDmlMigration['type'],
        },
      ],
    ]
    for (const registry of invalid)
      await expect(rehearsalMigrationPlan(root, registry)).rejects.toThrow(
        'Invalid exact',
      )
    expect(reviewedOperatorDmlMigrations).toEqual([hostedSeedMigration])
  })
})
