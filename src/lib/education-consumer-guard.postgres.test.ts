// @vitest-environment node
// Fresh random-port local PostgreSQL only. No operating EPDG database, runtime
// key, connection string, source record, hosted service or account is accessed.
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createLocalPostgres } from '../test/local-postgres'
import type { LocalPgPool } from '../test/local-postgres'
import {
  FIXTURE_IDS,
  SYNTHETIC_HANDOFF,
} from '../../netlify/functions/lib/education-handoff.mts'

const enabled = process.env.CRM_EDUCATION_CONSUMER_POSTGRES === '1'
const run = it.runIf(enabled)
const require = createRequire(import.meta.url)
const pg = require('pg') as {
  Pool: new (options: {
    host: string
    port: number
    database: string
    user: string
    max: number
    connectionTimeoutMillis: number
  }) => LocalPgPool
}
let local: Awaited<ReturnType<typeof createLocalPostgres>>
let operator: LocalPgPool
let app: LocalPgPool
let originalSql: string
let correctionSql: string
let originalEventId: string

const currentReviewer = '80000000-0000-4000-8000-000000000002'
const checks: string[] = []

function extractFunction(sql: string, name: string) {
  const match = sql.match(
    new RegExp(
      `CREATE FUNCTION synthetic_handoff\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`,
    ),
  )
  if (!match) throw new Error('Reviewed fixture function missing')
  return match[0]
}
function extractTrigger(sql: string, name: string) {
  const match = sql.match(new RegExp(`CREATE TRIGGER ${name}[\\s\\S]*?;`))
  if (!match) throw new Error('Reviewed fixture trigger missing')
  return match[0]
}
async function insertEvent(
  reviewer: string,
  version: number,
  decision = 'revoked',
  options: { mappingId?: string; issuedAt?: Date; enabled?: boolean } = {},
) {
  const eventId = randomUUID()
  await app.query(
    `WITH feature_gate AS MATERIALIZED (SELECT set_config('synthetic_handoff.enabled',$10,true))
     INSERT INTO synthetic_handoff.events(event_id,payload_sha256,mapping_id,decision_id,decision_version,
      decision,issued_at,policy_version,reviewer_id,identity_verified,onboarding_complete,agreements_complete,hr_approved,withdrawn)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,true,true,true,true,false FROM feature_gate`,
    [
      eventId,
      'a'.repeat(64),
      options.mappingId || FIXTURE_IDS.mappingId,
      randomUUID(),
      version,
      decision,
      options.issuedAt || new Date(),
      SYNTHETIC_HANDOFF.policyVersion,
      reviewer,
      options.enabled === false ? 'off' : 'on',
    ],
  )
  return eventId
}

beforeAll(async () => {
  if (!enabled) return
  local = await createLocalPostgres('epdg-consumer')
  // These roles and this database exist only in this new disposable cluster.
  await local.pool.query('CREATE ROLE epdg_synthetic_operator LOGIN')
  await local.pool.query('CREATE ROLE epdg_synthetic_app LOGIN BYPASSRLS')
  await local.pool.query(
    'CREATE DATABASE epdg_synthetic OWNER epdg_synthetic_operator',
  )
  const options = {
    host: '127.0.0.1',
    port: local.port,
    database: 'epdg_synthetic',
    max: 1,
    connectionTimeoutMillis: 5000,
  }
  operator = new pg.Pool({ ...options, user: 'epdg_synthetic_operator' })
  app = new pg.Pool({ ...options, user: 'epdg_synthetic_app' })
  const migrationRoot = fileURLToPath(
    new URL(
      '../../../exchange/THE-EMERSON-EMPIRE_Backend/epdg-backend-core/learning-migrations/',
      import.meta.url,
    ),
  )
  originalSql = await readFile(
    resolve(migrationRoot, '007-synthetic-crm-handoff.sql'),
    'utf8',
  )
  correctionSql = await readFile(
    resolve(migrationRoot, '008-synthetic-handoff-reviewer-provenance.sql'),
    'utf8',
  )
  // Only FK stubs are needed for an isolated guard test, not portal accounts,
  // authentication, memberships, enrollment activation or a receiver instance.
  await operator.query(`CREATE SCHEMA core; CREATE TABLE core.users(id integer PRIMARY KEY);
    CREATE SCHEMA synthetic_learning;
    CREATE TABLE synthetic_learning.enrollments(id uuid PRIMARY KEY);`)
  await operator.query(
    originalSql.slice(
      0,
      originalSql.indexOf(
        'CREATE FUNCTION synthetic_handoff.enrollment_allowed',
      ),
    ),
  )
  await operator.query('INSERT INTO core.users(id) VALUES(1)')
  await operator.query(
    'INSERT INTO synthetic_learning.enrollments(id) VALUES($1)',
    [FIXTURE_IDS.enrollmentId],
  )
  await operator.query(
    `INSERT INTO synthetic_handoff.mappings(id,person_id,application_id,crm_program_id,reviewer_id,user_id,enrollment_id)
     VALUES($1,$2,$3,$4,$5,1,$6)`,
    [
      FIXTURE_IDS.mappingId,
      FIXTURE_IDS.personId,
      FIXTURE_IDS.applicationId,
      FIXTURE_IDS.crmProgramId,
      FIXTURE_IDS.reviewerId,
      FIXTURE_IDS.enrollmentId,
    ],
  )
  for (const name of ['mapping', 'event', 'nonce']) {
    await operator.query(extractFunction(originalSql, `guard_${name}`))
    await operator.query(extractTrigger(originalSql, `handoff_${name}_guard`))
  }
  await operator.query(`GRANT USAGE ON SCHEMA synthetic_handoff TO epdg_synthetic_app;
    GRANT SELECT ON ALL TABLES IN SCHEMA synthetic_handoff TO epdg_synthetic_app;
    GRANT INSERT(event_id,payload_sha256,mapping_id,decision_id,decision_version,decision,issued_at,policy_version,
      reviewer_id,identity_verified,onboarding_complete,agreements_complete,hr_approved,withdrawn)
      ON synthetic_handoff.events TO epdg_synthetic_app;`)
  originalEventId = await insertEvent(FIXTURE_IDS.reviewerId, 1, 'cleared')
}, 120000)

