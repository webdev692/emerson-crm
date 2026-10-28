// @vitest-environment node
// Exact configured seed bytes must reject fictional reviewers. The positive
// control substitutes only explicit fictional reviewer commitments in a fresh
// loopback netlifydb; it never creates an actual Identity account or role grant.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createLocalPostgres, type LocalPgPool } from '../test/local-postgres'
import {
  hostedSeedMigration,
  rehearsalMigrationPlan,
  reviewedOperatorDmlMigrations,
} from '../test/rehearsal-migrations'
import {
  hostedReviewerIdSha256,
  hostedReviewerIdentitySha256,
} from '../../netlify/functions/lib/education-hosted.mts'

const enabled = process.env.CRM_EDUCATION_HOSTED_POSTGRES_TEST === '1'
const require = createRequire(import.meta.url)
const reviewer = {
  id: '90000000-0000-4000-8000-000000000011',
  email: 'seed-reviewer@emerson.example',
}
let cluster: Awaited<ReturnType<typeof createLocalPostgres>> | undefined
let pool: LocalPgPool | undefined
let seed: string
let memberRows: unknown[]
const tables = [
  'crm_members',
  'crm_records',
  'crm_audit',
  'crm_education_hosted_identity',
  'crm_education_hosted_observations',
  'crm_education_decisions',
  'crm_education_outbox',
]
async function snapshot() {
  if (!pool) throw new Error('No fresh netlifydb')
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [
        table,
        (
          await pool!.query(
            `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
          )
        ).rows,
      ]),
    ),
  )
}

describe.skipIf(!enabled)(
  'configured hosted seed with fictional local ownership',
  () => {
    beforeAll(async () => {
      cluster = await createLocalPostgres('hosted-seed')
      await cluster.pool.query('CREATE DATABASE netlifydb')
      const { Pool } = require('pg') as {
        Pool: new (config: {
          host: string
          port: number
          user: string
          database: string
          max: number
        }) => LocalPgPool
      }
      pool = new Pool({
        host: '127.0.0.1',
        port: cluster.port,
        user: 'crm_education_rehearsal',
        database: 'netlifydb',
        max: 2,
      })
      expect(
        (
          await pool.query(
            'SELECT current_database() AS name,host(inet_server_addr()) AS host',
          )
        ).rows,
      ).toEqual([{ name: 'netlifydb', host: '127.0.0.1' }])
      const root = fileURLToPath(
        new URL('../../netlify/database/migrations', import.meta.url),
      )
      const plan = await rehearsalMigrationPlan(root)
      expect(plan.deferredOperatorDml).toEqual(
        [...reviewedOperatorDmlMigrations].sort((a, b) =>
          a.migration.localeCompare(b.migration),
        ),
      )
      for (const entry of plan.operatorDmlSql) {
        const bytes = await readFile(`${root}/${entry.path}`)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(
          entry.sha256,
        )
        expect(entry.sql).toBe(bytes.toString('utf8'))
      }
      expect(
        plan.operatorDmlSql.find(
          (entry) => entry.migration === hostedSeedMigration.migration,
        ),
      ).toEqual({ ...hostedSeedMigration, sql: plan.seedSql })
      for (const migration of plan.schemaMigrations) {
        const sql = await readFile(`${root}/${migration}/migration.sql`, 'utf8')
        await pool.query(`BEGIN;\n${sql}\nCOMMIT;`)
      }
      seed = plan.seedSql
      await pool.query(
        'INSERT INTO crm_members(id,email,name,role,active,commercial,hr) VALUES($1,$2,$3,$4,true,false,false)',
        [reviewer.id, reviewer.email, 'SYNTHETIC seed reviewer', 'owner'],
      )
      memberRows = (await pool.query('SELECT * FROM crm_members ORDER BY id'))
        .rows
    }, 120000)
    afterAll(async () => {
      await pool?.end()
      await cluster?.stop()
    }, 60000)

    it('rejects exact production-targeted bytes without changing any fixture, member or event', async () => {
      const before = await snapshot()
      await expect(pool!.query(seed)).rejects.toMatchObject({
        code: '55000',
        message:
          'Existing current verified owner membership required; no grants are performed',
      })
      expect(await snapshot()).toEqual(before)
    })

    it('rehearses the same seed control flow only after fictional hash substitutions, without grants', async () => {
      const before = await snapshot()
      const commitments = seed.match(
        /reviewer_(?:id|identity)_sha256 text := '([0-9a-f]{64})'/g,
      )
      expect(commitments).toHaveLength(2)
      const fictional = seed
        .replace(
          /reviewer_id_sha256 text := '[0-9a-f]{64}'/,
          `reviewer_id_sha256 text := '${hostedReviewerIdSha256(reviewer.id)}'`,
        )
        .replace(
          /reviewer_identity_sha256 text := '[0-9a-f]{64}'/,
          `reviewer_identity_sha256 text := '${hostedReviewerIdentitySha256(reviewer.id, reviewer.email)}'`,
        )
      expect(fictional).not.toBe(seed)
      await pool!.query(fictional)
      const after = await snapshot()
      expect(after.crm_records).toEqual(
        expect.arrayContaining(before.crm_records),
      )
      expect(after.crm_records).toHaveLength(before.crm_records.length + 4)
      expect(
        (await pool!.query('SELECT * FROM crm_members ORDER BY id')).rows,
      ).toEqual(memberRows)
      expect(
        (
          await pool!.query(
            "SELECT count(*)::integer AS count FROM crm_records WHERE data->>'educationFixture'='true'",
          )
        ).rows,
      ).toEqual([{ count: 4 }])
      expect(
        (
          await pool!.query(
            "SELECT count(*)::integer AS count FROM crm_records WHERE data->>'educationFixture'='true' AND access<>'hr'",
          )
        ).rows,
      ).toEqual([{ count: 0 }])
      expect(
        (
          await pool!.query(
            'SELECT reviewer_ids AS reviewers,synthetic_only AS synthetic FROM crm_education_hosted_identity',
          )
        ).rows,
      ).toEqual([{ reviewers: [reviewer.id], synthetic: true }])
      expect(
        (
          await pool!.query(
            "SELECT count(*)::integer AS count FROM crm_audit WHERE action='synthetic hosted fixture seeded'",
          )
        ).rows,
      ).toEqual([{ count: 4 }])
      for (const table of [
        'crm_education_decisions',
        'crm_education_outbox',
        'crm_education_hosted_observations',
      ])
        expect(
          (await pool!.query(`SELECT count(*)::integer AS count FROM ${table}`))
            .rows,
        ).toEqual([{ count: 0 }])
      const beforeCollision = await snapshot()
      await expect(pool!.query(fictional)).rejects.toMatchObject({
        code: '55000',
      })
      expect(await snapshot()).toEqual(beforeCollision)
    })
  },
)
