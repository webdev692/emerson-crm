// @vitest-environment node
// Opt-in integration rehearsal. Every database, identity and address is synthetic.
// This creates its own loopback-only PostgreSQL cluster; it never reads a hosted
// connection string, .env file, Identity session, or production data.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { execFile, spawn } from 'node:child_process'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'
import type { RecordData, RecordEnvelope } from './crm-types'
import { calendarDefault } from './rules'
import { rehearsalMigrationPlan } from '../test/rehearsal-migrations'

type FixtureRecord = typeof schema.records.$inferSelect
interface PgPool {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>
  end(): Promise<void>
}
interface PgModule {
  Pool: new (options: {
    host: string
    port: number
    user: string
    database: string
    max: number
    connectionTimeoutMillis: number
  }) => PgPool
}
interface RowCount {
  kind: string
  count: number
}
interface LegacyAuthorityCase {
  action: 'save' | 'decide'
  label: string
  expected: number
  initialRole?: string
  hr?: boolean
  role?: string
  active?: boolean
  email?: string
  commercial?: boolean
}
interface RemainingMutationCase {
  action: 'settings' | 'import-summary' | 'staff'
  label: string
  expected: number
  active?: boolean
  role?: string
  email?: string
}
const remainingMutationCases: RemainingMutationCase[] = [
  ...(['settings', 'import-summary'] as const).flatMap((action) => [
    { action, label: 'inactive membership', active: false, expected: 403 },
    { action, label: 'viewer demotion', role: 'viewer', expected: 403 },
    {
      action,
      label: 'changed identity email',
      email: 'changed@rehearsal.invalid',
      expected: 403,
    },
    {
      action,
      label: 'lost required role',
      role: action === 'settings' ? 'manager' : 'contributor',
      expected: 403,
    },
    { action, label: 'unchanged compatible authority', expected: 200 },
  ]),
  {
    action: 'staff',
    label: 'changed owner identity email',
    email: 'changed@rehearsal.invalid',
    expected: 403,
  },
  { action: 'staff', label: 'owner demotion', role: 'manager', expected: 403 },
  {
    action: 'staff',
    label: 'current owner changing existing target to inactive',
    expected: 200,
  },
]
const legacyAuthorityCases: LegacyAuthorityCase[] = [
  ...(['save', 'decide'] as const).flatMap((action) => [
    { action, label: 'inactive membership', active: false, expected: 403 },
    {
      action,
      label: 'viewer demotion despite commercial flag',
      role: 'viewer',
      expected: 403,
    },
    {
      action,
      label: 'changed identity email',
      email: 'changed@rehearsal.invalid',
      expected: 403,
    },
    {
      action,
      label: 'HR scope revocation',
      hr: false,
      expected: action === 'save' ? 403 : 400,
    },
    { action, label: 'unchanged compatible authority', expected: 200 },
    {
      action,
      label: 'compatible owner to commercial manager demotion',
      initialRole: 'owner',
      role: 'manager',
      expected: 200,
    },
  ]),
  {
    action: 'save',
    label: 'manager loses assignment authority',
    role: 'contributor',
    expected: 403,
  },
  {
    action: 'decide',
    label: 'commercial authority revocation',
    commercial: false,
    expected: 403,
  },
  {
    action: 'decide',
    label: 'owner loses owner and commercial authority',
    initialRole: 'owner',
    role: 'contributor',
    commercial: false,
    expected: 403,
  },
  {
    action: 'decide',
    label: 'commercial contributor lacks current record assignment',
    role: 'contributor',
    expected: 400,
  },
]

const context = vi.hoisted(() => ({
  user: null as { id: string } | null,
  db: null as NodePgDatabase<typeof schema> | null,
  identities: {} as Record<
    string,
    { id: string; email: string; invitedAt: string; confirmedAt: string }
  >,
  identityLookups: [] as string[],
}))
function rehearsalDatabase() {
  if (!context.db)
    throw new Error('Local PostgreSQL fixture is not initialized')
  return context.db
}
vi.mock('@netlify/identity', () => ({
  getUser: async () => context.user,
  admin: {
    getUser: async (id: string) => {
      context.identityLookups.push(id)
      const identity = context.identities[id]
      if (!identity) throw new Error('Unexpected Identity lookup')
      return identity
    },
  },
}))
vi.mock('../../db/index', () => ({ database: rehearsalDatabase }))
import handler from '../../netlify/functions/crm.mts'

const enabled = process.env.CRM_FOUNDATION_POSTGRES_TEST === '1'
const require = createRequire(import.meta.url)
const run = promisify(execFile)
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const postgresBin = join(workspace, '.tools/postgresql-17.11/pgsql/bin')
const evidenceRoot = join(
  workspace,
  'build-evidence/emerson-crm-foundation/2026-10-24',
)
const owner = '10000000-0000-4000-8000-000000000001'
const manager = '10000000-0000-4000-8000-000000000002'
const contributor = '10000000-0000-4000-8000-000000000003'
const hr = '10000000-0000-4000-8000-000000000004'
const next = {
  nextAction: 'Review synthetic evidence',
  nextDue: '2026-11-02T15:00:00Z',
}
let pool: PgPool
let cluster = ''
let evidence = ''
let started = false
let port = 0
let migrations: string[] = []

// pg_ctl can leave its child's pipe handles open on Windows. Ignore its stdio
// and await the process exit; PostgreSQL writes diagnostics to the local log.
async function controlPostgres(args: string[]) {
  await new Promise<void>((resolveControl, reject) => {
    const process = spawn(join(postgresBin, 'pg_ctl.exe'), args, {
      windowsHide: true,
      stdio: 'ignore',
    })
    const timeout = setTimeout(() => {
      process.kill()
      reject(new Error('Local PostgreSQL control timed out'))
    }, 45000)
    process.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    process.once('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolveControl()
      else reject(new Error(`Local PostgreSQL control exited ${code}`))
    })
  })
}

