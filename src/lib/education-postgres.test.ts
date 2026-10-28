// @vitest-environment node
// Local-only synthetic CRM/SQL rehearsal. No hosted database or receiver is used.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../../db/schema'
import { createLocalPostgres } from '../test/local-postgres'
import type { RecordData } from './crm-types'

const context = vi.hoisted(() => ({
  user: null as { id: string } | null,
  db: null as NodePgDatabase<typeof schema> | null,
  environment: {} as Record<string, string | undefined>,
  identities: {} as Record<
    string,
    { id: string; email: string; invitedAt: string; confirmedAt: string }
  >,
}))
function localDatabase() {
  if (!context.db)
    throw new Error('Local education SQL fixture not initialized')
  return context.db
}
vi.mock('@netlify/identity', () => ({
  getUser: async () => context.user,
  admin: {
    getUser: async (id: string) => {
      const account = context.identities[id]
      if (!account) throw new Error('Unexpected Identity lookup')
      return account
    },
  },
}))
vi.mock('../../db/index', () => ({ database: localDatabase }))
import handler from '../../netlify/functions/crm.mts'
import { dispatchEducation } from '../../netlify/functions/lib/education-clearance.mts'

const enabled = process.env.CRM_EDUCATION_POSTGRES_TEST === '1'
const ids = {
  owner: '80000000-0000-4000-8000-000000000001',
  hr: '80000000-0000-4000-8000-000000000002',
  manager: '80000000-0000-4000-8000-000000000003',
  viewer: '80000000-0000-4000-8000-000000000004',
  person: '81000000-0000-4000-8000-000000000001',
  application: '82000000-0000-4000-8000-000000000001',
  program: '83000000-0000-4000-8000-000000000001',
  intake: '88000000-0000-4000-8000-000000000001',
}
const fingerprint = 'a'.repeat(64)
const sourceKey = createHash('sha256')
  .update(JSON.stringify(['synthetic source', 'row-1']))
  .digest('hex')
const clearance = {
  identity_verified: true,
  onboarding_complete: true,
  agreements_complete: true,
  hr_approved: true,
}
const evidence = {
  identity_verified: 'SYNTHETIC identity evidence version 1',
  onboarding_complete: 'SYNTHETIC onboarding evidence version 1',
  agreements_complete: 'SYNTHETIC agreements evidence version 1',
  hr_approved: 'SYNTHETIC authorized HR review version 1',
}
let cluster: Awaited<ReturnType<typeof createLocalPostgres>> | undefined

async function advisoryWaiter() {
  if (!cluster) throw new Error('Local cluster not initialized')
  for (let attempt = 0; attempt < 50; attempt++) {
    const waiters = await cluster.pool.query<{ waiting: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND wait_event='advisory' AND query LIKE '%7031926%') AS waiting",
    )
    if (waiters.rows[0].waiting) return true
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  return false
}