afterAll(async () => {
  await app?.end()
  await operator?.end()
  if (local) {
    await writeFile(
      resolve(local.evidence, 'consumer-guard-result.json'),
      JSON.stringify(
        {
          scope:
            'fresh minimal EPDG guard fixture, not the operating portal or full receiver',
          checks,
          operatingEpdgDatabaseTouched: false,
          operationalKeyRead: false,
          accountSessionMembershipRoleOrEnrollmentActivation: false,
        },
        null,
        2,
      ),
    )
    await local.stop()
  }
}, 60000)

run(
  'demonstrates original007 reviewer pin before applying the forward correction',
  async () => {
    await expect(insertEvent(currentReviewer, 2)).rejects.toMatchObject({
      code: '23514',
    })
    expect(
      (
        await app.query(
          'SELECT count(*)::int AS count FROM synthetic_handoff.events',
        )
      ).rows[0].count,
    ).toBe(1)
    checks.push('old reviewer pin independently reproduced')
  },
)

run(
  '008 is idempotent and preserves all prior events and immutable mapping values',
  async () => {
    const oldEvents = (
      await operator.query(
        'SELECT to_jsonb(e) AS row FROM synthetic_handoff.events e ORDER BY event_id',
      )
    ).rows
    const oldMapping = (
      await operator.query(
        'SELECT to_jsonb(m) AS row FROM synthetic_handoff.mappings m',
      )
    ).rows
    await operator.query(correctionSql)
    await operator.query(correctionSql)
    expect(
      (
        await operator.query(
          'SELECT to_jsonb(e) AS row FROM synthetic_handoff.events e ORDER BY event_id',
        )
      ).rows,
    ).toEqual(oldEvents)
    expect(
      (
        await operator.query(
          'SELECT to_jsonb(m) AS row FROM synthetic_handoff.mappings m',
        )
      ).rows,
    ).toEqual(oldMapping)
    const id = await insertEvent(currentReviewer, 2)
    expect(
      (
        await app.query(
          'SELECT reviewer_id,decision FROM synthetic_handoff.events WHERE event_id=$1',
          [id],
        )
      ).rows[0],
    ).toMatchObject({ reviewer_id: currentReviewer, decision: 'revoked' })
    expect(
      (
        await app.query(
          'SELECT reviewer_id FROM synthetic_handoff.events WHERE event_id=$1',
          [originalEventId],
        )
      ).rows[0].reviewer_id,
    ).toBe(FIXTURE_IDS.reviewerId)
    checks.push(
      'forward correction repeated without row changes; new reviewer revocation retained',
    )
  },
)

run(
  'unknown mappings, stale versions and invalid issue times still fail in the real DB trigger',
  async () => {
    await expect(
      insertEvent(currentReviewer, 3, 'revoked', { mappingId: randomUUID() }),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(insertEvent(currentReviewer, 2)).rejects.toMatchObject({
      code: '23514',
    })
    await expect(
      insertEvent(currentReviewer, 3, 'revoked', {
        issuedAt: new Date(Date.now() - 301000),
      }),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      insertEvent(currentReviewer, 3, 'revoked', {
        issuedAt: new Date(Date.now() + 31000),
      }),
    ).rejects.toMatchObject({ code: '23514' })
    expect(
      (
        await app.query(
          'SELECT count(*)::int AS count FROM synthetic_handoff.events',
        )
      ).rows[0].count,
    ).toBe(2)
    checks.push('mapping, revision and freshness guards retained')
  },
)

run(
  'default-off, narrow grants and append-only mapping/events remain enforced',
  async () => {
    await expect(
      insertEvent(currentReviewer, 3, 'revoked', { enabled: false }),
    ).rejects.toMatchObject({
      code: '23514',
    })
    await expect(
      app.query('UPDATE synthetic_handoff.events SET withdrawn=true'),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      app.query('UPDATE synthetic_handoff.mappings SET reviewer_id=$1', [
        currentReviewer,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      operator.query('UPDATE synthetic_handoff.events SET withdrawn=true'),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      operator.query('UPDATE synthetic_handoff.mappings SET reviewer_id=$1', [
        currentReviewer,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(app.query(correctionSql)).rejects.toMatchObject({
      code: '23514',
    })
    await expect(local.pool.query(correctionSql)).rejects.toMatchObject({
      code: '23514',
    })
    checks.push(
      'feature gate, immutability, narrow privileges and local operator migration gate retained',
    )
  },
)