async function unusedHighPort() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = randomInt(49152, 64000)
    const server = createServer()
    const available = await new Promise<boolean>((resolvePort) => {
      server.once('error', () => resolvePort(false))
      server.listen(candidate, '127.0.0.1', () =>
        server.close(() => resolvePort(true)),
      )
    })
    if (available) return candidate
  }
  throw new Error('No unused loopback high port available')
}

function request(body?: unknown, suffix = '') {
  return new Request(
    `https://crm-rehearsal.invalid/api/crm${suffix}`,
    body
      ? {
          method: 'POST',
          headers: {
            origin: 'https://crm-rehearsal.invalid',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      : undefined,
  )
}
const call = (body: unknown) => handler(request(body))
async function save(
  kind: string,
  data: RecordData,
  extra: Partial<RecordEnvelope> = {},
) {
  const response = await call({
    action: 'foundation-save',
    record: {
      ...extra,
      kind,
      title: extra.title || 'Synthetic rehearsal',
      data: { ...next, ...data },
    },
  })
  const result = await response.json()
  expect(response.status, JSON.stringify(result)).toBe(200)
  return result.record
}
async function intake(
  sourceId: string,
  workflow = 'class',
  data: RecordData = {},
) {
  const sourceName = 'Local synthetic intake fixture'
  const sourceKey = createHash('sha256')
    .update(JSON.stringify([sourceName.toLowerCase(), sourceId]))
    .digest('hex')
  // Preview deliberately excludes .invalid addresses. Insert a synthetic mapped
  // ready row only inside this empty local database to exercise review writes.
  return (
    await rehearsalDatabase()
      .insert(schema.records)
      .values({
        kind: 'intake',
        title: 'Synthetic local candidate',
        ownerId: owner,
        access: ['program', 'sales'].includes(workflow) ? 'hr' : 'record',
        sourceKey,
        data: {
          ...next,
          sourceName,
          sourceId,
          workflow,
          status: 'ready',
          name: 'Synthetic local candidate',
          email: 'candidate@rehearsal.invalid',
          organization: 'Synthetic Local Organization',
          contactPermission: 'Service follow-up only',
          ...data,
        },
      })
      .returning()
  )[0]
}
const review = (row: FixtureRecord, extra: Record<string, unknown> = {}) =>
  call({
    action: 'intake-review',
    id: row.id,
    revision: row.revision,
    decision: 'apply',
    reason: 'Synthetic local reconciliation verified',
    ...extra,
  })
async function counts() {
  return (
    await pool.query<RowCount>(
      'SELECT kind, count(*)::integer AS count FROM crm_records GROUP BY kind ORDER BY kind',
    )
  ).rows
}

describe.skipIf(!enabled)(
  'foundation API with a fresh isolated PostgreSQL cluster',
  () => {
    beforeAll(async () => {
      expect(
        process.platform,
        'Bundled PostgreSQL rehearsal supports this Windows workspace',
      ).toBe('win32')
      evidence = join(evidenceRoot, `postgres-${randomUUID()}`)
      cluster = join(evidence, 'data')
      await mkdir(evidence, { recursive: true })
      port = await unusedHighPort()
      await run(
        join(postgresBin, 'initdb.exe'),
        [
          '-D',
          cluster,
          '-U',
          'crm_rehearsal',
          '--auth=trust',
          '--encoding=UTF8',
          '--locale=C',
        ],
        { windowsHide: true, timeout: 60000 },
      )
      await controlPostgres([
        'start',
        '-D',
        cluster,
        '-l',
        join(evidence, 'postgres.log'),
        '-o',
        `-h 127.0.0.1 -p ${port} -F -c listen_addresses=127.0.0.1 -c max_connections=12`,
        '-w',
        '-t',
        '30',
      ])
      started = true
      const { Pool } = require('pg') as PgModule
      pool = new Pool({
        host: '127.0.0.1',
        port,
        user: 'crm_rehearsal',
        database: 'postgres',
        max: 6,
        connectionTimeoutMillis: 5000,
      })
      const host = (
        await pool.query(
          'SELECT host(inet_server_addr()) AS host, inet_server_port() AS port',
        )
      ).rows[0]
      expect(host).toEqual({ host: '127.0.0.1', port })
      context.db = drizzle({ client: pool, schema })
      const migrationRoot = resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../netlify/database/migrations',
      )
      const plan = await rehearsalMigrationPlan(migrationRoot)
      migrations = plan.schemaMigrations
      for (const migration of migrations) {
        const sql = await readFile(
          join(migrationRoot, migration, 'migration.sql'),
          'utf8',
        )
        await pool.query(`BEGIN;\n${sql}\nCOMMIT;`)
      }
      expect(
        (
          await pool.query(
            "SELECT count(*)::integer AS count FROM crm_records WHERE kind='offer'",
          )
        ).rows[0].count,
      ).toBe(8)
      const columns = (
        await pool.query(
          "SELECT table_name,column_name FROM information_schema.columns WHERE table_name IN ('crm_members','crm_records')",
        )
      ).rows
      expect(columns).toContainEqual({
        table_name: 'crm_members',
        column_name: 'hr',
      })
      expect(columns).toContainEqual({
        table_name: 'crm_records',
        column_name: 'access',
      })
      vi.stubGlobal('Netlify', { env: { get: () => undefined } })
      await writeFile(
        join(evidence, 'isolation.json'),
        JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            host: '127.0.0.1',
            port,
            database: 'fresh local PostgreSQL cluster',
            hostedConnections: false,
            syntheticAddressesOnly: true,
            migrations,
            deferredOperatorDml: plan.deferredOperatorDml,
            adapter:
              'drizzle-orm/node-postgres; production handler and schema; mocked Identity/database factory only',
            intakeApplyFixture:
              'Synthetic ready queue rows inserted directly because preview rejects .invalid addresses',
          },
          null,
          2,
        ),
      )
    }, 120000)

    beforeEach(async () => {
      await pool.query(
        'TRUNCATE crm_audit, crm_records, crm_members, crm_settings CASCADE',
      )
      await rehearsalDatabase()
        .insert(schema.members)
        .values([
          {
            id: owner,
            email: 'owner@rehearsal.invalid',
            name: 'Synthetic owner',
            role: 'owner',
            active: true,
            commercial: true,
            hr: false,
          },
          {
            id: manager,
            email: 'manager@rehearsal.invalid',
            name: 'Synthetic sales manager',
            role: 'manager',
            active: true,
            commercial: false,
            hr: false,
          },
          {
            id: contributor,
            email: 'staff@rehearsal.invalid',
            name: 'Synthetic sales staff',
            role: 'contributor',
            active: true,
            commercial: false,
            hr: false,
          },
          {
            id: hr,
            email: 'hr@rehearsal.invalid',
            name: 'Synthetic HR reviewer',
            role: 'manager',
            active: true,
            commercial: false,
            hr: true,
          },
        ])
      context.user = { id: owner }
      context.identities = {}
      context.identityLookups = []
    })

    afterAll(async () => {
      await pool?.end()
      if (started) {
        await controlPostgres([
          'stop',
          '-D',
          cluster,
          '-m',
          'fast',
          '-w',
          '-t',
          '30',
        ])
        await writeFile(
          join(evidence, 'stopped.json'),
          JSON.stringify(
            {
              stoppedAt: new Date().toISOString(),
              clusterStopped: true,
              migrations,
            },
            null,
            2,
          ),
        )
      }
      vi.unstubAllGlobals()
    }, 60000)

    it.each([
      {
        label: 'HR revocation',
        hr: false,
        role: 'manager',
        active: true,
        email: 'hr@rehearsal.invalid',
      },
      {
        label: 'viewer demotion',
        hr: true,
        role: 'viewer',
        active: true,
        email: 'hr@rehearsal.invalid',
      },
      {
        label: 'inactive membership',
        hr: true,
        role: 'manager',
        active: false,
        email: 'hr@rehearsal.invalid',
      },
      {
        label: 'changed identity email',
        hr: true,
        role: 'manager',
        active: true,
        email: 'changed@rehearsal.invalid',
      },
    ])(
      'rejects a queued foundation write after $label commits under the same lock',
      async (change) => {
        const { Pool } = require('pg') as PgModule
        const blocker = new Pool({
          host: '127.0.0.1',
          port,
          user: 'crm_rehearsal',
          database: 'postgres',
          max: 1,
          connectionTimeoutMillis: 5000,
        })
        let pending: Promise<Response> | undefined
        try {
          await blocker.query('BEGIN; SELECT pg_advisory_xact_lock(7031926)')
          context.user = { id: hr }
          pending = call({
            action: 'foundation-save',
            record: {
              kind: 'contact',
              title: 'SYNTHETIC queued restricted person',
              access: 'hr',
              ownerId: owner,
              data: {
                ...next,
                name: 'SYNTHETIC queued person',
                email: 'queued@rehearsal.invalid',
                contactPermission: 'Unknown',
              },
            },
          })
          const deadline = Date.now() + 5000
          let waiting = false
          while (Date.now() < deadline) {
            waiting = (
              await pool.query<{ waiting: boolean }>(
                "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=7031926 AND NOT granted) AS waiting",
              )
            ).rows[0].waiting
            if (waiting) break
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          expect(
            waiting,
            'Request must authenticate before the queued revocation commits',
          ).toBe(true)
          await blocker.query(
            'UPDATE crm_members SET hr=$1,role=$2,active=$3,email=$4 WHERE id=$5',
            [change.hr, change.role, change.active, change.email, hr],
          )
          await blocker.query('COMMIT')
          expect((await pending).status).toBe(403)
          expect(await counts()).toEqual([])
          expect(
            (
              await pool.query(
                'SELECT count(*)::integer AS count FROM crm_audit',
              )
            ).rows[0].count,
          ).toBe(0)
        } finally {
          await blocker.query('ROLLBACK')
          await pending
          await blocker.end()
        }
      },
    )

    it.each(legacyAuthorityCases)(
      'rechecks queued legacy $action after $label under the write lock',
      async (change) => {
        await rehearsalDatabase()
          .update(schema.members)
          .set({ role: change.initialRole || 'manager', commercial: true })
          .where(eq(schema.members.id, hr))
        const [parent] =
          change.action === 'save'
            ? await rehearsalDatabase()
                .insert(schema.records)
                .values({
                  kind: 'research',
                  title: 'SYNTHETIC permitted task parent',
                  ownerId: owner,
                  access: 'hr',
                  data: next,
                })
                .returning()
            : []
        const [target] = await rehearsalDatabase()
          .insert(schema.records)
          .values({
            kind: change.action === 'save' ? 'task' : 'research',
            title: 'SYNTHETIC legacy queued target',
            ownerId: owner,
            parentId: parent?.id,
            access: 'hr',
            data: { ...next, notes: 'SYNTHETIC retained body' },
          })
          .returning()
        const before = await rehearsalDatabase().select().from(schema.records)
        const { Pool } = require('pg') as PgModule
        const blocker = new Pool({
          host: '127.0.0.1',
          port,
          user: 'crm_rehearsal',
          database: 'postgres',
          max: 1,
          connectionTimeoutMillis: 5000,
        })
        let pending: Promise<Response> | undefined
        try {
          await blocker.query('BEGIN; SELECT pg_advisory_xact_lock(7031926)')
          context.user = { id: hr }
          pending = call(
            change.action === 'save'
              ? {
                  action: 'save',
                  record: {
                    ...target,
                    title: 'SYNTHETIC updated legacy task',
                    data: { ...target.data, notes: 'SYNTHETIC queued update' },
                  },
                }
              : {
                  action: 'decide',
                  id: target.id,
                  revision: target.revision,
                  decision: 'declined',
                  reason: 'SYNTHETIC queued current-authority decision',
                },
          )
          const deadline = Date.now() + 5000
          let waiting = false
          while (Date.now() < deadline) {
            waiting = (
              await pool.query<{ waiting: boolean }>(
                "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=7031926 AND NOT granted) AS waiting",
              )
            ).rows[0].waiting
            if (waiting) break
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          expect(
            waiting,
            'The actual handler must queue after request-time authentication',
          ).toBe(true)
          await blocker.query(
            'UPDATE crm_members SET hr=$1,role=$2,active=$3,email=$4,commercial=$5 WHERE id=$6',
            [
              change.hr ?? true,
              change.role ?? 'manager',
              change.active ?? true,
              change.email ?? 'hr@rehearsal.invalid',
              change.commercial ?? true,
              hr,
            ],
          )
          await blocker.query('COMMIT')
          const response = await pending
          expect(response.status, await response.clone().text()).toBe(
            change.expected,
          )
          const after = await rehearsalDatabase().select().from(schema.records)
          const auditCount = (
            await pool.query('SELECT count(*)::integer AS count FROM crm_audit')
          ).rows[0].count
          if (change.expected === 200) {
            expect(auditCount).toBe(1)
            if (change.action === 'save')
              expect(after.find((row) => row.id === target.id)?.revision).toBe(
                target.revision + 1,
              )
            else
              expect(
                after.find((row) => row.kind === 'approval')?.data.approvedBy,
              ).toBe(hr)
          } else {
            expect(after).toEqual(before)
            expect(auditCount).toBe(0)
          }
          expect(
            await rehearsalDatabase().select().from(schema.members),
          ).toHaveLength(4)
        } finally {
          await blocker.query('ROLLBACK')
          await pending
          await blocker.end()
        }
      },
    )

    it.each(remainingMutationCases)(
      'rechecks queued $action after $label before validation and mutation',
      async (change) => {
        const actorId = change.action === 'import-summary' ? manager : owner
        const actorEmail =
          change.action === 'import-summary'
            ? 'manager@rehearsal.invalid'
            : 'owner@rehearsal.invalid'
        const initialRole =
          change.action === 'import-summary' ? 'manager' : 'owner'
        const [targetBefore] = await rehearsalDatabase()
          .select()
          .from(schema.members)
          .where(eq(schema.members.id, contributor))
        context.identities[contributor] = {
          id: contributor,
          email: targetBefore.email,
          invitedAt: '2026-01-01T00:00:00.000Z',
          confirmedAt: '2026-01-01T00:00:00.000Z',
        }
        const { Pool } = require('pg') as PgModule
        const blocker = new Pool({
          host: '127.0.0.1',
          port,
          user: 'crm_rehearsal',
          database: 'postgres',
          max: 1,
          connectionTimeoutMillis: 5000,
        })
        let pending: Promise<Response> | undefined
        try {
          await blocker.query('BEGIN; SELECT pg_advisory_xact_lock(7031926)')
          context.user = { id: actorId }
          const body =
            change.action === 'settings'
              ? { action: 'settings', data: calendarDefault }
              : change.action === 'import-summary'
                ? {
                    action: 'import-summary',
                    source: 'SYNTHETIC queued summary',
                    summary: ['SYNTHETIC row retained'],
                    counts: { imported: 1 },
                  }
                : {
                    action: 'staff',
                    id: contributor,
                    email: targetBefore.email,
                    name: targetBefore.name,
                    role: targetBefore.role,
                    active: false,
                    commercial: false,
                    hr: false,
                  }
          pending = call(body)
          const deadline = Date.now() + 5000
          let waiting = false
          while (Date.now() < deadline) {
            waiting = (
              await pool.query<{ waiting: boolean }>(
                "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=7031926 AND NOT granted) AS waiting",
              )
            ).rows[0].waiting
            if (waiting) break
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          expect(
            waiting,
            'Actual authenticated mutation must wait on the shared lock',
          ).toBe(true)
          expect(context.identityLookups).toEqual([])
          await blocker.query(
            'UPDATE crm_members SET active=$1,role=$2,email=$3 WHERE id=$4',
            [
              change.active ?? true,
              change.role ?? initialRole,
              change.email ?? actorEmail,
              actorId,
            ],
          )
          await blocker.query('COMMIT')
          const response = await pending
          expect(response.status, await response.clone().text()).toBe(
            change.expected,
          )
          const rows = await rehearsalDatabase().select().from(schema.records)
          const calendars = await rehearsalDatabase()
            .select()
            .from(schema.settings)
          const logs = await rehearsalDatabase().select().from(schema.audit)
          const [targetAfter] = await rehearsalDatabase()
            .select()
            .from(schema.members)
            .where(eq(schema.members.id, contributor))
          if (change.expected !== 200) {
            expect(rows).toEqual([])
            expect(calendars).toEqual([])
            expect(logs).toEqual([])
            expect(targetAfter).toEqual(targetBefore)
            expect(context.identityLookups).toEqual([])
          } else if (change.action === 'settings') {
            expect(calendars).toHaveLength(1)
            expect(calendars[0].data).toEqual(calendarDefault)
            expect(rows).toEqual([])
            expect(logs).toHaveLength(1)
          } else if (change.action === 'import-summary') {
            expect(rows).toHaveLength(1)
            expect(rows[0].kind).toBe('import')
            expect(rows[0].ownerId).toBe(actorId)
            expect(calendars).toEqual([])
            expect(logs).toEqual([])
          } else {
            expect(targetAfter).toEqual({ ...targetBefore, active: false })
            expect(rows).toEqual([])
            expect(calendars).toEqual([])
            expect(logs).toHaveLength(1)
            expect(context.identityLookups).toEqual([contributor])
          }
          expect(
            await rehearsalDatabase().select().from(schema.members),
          ).toHaveLength(4)
        } finally {
          await blocker.query('ROLLBACK')
          await pending
          await blocker.end()
        }
      },
    )

    it('rejects a staff lookup returning another Identity ID even when its email matches', async () => {
      const [before] = await rehearsalDatabase()
        .select()
        .from(schema.members)
        .where(eq(schema.members.id, contributor))
      context.identities[contributor] = {
        id: manager,
        email: before.email,
        invitedAt: '2026-01-01T00:00:00.000Z',
        confirmedAt: '2026-01-01T00:00:00.000Z',
      }
      const response = await call({
        action: 'staff',
        id: contributor,
        email: before.email,
        name: before.name,
        role: before.role,
        active: false,
        commercial: false,
        hr: false,
      })
      expect(response.status).toBe(400)
      const [after] = await rehearsalDatabase()
        .select()
        .from(schema.members)
        .where(eq(schema.members.id, contributor))
      expect(after).toEqual(before)
      expect(await rehearsalDatabase().select().from(schema.audit)).toEqual([])
      expect(context.identityLookups).toEqual([contributor])
    })

    it('rolls back an entire mapped preview when a later row is invalid and repeats previews without duplication', async () => {
      const row = {
        ...next,
        sourceId: 'synthetic-1',
        name: 'Synthetic row',
        email: 'row@rehearsal.invalid',
      }
      const rejected = await call({
        action: 'intake-preview',
        sourceName: 'Synthetic preview',
        workflow: 'class',
        rows: [row, { ...row, sourceId: '' }],
      })
      expect(rejected.status).toBe(400)
      expect(await counts()).toEqual([])
      expect(
        (await pool.query('SELECT count(*)::integer AS count FROM crm_audit'))
          .rows[0].count,
      ).toBe(0)
      const body = {
        action: 'intake-preview',
        sourceName: 'Synthetic preview',
        workflow: 'class',
        rows: [row],
      }
      const first = await (await call(body)).json()
      const repeat = await (await call(body)).json()
      expect(first.rows[0].data.status).toBe('test')
      expect(repeat.rows[0].id).toBe(first.rows[0].id)
      expect((await review(first.rows[0])).status).toBe(400)
      expect(await counts()).toEqual([{ kind: 'intake', count: 1 }])
    })

    it('applies a reviewed row atomically and serializes concurrent repeat requests to one person and case', async () => {
      const queued = await intake('concurrent-1')
      const responses = await Promise.all([review(queued), review(queued)])
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
      expect(await counts()).toEqual([
        { kind: 'contact', count: 1 },
        { kind: 'engagement', count: 1 },
        { kind: 'intake', count: 1 },
        { kind: 'organization', count: 1 },
      ])
      const saved = (
        await rehearsalDatabase()
          .select()
          .from(schema.records)
          .where(eq(schema.records.id, queued.id))
      )[0]
      expect(saved.data.status).toBe('applied')
      expect(saved.revision).toBe(2)
      expect((await review(saved)).status).toBe(409)
      const repeated = await (
        await call({
          action: 'intake-preview',
          sourceName: queued.data.sourceName,
          workflow: 'class',
          rows: [
            {
              ...queued.data,
            },
          ],
        })
      ).json()
      expect(repeated.rows[0].id).toBe(queued.id)
      expect(repeated.rows[0].data.caseId).toBe(saved.data.caseId)
      const changedAfterApply = await call({
        action: 'intake-preview',
        sourceName: queued.data.sourceName,
        workflow: 'class',
        rows: [{ ...queued.data, sourceVersion: 'changed-after-application' }],
      })
      expect(changedAfterApply.status).toBe(409)
      expect(
        (
          await rehearsalDatabase()
            .select()
            .from(schema.records)
            .where(eq(schema.records.id, queued.id))
        )[0],
      ).toEqual(saved)
    })

    it('transactionally holds changed source versions, rejects stale review, and rolls back a partial changed-source batch', async () => {
      const mapped = {
        ...next,
        sourceId: 'changed-source-1',
        name: 'Synthetic changed-source applicant',
        email: 'source-change@rehearsal.invalid',
        sourceVersion: 'version-1',
        cohort: 'Synthetic original cohort',
        resumeUrl: 'https://assets.invalid/original-resume',
      }
      const preview = {
        action: 'intake-preview',
        sourceName: 'Synthetic changed-source fixture',
        workflow: 'program',
        rows: [mapped],
      }
      expect((await call(preview)).status).toBe(200)
      const original = (
        await rehearsalDatabase().select().from(schema.records)
      )[0]
      const auditBefore = (
        await pool.query<{ count: number }>(
          'SELECT count(*)::integer AS count FROM crm_audit',
        )
      ).rows[0].count
      const changed = {
        ...mapped,
        sourceVersion: 'version-2',
        cohort: 'Synthetic revised cohort',
      }
      expect(
        (
          await call({
            ...preview,
            rows: [changed, { ...mapped, sourceId: '' }],
          })
        ).status,
      ).toBe(400)
      expect(
        (await rehearsalDatabase().select().from(schema.records))[0],
      ).toEqual(original)
      expect(
        (
          await pool.query<{ count: number }>(
            'SELECT count(*)::integer AS count FROM crm_audit',
          )
        ).rows[0].count,
      ).toBe(auditBefore)
      const concurrent = await Promise.all([
        call({ ...preview, rows: [changed] }),
        call({ ...preview, rows: [changed] }),
      ])
      expect(concurrent.map((response) => response.status)).toEqual([200, 200])
      const held = (await rehearsalDatabase().select().from(schema.records))[0]
      expect(held.id).toBe(original.id)
      expect(held.revision).toBe(original.revision + 1)
      expect(held.data).toMatchObject({
        status: 'conflict',
        sourceChanged: true,
        sourceVersion: mapped.sourceVersion,
        cohort: mapped.cohort,
        resumeUrl: mapped.resumeUrl,
      })
      expect(
        (
          await pool.query<{ count: number }>(
            'SELECT count(*)::integer AS count FROM crm_audit',
          )
        ).rows[0].count,
      ).toBe(auditBefore + 1)
      expect((await review(original, { decision: 'exclude' })).status).toBe(409)
      const person = await save('contact', {
        name: 'Synthetic existing person',
        email: mapped.email,
      })
      for (const extra of [{}, { personId: person.id }]) {
        const response = await review(held, extra)
        expect(response.status).toBe(400)
        expect(await response.text()).toMatch(
          /source.*changed|changed.*source/i,
        )
      }
      expect((await review(held, { decision: 'exclude' })).status).toBe(200)
      const excluded = (
        await rehearsalDatabase()
          .select()
          .from(schema.records)
          .where(eq(schema.records.id, held.id))
      )[0]
      expect((await call({ ...preview, rows: [changed] })).status).toBe(409)
      expect(
        (
          await rehearsalDatabase()
            .select()
            .from(schema.records)
            .where(eq(schema.records.id, held.id))
        )[0],
      ).toEqual(excluded)
      expect(await counts()).toEqual([
        { kind: 'contact', count: 1 },
        { kind: 'intake', count: 1 },
      ])
    })

    it('rolls back person, organization, case, queue update and audit when the final audit write fails', async () => {
      const queued = await intake('rollback-1')
      await pool.query(
        "CREATE FUNCTION rehearsal_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'intake applied' THEN RAISE EXCEPTION 'Synthetic final audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER rehearsal_audit_failure BEFORE INSERT ON crm_audit FOR EACH ROW EXECUTE FUNCTION rehearsal_reject_audit()",
      )
      try {
        expect((await review(queued)).status).toBeGreaterThanOrEqual(400)
        expect(await counts()).toEqual([{ kind: 'intake', count: 1 }])
        const saved = (
          await rehearsalDatabase()
            .select()
            .from(schema.records)
            .where(eq(schema.records.id, queued.id))
        )[0]
        expect(saved.revision).toBe(1)
        expect(saved.data.status).toBe('ready')
        expect(
          (await pool.query('SELECT count(*)::integer AS count FROM crm_audit'))
            .rows[0].count,
        ).toBe(0)
      } finally {
        await pool.query(
          'DROP TRIGGER rehearsal_audit_failure ON crm_audit; DROP FUNCTION rehearsal_reject_audit()',
        )
      }
    })

    it('keeps one shared person across class, partner and restricted application cases and rejects stale revisions', async () => {
      const person = await save('contact', {
        name: 'Synthetic multi-role person',
        email: 'multi@rehearsal.invalid',
        contactPermission: 'Service follow-up only',
      })
      const classCase = await save('engagement', {
        personId: person.id,
        workflow: 'class',
        stage: 'New',
        contactPermission: 'Service follow-up only',
      })
      await save('engagement', {
        personId: person.id,
        workflow: 'partner',
        stage: 'New',
      })
      await save('application', {
        personId: person.id,
        workflow: 'sales',
        stage: 'Applied',
        notes: 'Restricted synthetic assessment',
      })
      expect(
        (await counts()).filter((r) =>
          ['contact', 'engagement', 'application'].includes(r.kind),
        ),
      ).toEqual([
        { kind: 'application', count: 1 },
        { kind: 'contact', count: 1 },
        { kind: 'engagement', count: 2 },
      ])
      const update = {
        action: 'foundation-save',
        record: {
          ...classCase,
          data: { ...classCase.data, stage: 'Contacted' },
        },
      }
      const concurrent = await Promise.all([call(update), call(update)])
      expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409])
      const saved = (
        await rehearsalDatabase()
          .select()
          .from(schema.records)
          .where(eq(schema.records.id, classCase.id))
      )[0]
      expect(saved.revision).toBe(2)
      expect(saved.data.stage).toBe('Contacted')
    })

    it('requires an explicit duplicate decision and links another intake to the same person', async () => {
      const first = await intake('same-person-class')
      const applied = await (await review(first)).json()
      const second = await intake('same-person-partner', 'partner', {
        status: 'duplicate',
        candidatePersonIds: [applied.personId],
      })
      expect((await review(second)).status).toBe(409)
      const response = await review(second, { personId: applied.personId })
      expect(response.status).toBe(200)
      const linked = await response.json()
      expect(linked.personId).toBe(applied.personId)
      expect(linked.caseId).not.toBe(applied.caseId)
      expect(
        (await counts()).filter((r) =>
          ['contact', 'engagement', 'intake'].includes(r.kind),
        ),
      ).toEqual([
        { kind: 'contact', count: 1 },
        { kind: 'engagement', count: 2 },
        { kind: 'intake', count: 2 },
      ])
    })

    it('persists approved resource versions and separates learner progress from manager completion', async () => {
      const draft = await save('resource', {
        resourceType: 'training',
        status: 'Draft',
        audience: 'team',
        body: 'Synthetic training worksheet',
        assetUrl: 'https://assets.invalid/synthetic-training',
      })
      const approved = await save(
        'resource',
        {
          ...draft.data,
          status: 'Approved',
          approvalReason: 'Synthetic content version reviewed',
        },
        { ...draft },
      )
      expect(approved.data.approvedBy).toBe(owner)
      expect(approved.data.version).toBe(1)
      const learning = await save('learning', {
        resourceId: approved.id,
        assigneeId: contributor,
        progress: 'Not started',
      })
      context.user = { id: contributor }
      const submitted = await save(
        'learning',
        {
          ...learning.data,
          progress: 'Submitted',
          worksheetUrl: 'https://assets.invalid/synthetic-work',
        },
        { ...learning },
      )
      expect(
        (
          await call({
            action: 'foundation-save',
            record: {
              ...submitted,
              data: { ...submitted.data, progress: 'Completed' },
            },
          })
        ).status,
      ).toBe(403)
      context.user = { id: manager }
      const completed = await save(
        'learning',
        { ...submitted.data, progress: 'Completed' },
        { ...submitted },
      )
      expect(completed.data.completedBy).toBe(manager)
      expect(
        (
          await call({
            action: 'foundation-save',
            record: {
              ...approved,
              data: { ...approved.data, body: 'Attempt approved rewrite' },
            },
          })
        ).status,
      ).toBe(400)
      context.user = { id: owner }
      const v2 = await save('resource', {
        ...approved.data,
        version: undefined,
        status: 'Draft',
        body: 'Synthetic second version',
      })
      expect(v2.data.version).toBe(2)
      expect(v2.data.familyId).toBe(approved.data.familyId)
      expect(v2.data.approvedBy).toBeUndefined()
      const fresh = await (await handler(request())).json()
      expect(
        fresh.records.find((r: FixtureRecord) => r.id === approved.id).data
          .body,
      ).toBe('Synthetic training worksheet')
      expect(
        fresh.records.find((r: FixtureRecord) => r.id === completed.id).data
          .progress,
      ).toBe('Completed')
    })

    it('preserves old normalized no-contact identities after email changes and blocks reimported sales work', async () => {
      const organization = await save('organization', {
        website: 'https://organization.rehearsal.invalid',
      })
      const person = await save(
        'contact',
        {
          email: 'Original@Rehearsal.Invalid',
          contactPermission: 'Service follow-up only',
        },
        { organizationId: organization.id },
      )
      const [opportunity] = await rehearsalDatabase()
        .insert(schema.records)
        .values({
          kind: 'opportunity',
          title: 'Synthetic existing sales work',
          ownerId: owner,
          organizationId: organization.id,
          data: { stage: 'S5' },
        })
        .returning()
      const optedOut = await save(
        'contact',
        { ...person.data, contactPermission: 'Do not contact' },
        { ...person },
      )
      const changed = await save(
        'contact',
        {
          ...optedOut.data,
          email: 'replacement@rehearsal.invalid',
          contactPermission: 'Unknown',
        },
        { ...optedOut },
      )
      expect(changed.data.contactPermission).toBe('Do not contact')
      const restrictions = (
        await rehearsalDatabase().select().from(schema.records)
      ).filter((r) => r.kind === 'suppression')
      expect(restrictions.map((r) => r.data.identity)).toEqual(
        expect.arrayContaining([
          'original@rehearsal.invalid',
          'replacement@rehearsal.invalid',
        ]),
      )
      const oldSales = (
        await rehearsalDatabase()
          .select()
          .from(schema.records)
          .where(eq(schema.records.id, opportunity.id))
      )[0]
      expect(oldSales.data).toMatchObject({ stage: 'X4', suppressed: true })
      const queued = await intake('old-opted-out-address', 'partner', {
        email: 'original@rehearsal.invalid',
        organization: '',
        contactPermission: 'Service follow-up only',
      })
      const response = await review(queued)
      expect(response.status).toBe(200)
      const applied = await response.json()
      const importedPerson = (
        await rehearsalDatabase()
          .select()
          .from(schema.records)
          .where(eq(schema.records.id, applied.personId))
      )[0]
      const importedCase = (
        await rehearsalDatabase()
          .select()
          .from(schema.records)
          .where(eq(schema.records.id, applied.caseId))
      )[0]
      expect(importedPerson.data).toMatchObject({
        suppressed: true,
        contactPermission: 'Do not contact',
      })
      expect(importedCase.data).toMatchObject({
        suppressed: true,
        contactPermission: 'Do not contact',
      })
      expect(
        (
          await call({
            action: 'foundation-save',
            record: {
              ...changed,
              data: {
                ...changed.data,
                contactPermission: 'Marketing permitted',
                permissionEvidence: 'https://evidence.invalid/synthetic',
              },
            },
          })
        ).status,
      ).toBe(400)
    })

    it('keeps applicant-intake organization provenance and no-contact identities out of shared JSON and CSV', async () => {
      const privateSource = 'https://forms.invalid/restricted-applicant-source'
      const queued = await intake('restricted-organization-source', 'program', {
        organization: 'Synthetic restricted applicant institution',
        sourceUrl: privateSource,
        contactPermission: 'Do not contact',
      })
      const response = await review(queued)
      expect(response.status).toBe(200)
      const rows = await rehearsalDatabase().select().from(schema.records)
      const organization = rows.find((r) => r.kind === 'organization')!
      expect(organization).toBeDefined()
      expect(organization.access).toBe('hr')
      expect(organization.data.sourceUrl).toBe(privateSource)
      const restrictions = rows.filter((r) => r.kind === 'suppression')
      expect(restrictions).toHaveLength(1)
      expect(restrictions[0].access).toBe('hr')
      const ownerJson = await (await handler(request())).json()
      expect(ownerJson.records.map((r: FixtureRecord) => r.id)).toContain(
        organization.id,
      )
      context.user = { id: manager }
      const managerJson = await (await handler(request())).json()
      expect(managerJson.records.map((r: FixtureRecord) => r.id)).not.toContain(
        organization.id,
      )
      expect(JSON.stringify(managerJson)).not.toContain(privateSource)
      expect(JSON.stringify(managerJson)).not.toContain(queued.data.email)
      const csv = await (
        await handler(request(undefined, '?export=csv'))
      ).text()
      expect(csv).not.toContain(organization.id)
      expect(csv).not.toContain(privateSource)
      expect(csv).not.toContain(queued.data.email)
    })

    it('preserves applicant source details through local reviewed application without leaking them into the shared person', async () => {
      const details = {
        applicantId: 'synthetic-applicant-1',
        program: 'Synthetic program',
        cohort: 'Synthetic cohort',
        resumeUrl: 'https://assets.invalid/restricted-resume',
        onboardingStatus: 'Awaiting verification',
        sourceVersion: 'revision-2',
        sourceRow: 'original-row-7',
        sourceUrl: 'https://forms.invalid/restricted-applicant-source',
      }
      // Only the empty loopback cluster receives this mapped ready fixture.
      // The public preview classifier still rejects its .invalid identity.
      const sharedPerson = await save('contact', {
        name: 'Synthetic existing directory person',
        email: 'candidate@rehearsal.invalid',
      })
      const queued = await intake('restricted-applicant-details', 'program', {
        ...details,
        status: 'duplicate',
        candidatePersonIds: [sharedPerson.id],
        organization: '',
      })
      const response = await review(queued, { personId: sharedPerson.id })
      expect(response.status).toBe(200)
      const applied = await response.json()
      const rows = await rehearsalDatabase().select().from(schema.records)
      const application = rows.find((row) => row.id === applied.caseId)!
      const person = rows.find((row) => row.id === applied.personId)!
      const savedQueue = rows.find((row) => row.id === queued.id)!
      expect(application).toBeDefined()
      expect(person).toBeDefined()
      expect(savedQueue).toBeDefined()
      expect(application.kind).toBe('application')
      expect(application.access).toBe('hr')
      expect(application.data).toMatchObject({
        ...details,
        personId: person.id,
      })
      expect(savedQueue.data).toMatchObject({
        ...details,
        status: 'applied',
        caseId: application.id,
      })
      for (const key of [
        'applicantId',
        'program',
        'cohort',
        'resumeUrl',
        'onboardingStatus',
      ])
        expect(person.data).not.toHaveProperty(key)
      expect(application.data).not.toHaveProperty('clearance')
      expect(application.data).not.toHaveProperty('learnerId')
      context.user = { id: manager }
      const managerRead = await handler(request())
      expect(managerRead.status).toBe(200)
      const json = await managerRead.text()
      expect(json).toContain(person.id)
      expect(json).not.toContain(application.id)
      expect(json).not.toContain(details.resumeUrl)
      expect(json).not.toContain(details.applicantId)
    })

    it('blocks restricted JSON, CSV, audit, parent inheritance and legacy writes for a sales manager', async () => {
      const person = await save('contact', {
        name: 'Synthetic shared person',
        email: 'privatecase@rehearsal.invalid',
      })
      const application = await save('application', {
        personId: person.id,
        workflow: 'program',
        stage: 'Applied',
        notes: 'Restricted synthetic assessment marker',
      })
      const [child] = await rehearsalDatabase()
        .insert(schema.records)
        .values({
          kind: 'task',
          title: 'Restricted inherited child marker',
          ownerId: manager,
          parentId: application.id,
          data: { ...next, notes: 'Restricted inherited content' },
        })
        .returning()
      context.user = { id: manager }
      const jsonResponse = await handler(request())
      expect(jsonResponse.status).toBe(200)
      const json = await jsonResponse.json()
      expect(json.records.map((r: FixtureRecord) => r.id)).toContain(person.id)
      expect(json.records.map((r: FixtureRecord) => r.id)).not.toContain(
        application.id,
      )
      expect(json.records.map((r: FixtureRecord) => r.id)).not.toContain(
        child.id,
      )
      expect(JSON.stringify(json)).not.toContain(
        'Restricted synthetic assessment marker',
      )
      const csv = await (
        await handler(request(undefined, '?export=csv'))
      ).text()
      expect(csv).toContain(person.id)
      expect(csv).not.toContain(application.id)
      expect(csv).not.toContain(child.id)
      expect((await call({ action: 'audit', id: application.id })).status).toBe(
        403,
      )
      expect(
        (
          await call({
            action: 'foundation-save',
            record: { ...application, access: 'team' },
          })
        ).status,
      ).toBe(403)
      const legacyContactAttempt = await call({
        action: 'save',
        record: {
          ...person,
          data: {
            ...person.data,
            assessmentDetails: 'Attempt restricted payload via legacy bypass',
            resumeUrl: 'https://assets.invalid/private-resume',
          },
        },
      })
      expect(legacyContactAttempt.status).toBe(403)
      const linkedAttempt = await call({
        action: 'save',
        record: {
          kind: 'task',
          title: 'Attempt restricted link',
          parentId: application.id,
          data: next,
        },
      })
      expect([400, 403]).toContain(linkedAttempt.status)
      expect(await linkedAttempt.text()).not.toContain(
        'Restricted inherited content',
      )
      expect(
        (
          await pool.query(
            "SELECT count(*)::integer AS count FROM crm_records WHERE kind='task'",
          )
        ).rows[0].count,
      ).toBe(1)
      context.user = { id: hr }
      const hrJson = await (await handler(request())).json()
      expect(hrJson.records.map((r: FixtureRecord) => r.id)).toContain(
        application.id,
      )
      expect(hrJson.records.map((r: FixtureRecord) => r.id)).toContain(child.id)
    })
  },
)