function request(body: unknown, url = 'http://127.0.0.1:59111/api/crm') {
  return new Request(url, {
    method: 'POST',
    headers: {
      origin: new URL(url).origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}
const call = (body: unknown) => handler(request(body))
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
async function json(response: Response) {
  const value: unknown = await response.json()
  if (!object(value)) throw new Error('Expected an object response')
  return value
}
async function status() {
  const response = await call({
    action: 'education-status',
    applicationId: ids.application,
  })
  const value = await json(response)
  expect(response.status, JSON.stringify(value)).toBe(200)
  return value
}
function expected(state: Record<string, unknown>) {
  return {
    applicationRevision: state.applicationRevision,
    personRevision: state.personRevision,
    sourceFingerprint: state.sourceFingerprint,
    decisionVersion: state.decisionVersion,
  }
}
async function review(
  decision = 'cleared',
  overrides: Record<string, unknown> = {},
  state?: Record<string, unknown>,
) {
  return call({
    action: 'education-review',
    applicationId: ids.application,
    expected: expected(state || (await status())),
    decision,
    clearance,
    evidence,
    withdrawn: false,
    reason: 'SYNTHETIC current evidence reviewed',
    ...overrides,
  })
}
async function successfulReview(
  decision = 'cleared',
  overrides: Record<string, unknown> = {},
) {
  const response = await review(decision, overrides)
  const value = await json(response)
  expect(response.status, JSON.stringify(value)).toBe(200)
  return value
}
async function changeRecord(id: string, delta: RecordData) {
  const [record] = await localDatabase()
    .select()
    .from(schema.records)
    .where(eq(schema.records.id, id))
  expect(record).toBeDefined()
  await localDatabase()
    .update(schema.records)
    .set({
      data: { ...record.data, ...delta },
      revision: record.revision + 1,
    })
    .where(eq(schema.records.id, id))
}
const receiptFor = (
  rawBody: string,
  override: Record<string, unknown> = {},
) => {
  const parsed: unknown = JSON.parse(rawBody)
  if (!object(parsed)) throw new Error('Expected serialized decision object')
  return {
    success: true,
    environment: 'synthetic-local',
    event_id: parsed.event_id,
    result: 'accepted',
    received_at: new Date().toISOString(),
    current_status:
      parsed.decision === 'cleared' && parsed.withdrawn === false
        ? 'ready'
        : parsed.withdrawn === true || parsed.decision === 'revoked'
          ? 'withdrawn'
          : 'held',
    decision_version: parsed.decision_version,
    ...override,
  }
}

describe.skipIf(!enabled)(
  'education clearance API with a fresh isolated PostgreSQL cluster',
  () => {
    beforeAll(async () => {
      cluster = await createLocalPostgres('education')
      context.db = cluster.db
      vi.stubGlobal('Netlify', {
        env: { get: (key: string) => context.environment[key] },
      })
    }, 120000)
    beforeEach(async () => {
      if (!cluster) throw new Error('Local cluster not initialized')
      await cluster.pool.query(
        'TRUNCATE crm_education_outbox, crm_education_decisions, crm_audit, crm_records, crm_members, crm_settings CASCADE',
      )
      await localDatabase()
        .insert(schema.members)
        .values([
          {
            id: ids.owner,
            email: 'owner@education.invalid',
            name: 'SYNTHETIC owner',
            role: 'owner',
            active: true,
            commercial: true,
            hr: false,
          },
          {
            id: ids.hr,
            email: 'hr@education.invalid',
            name: 'SYNTHETIC HR',
            role: 'manager',
            active: true,
            commercial: false,
            hr: true,
          },
          {
            id: ids.manager,
            email: 'manager@education.invalid',
            name: 'SYNTHETIC sales manager',
            role: 'manager',
            active: true,
            commercial: true,
            hr: false,
          },
          {
            id: ids.viewer,
            email: 'viewer@education.invalid',
            name: 'SYNTHETIC HR viewer',
            role: 'viewer',
            active: true,
            commercial: false,
            hr: true,
          },
        ])
      await localDatabase()
        .insert(schema.records)
        .values([
          {
            id: ids.person,
            kind: 'contact',
            title: 'SYNTHETIC education person',
            access: 'hr',
            ownerId: ids.owner,
            data: {
              email: 'learner-b@epdg.invalid',
              educationFixture: true,
              contactPermission: 'Do not contact',
              suppressed: true,
            },
          },
          {
            id: ids.program,
            kind: 'organization',
            title: 'SYNTHETIC education program',
            access: 'hr',
            ownerId: ids.owner,
            data: { educationFixture: true, educationProgram: true },
          },
          {
            id: ids.application,
            kind: 'application',
            title: 'SYNTHETIC education application',
            access: 'hr',
            ownerId: ids.owner,
            sourceKey,
            data: {
              workflow: 'program',
              personId: ids.person,
              crmProgramId: ids.program,
              educationFixture: true,
              stage: 'Active',
              onboardingStatus: 'Source says complete',
            },
          },
          {
            id: ids.intake,
            kind: 'intake',
            title: 'SYNTHETIC education intake',
            access: 'hr',
            ownerId: ids.owner,
            sourceKey,
            data: {
              workflow: 'program',
              status: 'applied',
              caseId: ids.application,
              personId: ids.person,
              sourceName: 'SYNTHETIC source',
              sourceId: 'row-1',
              sourceVersion: 'v1',
              sourceFingerprint: fingerprint,
              sourceChanged: false,
            },
          },
        ])
      context.user = { id: ids.owner }
      context.identities = {
        [ids.hr]: {
          id: ids.hr,
          email: 'hr@education.invalid',
          invitedAt: '2026-01-01T00:00:00.000Z',
          confirmedAt: '2026-01-01T00:00:00.000Z',
        },
      }
      context.environment = {
        CRM_SYNTHETIC_EDUCATION_ENABLED: '1',
        CRM_EDUCATION_ENVIRONMENT: 'synthetic-local',
      }
    })
    afterAll(async () => {
      context.db = null
      await cluster?.stop()
      vi.unstubAllGlobals()
    }, 60000)

    it('starts after an operator-verified receiver floor without fabricating earlier CRM decisions', async () => {
      await localDatabase()
        .insert(schema.educationReceiverCheckpoints)
        .values({
          applicationId: ids.application,
          receiverVersion: 9,
          target: 'http://127.0.0.1:58000/internal/crm/onboarding-handoffs',
          observedAt: new Date(),
          stateHash: 'b'.repeat(64),
          source: 'verified-local-epdg',
        })
      const initial = await status()
      expect(initial.current).toBe(null)
      expect(initial.decisionVersion).toBe(9)
      expect(
        await localDatabase().select().from(schema.educationDecisions),
      ).toHaveLength(0)
      const reviewed = await successfulReview()
      expect(reviewed.decisionVersion).toBe(10)
      const decisions = await localDatabase()
        .select()
        .from(schema.educationDecisions)
      expect(decisions).toHaveLength(1)
      expect(decisions[0].decisionVersion).toBe(10)
      await expect(
        localDatabase()
          .update(schema.educationReceiverCheckpoints)
          .set({ receiverVersion: 20 }),
      ).rejects.toThrow()
    })
    it.each([
      { target: 'http://localhost:58000/internal/crm/onboarding-handoffs' },
      { source: 'browser-asserted' },
      { stateHash: 'not-a-verified-hash' },
      { receiverVersion: -1 },
      { receiverVersion: 1000001 },
      { observedAt: new Date(Date.now() - 600000) },
    ])(
      'rejects invalid operator receiver checkpoint metadata: %j',
      async (change) => {
        await expect(
          localDatabase()
            .insert(schema.educationReceiverCheckpoints)
            .values({
              applicationId: ids.application,
              receiverVersion: 9,
              target: 'http://127.0.0.1:58000/internal/crm/onboarding-handoffs',
              observedAt: new Date(),
              stateHash: 'b'.repeat(64),
              source: 'verified-local-epdg',
              ...change,
            }),
        ).rejects.toThrow()
        expect((await status()).decisionVersion).toBe(0)
      },
    )
    it('rejects checkpoint bootstrapping after an actual CRM decision exists', async () => {
      expect((await successfulReview()).decisionVersion).toBe(1)
      await expect(
        localDatabase()
          .insert(schema.educationReceiverCheckpoints)
          .values({
            applicationId: ids.application,
            receiverVersion: 9,
            target: 'http://127.0.0.1:58000/internal/crm/onboarding-handoffs',
            observedAt: new Date(),
            stateHash: 'b'.repeat(64),
            source: 'verified-local-epdg',
          }),
      ).rejects.toThrow()
      expect((await status()).decisionVersion).toBe(1)
    })

    it('fails closed when default-off, hosted or non-loopback and stores no decision', async () => {
      for (const environment of [
        {},
        {
          CRM_SYNTHETIC_EDUCATION_ENABLED: '1',
          CRM_EDUCATION_ENVIRONMENT: 'production',
        },
        {
          CRM_SYNTHETIC_EDUCATION_ENABLED: '1',
          CRM_EDUCATION_ENVIRONMENT: 'synthetic-local',
          SITE_ID: 'synthetic-hosted-site',
        },
      ]) {
        context.environment = environment
        expect(
          (
            await call({
              action: 'education-status',
              applicationId: ids.application,
            })
          ).status,
        ).not.toBe(200)
      }
      context.environment = {
        CRM_SYNTHETIC_EDUCATION_ENABLED: '1',
        CRM_EDUCATION_ENVIRONMENT: 'synthetic-local',
      }
      const response = await handler(
        request(
          { action: 'education-status', applicationId: ids.application },
          'https://crm-rehearsal.invalid/api/crm',
        ),
      )
      expect(response.status).not.toBe(200)
      expect(
        await localDatabase().select().from(schema.educationDecisions),
      ).toEqual([])
    })

    it.each(['manager', 'viewer'] as const)(
      'does not let an active %s clear an application',
      async (role) => {
        const state = await status()
        context.user = { id: ids[role] }
        const response = await review('cleared', {}, state)
        expect(response.status).toBe(403)
        expect(
          await localDatabase().select().from(schema.educationDecisions),
        ).toEqual([])
      },
    )

    it('requires structured clearance evidence, independently of stage, training and marketing status', async () => {
      for (const key of Object.keys(clearance)) {
        const response = await review('cleared', {
          clearance: { ...clearance, [key]: false },
        })
        expect(response.status).toBe(400)
      }
      expect(
        (
          await review('cleared', {
            evidence: { ...evidence, hr_approved: '' },
          })
        ).status,
      ).toBe(400)
      expect((await review('cleared', { clearance: 'Active' })).status).toBe(
        400,
      )
      expect(
        await localDatabase().select().from(schema.educationDecisions),
      ).toEqual([])
      const result = await successfulReview()
      expect(result.decisionVersion).toBe(1)
      const [person] = await localDatabase()
        .select()
        .from(schema.records)
        .where(eq(schema.records.id, ids.person))
      expect(person.data.contactPermission).toBe('Do not contact')
      expect(person.data.suppressed).toBe(true)
    })

    it('server-stamps immutable decisions, criterion evidence and exact minimal outbox bytes', async () => {
      const forged = await review('cleared', {
        reviewerId: ids.manager,
        issuedAt: '2000-01-01T00:00:00.000Z',
      })
      expect(forged.status).toBe(400)
      const result = await successfulReview()
      expect(result.decisionVersion).toBe(1)
      const [decision] = await localDatabase()
        .select()
        .from(schema.educationDecisions)
      const [outbox] = await localDatabase()
        .select()
        .from(schema.educationOutbox)
      expect(decision.reviewerId).toBe(ids.owner)
      expect(decision.issuedAt.toISOString()).not.toBe(
        '2000-01-01T00:00:00.000Z',
      )
      expect(decision.clearance).toEqual(clearance)
      expect(decision.evidence).toEqual(evidence)
      for (const key of Object.keys(clearance) as (keyof typeof clearance)[]) {
        expect(decision.criterionReviews[key]).toEqual({
          value: true,
          reviewerId: ids.owner,
          reviewedAt: decision.issuedAt.toISOString(),
          evidence: evidence[key],
        })
      }
      expect(outbox.bodyHash).toBe(
        createHash('sha256').update(outbox.rawBody, 'utf8').digest('hex'),
      )
      const payload: unknown = JSON.parse(outbox.rawBody)
      expect(payload).toEqual({
        version: 1,
        source: 'emerson-crm-synthetic',
        environment: 'synthetic-local',
        event_id: outbox.eventId,
        person_id: ids.person,
        application_id: ids.application,
        program_id: ids.program,
        decision_id: decision.id,
        decision_version: 1,
        decision: 'cleared',
        issued_at: decision.issuedAt.toISOString(),
        policy_version: 'synthetic-onboarding-v1',
        reviewer_id: ids.owner,
        clearance,
        withdrawn: false,
      })
      for (const privateValue of Object.values(evidence))
        expect(outbox.rawBody).not.toContain(privateValue)
      expect(outbox.rawBody).not.toContain('learner-b@epdg.invalid')
      expect(cluster).toBeDefined()
      await expect(
        cluster!.pool.query(
          'UPDATE crm_education_decisions SET reason=$1 WHERE id=$2',
          ['forged', decision.id],
        ),
      ).rejects.toThrow()
      await expect(
        cluster!.pool.query('DELETE FROM crm_education_decisions WHERE id=$1', [
          decision.id,
        ]),
      ).rejects.toThrow()
      await expect(
        cluster!.pool.query(
          'UPDATE crm_education_outbox SET raw_body=$1 WHERE id=$2',
          ['{}', outbox.id],
        ),
      ).rejects.toThrow()
      await expect(
        cluster!.pool.query('DELETE FROM crm_education_outbox WHERE id=$1', [
          outbox.id,
        ]),
      ).rejects.toThrow()
      const retained = await localDatabase()
        .select()
        .from(schema.educationDecisions)
      expect(retained).toEqual([decision])
    })

    it('rejects stale expected revisions and concurrent decisions rather than duplicating version one', async () => {
      const state = await status()
      const stale = await review(
        'cleared',
        {
          expected: {
            ...expected(state),
            personRevision: Number(state.personRevision) + 1,
          },
        },
        state,
      )
      expect(stale.status).toBe(409)
      const concurrent = await Promise.all([
        review('cleared', {}, state),
        review('held', {}, state),
      ])
      expect(concurrent.map((response) => response.status).sort()).toEqual([
        200, 409,
      ])
      const stream = await localDatabase()
        .select()
        .from(schema.educationDecisions)
      expect(stream).toHaveLength(1)
      expect(stream[0].decisionVersion).toBe(1)
    })

    it.each([
      ['application', { sourceHold: true }],
      ['person', { identityHold: true }],
      ['intake', { sourceChanged: true, sourceVersion: 'changed-v2' }],
    ] as const)(
      'invalidates prior clearance when current %s evidence changes',
      async (record, delta) => {
        await successfulReview()
        await changeRecord(ids[record], delta)
        const state = await status()
        expect(state.holds).not.toEqual([])
        const current = state.current
        expect(object(current)).toBe(true)
        if (object(current)) expect(current.decision).not.toBe('cleared')
        const calls: string[] = []
        await dispatchEducation(
          localDatabase(),
          ids.owner,
          ids.application,
          async (rawBody: string) => {
            calls.push(rawBody)
            return receiptFor(rawBody)
          },
        )
        expect(
          calls.every(
            (raw) =>
              (JSON.parse(raw) as Record<string, unknown>).decision !==
              'cleared',
          ),
        ).toBe(true)
        expect(
          (await localDatabase().select().from(schema.educationDecisions))[0]
            .decision,
        ).toBe('cleared')
      },
    )

    it('does not keep an old clearance effective after its reviewer becomes inactive or loses HR authority', async () => {
      context.user = { id: ids.hr }
      await successfulReview()
      await localDatabase()
        .update(schema.members)
        .set({ hr: false })
        .where(eq(schema.members.id, ids.hr))
      context.user = { id: ids.owner }
      let state = await status()
      expect(object(state.current) && state.current.decision).toBe('held')
      expect(state.decisionVersion).toBe(2)
      const newer = await successfulReview('revoked')
      expect(Number(newer.decisionVersion)).toBeGreaterThan(1)
      context.user = { id: ids.hr }
      expect((await review('cleared', {}, newer)).status).toBe(403)
      context.user = { id: ids.owner }
      await localDatabase()
        .update(schema.members)
        .set({ active: false })
        .where(eq(schema.members.id, ids.hr))
      state = await status()
      expect(object(state.current) && state.current.decision).toBe('revoked')
    })

    it.each(['application', 'person'] as const)(
      'preserves server-only education mappings after an ordinary %s API edit and queues a current hold',
      async (kind) => {
        await successfulReview()
        const [before] = await localDatabase()
          .select()
          .from(schema.records)
          .where(eq(schema.records.id, ids[kind]))
        const response = await call({
          action: 'foundation-save',
          record: {
            id: before.id,
            kind: before.kind,
            title: before.title,
            revision: before.revision,
            access: 'hr',
            ownerId: ids.owner,
            data: {
              ...before.data,
              notes: 'SYNTHETIC ordinary edit requires fresh review',
              nextAction: 'Review revised synthetic evidence',
              nextDue: '2027-02-01T16:00:00Z',
            },
          },
        })
        expect(response.status, await response.text()).toBe(200)
        const [after] = await localDatabase()
          .select()
          .from(schema.records)
          .where(eq(schema.records.id, ids[kind]))
        expect(after.data.educationFixture).toBe(true)
        if (kind === 'application')
          expect(after.data.crmProgramId).toBe(ids.program)
        const state = await status()
        expect(object(state.current) && state.current.decision).toBe('held')
        expect(Number(state.decisionVersion)).toBeGreaterThan(1)
        const queued = await localDatabase()
          .select()
          .from(schema.educationOutbox)
        expect(
          queued.find((entry) => entry.decisionVersion === 1)?.status,
        ).toBe('superseded')
        expect(
          queued.some(
            (entry) => entry.decision === 'held' && entry.status === 'pending',
          ),
        ).toBe(true)
      },
    )

    it('records an observed changed applied source as a current education hold without replacing its historical receipt', async () => {
      await successfulReview()
      const [receipt] = await localDatabase()
        .select()
        .from(schema.records)
        .where(eq(schema.records.id, ids.intake))
      const observation = {
        action: 'intake-preview',
        sourceName: 'SYNTHETIC source',
        workflow: 'program',
        rows: [
          {
            sourceId: 'earlier-row-must-not-save',
            sourceVersion: 'v1',
            name: 'SYNTHETIC earlier row',
            email: 'earlier@epdg.invalid',
            nextAction: 'SYNTHETIC earlier row review',
            nextDue: '2027-02-01T16:00:00Z',
          },
          {
            sourceId: 'row-1',
            sourceVersion: 'v2',
            name: 'SYNTHETIC education person',
            email: 'learner-b@epdg.invalid',
            cohort: 'SYNTHETIC revised cohort',
            nextAction: 'Review changed synthetic source',
            nextDue: '2027-02-01T16:00:00Z',
          },
        ],
      }
      const response = await call(observation)
      expect(response.status).toBe(409)
      const [retained] = await localDatabase()
        .select()
        .from(schema.records)
        .where(eq(schema.records.id, ids.intake))
      expect(retained.data.status).toBe('applied')
      expect(retained.data.sourceVersion).toBe(receipt.data.sourceVersion)
      expect(retained.data.sourceFingerprint).toBe(
        receipt.data.sourceFingerprint,
      )
      expect(retained.data.reviewedAt).toBe(receipt.data.reviewedAt)
      expect(retained).toEqual(receipt)
      expect(await localDatabase().select().from(schema.records)).toHaveLength(
        4,
      )
      const state = await status()
      expect(object(state.current) && state.current.decision).toBe('held')
      expect(Number(state.decisionVersion)).toBeGreaterThan(1)
      const observations = (
        await localDatabase().select().from(schema.audit)
      ).filter((entry) => entry.action === 'intake resolved source changed')
      expect(observations).toHaveLength(1)
      expect(observations[0].recordId).toBe(ids.intake)
      expect(JSON.stringify(observations[0].after)).not.toContain(
        'learner-b@epdg.invalid',
      )
      expect((await call(observation)).status).toBe(409)
      expect(
        (await localDatabase().select().from(schema.audit)).filter(
          (entry) => entry.action === 'intake resolved source changed',
        ),
      ).toHaveLength(1)
      expect((await status()).decisionVersion).toBe(state.decisionVersion)
    })

    it('requires an explicit authorized withdrawal restoration and never infers it from stage Active', async () => {
      await successfulReview('held', { withdrawn: true })
      expect((await review('cleared')).status).toBe(409)
      const restored = await successfulReview('cleared', {
        restoreWithdrawal: true,
      })
      expect(object(restored.current) && restored.current.withdrawn).toBe(false)
      expect(object(restored.current) && restored.current.decision).toBe(
        'cleared',
      )
    })

    it('durably retries the exact original outbox bytes after a transport failure', async () => {
      await successfulReview()
      const bodies: string[] = []
      await dispatchEducation(
        localDatabase(),
        ids.owner,
        ids.application,
        async (rawBody: string) => {
          bodies.push(rawBody)
          throw new Error('SYNTHETIC receiver unavailable')
        },
      )
      const [failed] = await localDatabase()
        .select()
        .from(schema.educationOutbox)
      expect(failed.attempts).toBe(1)
      expect(failed.status).toBe('failed')
      expect(failed.lastError).toBe('dispatch_failed')
      await dispatchEducation(
        localDatabase(),
        ids.owner,
        ids.application,
        async (rawBody: string) => {
          bodies.push(rawBody)
          return receiptFor(rawBody, { result: 'duplicate' })
        },
      )
      expect(bodies).toEqual([failed.rawBody, failed.rawBody])
      const [sent] = await localDatabase().select().from(schema.educationOutbox)
      expect(sent.eventId).toBe(failed.eventId)
      expect(sent.bodyHash).toBe(failed.bodyHash)
      expect(sent.attempts).toBe(2)
      expect(sent.status).toBe('delivered')
      expect(sent.receipt).toMatchObject({
        result: 'duplicate',
        current_status: 'ready',
        decision_version: 1,
      })
    })

    it('supersedes an undelivered clear when revoked and rejects stale receiver acknowledgments', async () => {
      await successfulReview()
      const [oldClear] = await localDatabase()
        .select()
        .from(schema.educationOutbox)
      await successfulReview('revoked', { withdrawn: true })
      const bodies: string[] = []
      await dispatchEducation(
        localDatabase(),
        ids.owner,
        ids.application,
        async (rawBody: string) => {
          bodies.push(rawBody)
          return receiptFor(rawBody, {
            decision_version: 1,
            current_status: 'ready',
          })
        },
      )
      expect(bodies).toHaveLength(1)
      expect(bodies[0]).not.toBe(oldClear.rawBody)
      expect(JSON.parse(bodies[0])).toMatchObject({
        decision: 'revoked',
        decision_version: 2,
        withdrawn: true,
      })
      const failedReceipt = await localDatabase()
        .select()
        .from(schema.educationOutbox)
      expect(
        failedReceipt.find((entry) => entry.decisionVersion === 2),
      ).toMatchObject({
        status: 'failed',
        receipt: null,
        lastError: 'dispatch_failed',
      })
      expect(
        failedReceipt.find((entry) => entry.decisionVersion === 1),
      ).toMatchObject({ status: 'superseded' })
      await dispatchEducation(
        localDatabase(),
        ids.owner,
        ids.application,
        async (rawBody: string) => receiptFor(rawBody),
      )
      const state = await status()
      expect(object(state.current) && state.current.decision).toBe('revoked')
      expect(object(state.current) && state.current.withdrawn).toBe(true)
      const people = await localDatabase().select().from(schema.members)
      expect(people).toHaveLength(4)
    })

    it('serializes dispatch and revocation so a completed clear attempt cannot overwrite the newer decision', async () => {
      const cleared = await successfulReview()
      let notifyEntered: () => void = () => {}
      let releaseReceipt: () => void = () => {}
      const entered = new Promise<void>((resolve) => {
        notifyEntered = resolve
      })
      const released = new Promise<void>((resolve) => {
        releaseReceipt = resolve
      })
      const dispatch = dispatchEducation(
        localDatabase(),
        ids.owner,
        ids.application,
        async (rawBody: string) => {
          notifyEntered()
          await released
          return receiptFor(rawBody)
        },
      )
      await entered
      const revocation = review('revoked', { withdrawn: true }, cleared)
      releaseReceipt()
      await dispatch
      const response = await revocation
      expect(response.status).toBe(200)
      const state = await status()
      expect(state.decisionVersion).toBe(2)
      expect(object(state.current) && state.current.decision).toBe('revoked')
      expect(object(state.current) && state.current.withdrawn).toBe(true)
      const delivered: string[] = []
      await dispatchEducation(
        localDatabase(),
        ids.owner,
        ids.application,
        async (rawBody: string) => {
          delivered.push(rawBody)
          return receiptFor(rawBody)
        },
      )
      expect(delivered).toHaveLength(1)
      expect(JSON.parse(delivered[0])).toMatchObject({
        decision: 'revoked',
        decision_version: 2,
      })
    })

    it('serializes an actual staff HR-permission removal with an in-flight dispatch and invalidates the earlier reviewer', async () => {
      context.user = { id: ids.hr }
      await successfulReview()
      let notifyEntered: () => void = () => {}
      let releaseReceipt: () => void = () => {}
      const entered = new Promise<void>((resolve) => {
        notifyEntered = resolve
      })
      const released = new Promise<void>((resolve) => {
        releaseReceipt = resolve
      })
      const dispatch = dispatchEducation(
        localDatabase(),
        ids.hr,
        ids.application,
        async (rawBody: string) => {
          notifyEntered()
          await released
          return receiptFor(rawBody)
        },
      )
      await entered
      context.user = { id: ids.owner }
      const removal = call({
        action: 'staff',
        id: ids.hr,
        email: 'hr@education.invalid',
        name: 'SYNTHETIC HR',
        role: 'manager',
        active: true,
        commercial: false,
        hr: false,
      })
      let observedWait: boolean
      try {
        observedWait = await advisoryWaiter()
      } finally {
        releaseReceipt()
      }
      const [, response] = await Promise.all([dispatch, removal])
      expect(observedWait).toBe(true)
      expect(response.status, await response.text()).toBe(200)
      const [formerReviewer] = await localDatabase()
        .select()
        .from(schema.members)
        .where(eq(schema.members.id, ids.hr))
      expect(formerReviewer.hr).toBe(false)
      const current = await status()
      expect(object(current.current) && current.current.decision).toBe('held')
      expect(current.decisionVersion).toBe(2)
      const sent: string[] = []
      await dispatchEducation(
        localDatabase(),
        ids.owner,
        ids.application,
        async (rawBody: string) => {
          sent.push(rawBody)
          return receiptFor(rawBody)
        },
      )
      expect(sent).toHaveLength(1)
      expect(JSON.parse(sent[0])).toMatchObject({
        decision: 'held',
        decision_version: 2,
      })
    })

    it('rechecks owner authority after waiting for the staff-write lock', async () => {
      let notifyLocked: () => void = () => {}
      let releaseLock: () => void = () => {}
      const locked = new Promise<void>((resolve) => {
        notifyLocked = resolve
      })
      const released = new Promise<void>((resolve) => {
        releaseLock = resolve
      })
      const authorityChange = localDatabase().transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7031926)`)
        notifyLocked()
        await released
        await tx
          .update(schema.members)
          .set({ role: 'manager', hr: false })
          .where(eq(schema.members.id, ids.owner))
      })
      await locked
      const staffWrite = call({
        action: 'staff',
        id: ids.hr,
        email: 'hr@education.invalid',
        name: 'SYNTHETIC HR',
        role: 'manager',
        active: true,
        commercial: false,
        hr: false,
      })
      let observedWait: boolean
      try {
        observedWait = await advisoryWaiter()
      } finally {
        releaseLock()
      }
      const [, response] = await Promise.all([authorityChange, staffWrite])
      expect(observedWait).toBe(true)
      expect(response.status).toBe(403)
      const [retained] = await localDatabase()
        .select()
        .from(schema.members)
        .where(eq(schema.members.id, ids.hr))
      expect(retained.hr).toBe(true)
      expect(await localDatabase().select().from(schema.audit)).toEqual([])
    })
  },
)
