// @vitest-environment node
// Opt-in. Fresh random-port loopback PostgreSQL; fictional data only. Production
// CRM handler/transactions and exact Supabase RPC SQL run without hosted I/O.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { eq } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../../db/schema'
import { createLocalPostgres } from '../test/local-postgres'
import type { LocalPgPool } from '../test/local-postgres'
import {
  ENDPOINT,
  SOURCE,
  signedRequest,
} from '../../netlify/functions/lib/website-intake-protocol.mts'
import { pullWebsiteIntake } from '../../netlify/functions/lib/website-intake.mts'
import { handleFoundation } from '../../netlify/functions/lib/foundation.mts'
import { createIntakeHandler } from '../test/website-intake/handler.ts'

const platform = vi.hoisted(() => ({
  user: null as { id: string } | null,
  db: null as NodePgDatabase<typeof schema> | null,
  env: {} as Record<string, string>,
}))
vi.mock('@netlify/identity', () => ({
  getUser: async () => platform.user,
  admin: {
    getUser: async () => {
      throw Error('Unexpected real identity access')
    },
  },
}))
vi.mock('../../db/index', () => ({ database: () => platform.db }))
import crm from '../../netlify/functions/crm.mts'
const enabled = process.env.CRM_WEBSITE_INTAKE_POSTGRES_TEST === '1'
const origin = 'https://synthetic--emerson-crm.netlify.app'
const ownerId = '71000000-0000-4000-8000-000000000001'
const key = randomBytes(32).toString('base64url')
const deployment = {
  site: { id: 'synthetic-intake-site' },
  deploy: {
    id: 'synthetic-intake-deploy',
    context: 'branch-deploy',
    published: false,
  },
} as Context
const sample = () => ({
  eventId: randomUUID(),
  synthetic: true,
  name: 'PILOT TEST Inquiry',
  email: 'pilot-one@intake.invalid',
  workflow: 'service',
  resourceId: 'PILOT-SERVICE',
})
let local: Awaited<ReturnType<typeof createLocalPostgres>>
let service: LocalPgPool
let producer: ReturnType<typeof createIntakeHandler>
const transport: typeof fetch = async (request, init) => {
  expect(init?.redirect).toBe('error')
  expect(String(request instanceof Request ? request.url : request)).toMatch(
    new RegExp('^' + ENDPOINT + '/'),
  )
  return producer(request as Request)
}
const owner = async () =>
  (
    await local.db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, ownerId))
  )[0]
const capture = async (payload = sample()) =>
  producer(
    new Request(`${ENDPOINT}/capture`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
const counts = async () =>
  (
    await local.pool.query<{ kind: string; count: number }>(
      'select kind,count(*)::int as count from crm_records group by kind',
    )
  ).rows
describe.skipIf(!enabled)(
  'automatic mail-free website → CRM review queue',
  () => {
    beforeAll(async () => {
      local = await createLocalPostgres('website-intake')
      platform.db = local.db
      await local.pool.query(
        'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role LOGIN BYPASSRLS;',
      )
      // Reproduce Supabase-style prior defaults. The migration must remove them
      // only from its new tables, then grant the precise required operations.
      await local.pool.query(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role',
      )
      const migration = await readFile(
        new URL('../test/website-intake/migration.sql', import.meta.url),
        'utf8',
      )
      await local.pool.query(migration)
      const { Pool } = createRequire(import.meta.url)('pg') as {
        Pool: new (options: unknown) => LocalPgPool
      }
      service = new Pool({
        host: '127.0.0.1',
        port: local.port,
        user: 'service_role',
        database: 'postgres',
        max: 4,
      })
      producer = createIntakeHandler(
        { enabled: 'synthetic-preview', origin, secret: key },
        {
          capture: async (eventId, payload, payloadHash) =>
            (
              await service.query<{ result: string }>(
                'select public.website_intake_synthetic_capture($1,$2,$3) as result',
                [eventId, payload, payloadHash],
              )
            ).rows[0].result,
          exchange: async (nonce, operation, events) =>
            (
              await service.query<{ result: unknown }>(
                'select public.website_intake_synthetic_exchange($1,$2,$3) as result',
                [nonce, operation, JSON.stringify(events)],
              )
            ).rows[0].result,
        },
      )
      vi.stubGlobal('Netlify', {
        env: { get: (name: string) => platform.env[name] },
      })
    }, 90000)
    beforeEach(async () => {
      await local.pool.query(
        'TRUNCATE crm_records, crm_members, crm_audit, website_intake_synthetic_events, website_intake_synthetic_rate, website_intake_synthetic_nonces CASCADE',
      )
      await local.db.insert(schema.members).values({
        id: ownerId,
        email: 'pilot-owner@intake.invalid',
        name: 'PILOT TEST Owner',
        role: 'owner',
        commercial: true,
      })
      platform.user = { id: ownerId }
      platform.env = {
        CRM_WEBSITE_INTAKE_MODE: 'synthetic-preview',
        CRM_WEBSITE_INTAKE_PREVIEW_ORIGIN: origin,
        CRM_WEBSITE_INTAKE_HMAC_KEY: key,
      }
    })
    afterAll(async () => {
      vi.unstubAllGlobals()
      await service?.end()
      await local?.stop()
    }, 60000)
    it('persists one immutable receipt, deduplicates parallel retries and rejects changed content', async () => {
      const payload = sample()
      const results = await Promise.all([
        capture(payload),
        capture(payload),
        capture(payload),
      ])
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201])
      for (const result of results)
        expect((await result.json()).receipt).toBe(payload.eventId)
      expect(
        (await capture({ ...payload, resourceId: 'PILOT-CHANGED' })).status,
      ).toBe(409)
      expect(
        (
          await local.pool.query(
            'select * from website_intake_synthetic_events',
          )
        ).rows,
      ).toHaveLength(1)
    })
    it('executes the authenticated CRM API end to end and retains only test review rows across fresh loads', async () => {
      await capture()
      vi.stubGlobal('fetch', transport)
      const request = () =>
        new Request(origin + '/api/crm', {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: '{"action":"website-intake-pull"}',
        })
      const response = await crm(request(), deployment)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        queued: 1,
        acknowledged: 1,
        synthetic: true,
      })
      const first = await crm(new Request(origin + '/api/crm'), deployment)
      const loaded = await first.json()
      expect(loaded.records).toHaveLength(1)
      expect(loaded.records[0]).toMatchObject({
        kind: 'intake',
        ownerId,
        data: {
          status: 'test',
          sourceName: SOURCE,
          contactPermission: 'Unknown',
        },
      })
      platform.user = null
      expect(
        (await crm(new Request(origin + '/api/crm'), deployment)).status,
      ).toBe(401)
      platform.user = { id: ownerId }
      expect(
        (await (await crm(new Request(origin + '/api/crm'), deployment)).json())
          .records[0].id,
      ).toBe(loaded.records[0].id)
      expect(await counts()).toEqual([{ kind: 'intake', count: 1 }])
      expect(
        await pullWebsiteIntake(local.db, await owner(), key, transport),
      ).toEqual({ queued: 0, acknowledged: 0, synthetic: true })
    })
    it('recovers commit-before-ack failure without duplicate queue rows or lost source events', async () => {
      await capture()
      const failedAck: typeof fetch = async (req, init) =>
        String((req as Request).url).endsWith('/ack')
          ? Promise.reject(Error('Synthetic network interruption'))
          : transport(req, init)
      expect(
        await pullWebsiteIntake(local.db, await owner(), key, failedAck),
      ).toMatchObject({ queued: 1, acknowledged: 0, retryRequired: true })
      expect(
        (
          await local.pool.query(
            'select event_id from website_intake_synthetic_events where acknowledged_at is null',
          )
        ).rows,
      ).toHaveLength(1)
      expect(
        await pullWebsiteIntake(local.db, await owner(), key, transport),
      ).toEqual({ queued: 1, acknowledged: 1, synthetic: true })
      expect(await counts()).toEqual([{ kind: 'intake', count: 1 }])
    })
    it('rejects revoked, changed-email, viewer and contributor authority before fetching', async () => {
      const snapshot = await owner()
      for (const patch of [
        { active: false },
        { role: 'viewer' },
        { role: 'contributor' },
        { email: 'changed@intake.invalid' },
      ]) {
        await local.db
          .update(schema.members)
          .set({ ...snapshot, ...patch })
          .where(eq(schema.members.id, ownerId))
        let fetched = 0
        await expect(
          pullWebsiteIntake(local.db, snapshot, key, async () => {
            fetched++
            throw Error('Forbidden')
          }),
        ).rejects.toMatchObject({ status: 403 })
        expect(fetched).toBe(0)
      }
    })
    it('rechecks current authority under the queue lock after a successful source pull', async () => {
      await capture()
      const snapshot = await owner()
      const revoke: typeof fetch = async (req, init) => {
        const response = await transport(req, init)
        if ((req as Request).url.endsWith('/pull'))
          await local.db
            .update(schema.members)
            .set({ role: 'contributor' })
            .where(eq(schema.members.id, ownerId))
        return response
      }
      await expect(
        pullWebsiteIntake(local.db, snapshot, key, revoke),
      ).rejects.toMatchObject({ status: 403 })
      expect(await counts()).toEqual([])
      expect(
        (
          await local.pool.query(
            'select event_id from website_intake_synthetic_events where acknowledged_at is null',
          )
        ).rows,
      ).toHaveLength(1)
    })
    it('denies synthetic apply and permits deliberate exclusion with the actual reviewer audit', async () => {
      await capture()
      const actor = await owner()
      await pullWebsiteIntake(local.db, actor, key, transport)
      const [row] = await local.db.select().from(schema.records)
      await expect(
        handleFoundation(local.db, actor, {
          action: 'intake-review',
          id: row.id,
          revision: row.revision,
          decision: 'apply',
          reason: 'PILOT TEST apply denial',
        }),
      ).rejects.toThrow()
      await handleFoundation(local.db, actor, {
        action: 'intake-review',
        id: row.id,
        revision: row.revision,
        decision: 'exclude',
        reason: 'PILOT TEST reviewed and excluded',
      })
      const [reviewed] = await local.db.select().from(schema.records)
      expect(reviewed.data).toMatchObject({
        status: 'excluded',
        reviewedBy: ownerId,
      })
      expect(
        (await local.db.select().from(schema.audit)).every(
          (a) => a.actorId === ownerId,
        ),
      ).toBe(true)
      expect(await counts()).toEqual([{ kind: 'intake', count: 1 }])
    })
    it('rejects replayed nonce and incorrect acknowledgments without draining the outbox', async () => {
      await capture()
      const req = await signedRequest('pull', { limit: 20 }, key)
      expect((await producer(req.clone())).status).toBe(200)
      expect((await producer(req.clone())).status).toBe(409)
      const ack = await signedRequest(
        'ack',
        { events: [{ eventId: randomUUID(), payloadHash: 'a'.repeat(64) }] },
        key,
      )
      expect((await producer(ack)).status).toBe(409)
      expect(
        (
          await local.pool.query(
            'select event_id from website_intake_synthetic_events where acknowledged_at is null',
          )
        ).rows,
      ).toHaveLength(1)
    })
    it('enforces bounded capture rates and browser/RPC denials without expanding legacy grants', async () => {
      for (let index = 0; index < 20; index++)
        expect((await capture()).status).toBe(201)
      expect((await capture()).status).toBe(429)
      const rows = (
        await local.pool.query(
          "select relrowsecurity from pg_class where relname like 'website_intake_synthetic_%' and relkind='r'",
        )
      ).rows
      expect(rows).toHaveLength(3)
      expect(rows.every((row) => row.relrowsecurity)).toBe(true)
      const privileges = (
        await local.pool.query(
          "select has_table_privilege('anon','public.website_intake_synthetic_events','SELECT') as anon_read, has_table_privilege('authenticated','public.website_intake_synthetic_events','INSERT') as browser_write, has_function_privilege('anon','public.website_intake_synthetic_capture(uuid,jsonb,text)','EXECUTE') as anon_rpc",
        )
      ).rows[0]
      expect(privileges).toEqual({
        anon_read: false,
        browser_write: false,
        anon_rpc: false,
      })
      const servicePrivileges = (
        await local.pool.query(
          "select has_table_privilege('service_role','public.website_intake_synthetic_events','DELETE') as can_delete, has_table_privilege('service_role','public.website_intake_synthetic_events','TRUNCATE') as can_truncate, has_table_privilege('service_role','public.website_intake_synthetic_events','TRIGGER') as can_trigger, has_table_privilege('service_role','public.website_intake_synthetic_events','UPDATE') as broad_update, has_column_privilege('service_role','public.website_intake_synthetic_events','acknowledged_at','UPDATE') as can_ack",
        )
      ).rows[0]
      expect(servicePrivileges).toEqual({
        can_delete: false,
        can_truncate: false,
        can_trigger: false,
        broad_update: false,
        can_ack: true,
      })
      await expect(
        service.query('delete from public.website_intake_synthetic_events'),
      ).rejects.toThrow(/permission denied/)
      await expect(
        service.query('truncate public.website_intake_synthetic_events'),
      ).rejects.toThrow(/permission denied/)
      await expect(
        service.query(
          "update public.website_intake_synthetic_events set payload_hash=repeat('b',64)",
        ),
      ).rejects.toThrow(/permission denied/)
    })
  },
)
