// @vitest-environment node
// Fresh loopback-only SQL cluster and mocked platform Identity/context. No hosted
// DB, operational key, email, actual staff record or receiver is read or used.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { eq, sql } from 'drizzle-orm'
import type { Context } from '@netlify/functions'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../../db/schema'
import { createLocalPostgres } from '../test/local-postgres'

const context = vi.hoisted(() => ({
  user: null as { id: string } | null,
  db: null as NodePgDatabase<typeof schema> | null,
  environment: {} as Record<string, string | undefined>,
  identities: {} as Record<string, boolean>,
  reviewerIdentities: [
    {
      memberId: '90000000-0000-4000-8000-000000000002',
      email: 'reviewer@emerson.example',
    },
    {
      memberId: '90000000-0000-4000-8000-000000000003',
      email: 'second@emerson.example',
    },
  ],
  profile: {
    version: 1,
    enabled: true,
    environment: 'synthetic-hosted',
    siteId: 'c83673f3-4449-4ede-b336-33bb3d816de8',
    crmOrigin: 'https://crm.example.test',
    backendOrigin: 'https://epdg.example.test',
    databaseName: 'postgres',
    databaseIdentity: '90000000-0000-4000-8000-000000000001',
    fixtureSourceKey: 'epdg-hosted-synthetic:sql-fixture',
    reviewers: [
      {
        memberIdSha256:
          '209e26e91657a464d6c7022f02c59b7212fe51c2d8721b95d35cad96986356b7',
        identitySha256:
          'ebf9742eada246c3d03936390ea54c3a4eae06c5f5c18c275196a037e7def17b',
      },
      {
        memberIdSha256:
          '2a81eccdac2548a42e41b8ae02d0619fc7fa6663c3e6d641c1707b71e141aaf1',
        identitySha256:
          'c07cc18646044a5ec2a033eab9167fc3aa3694496070ff618703e14baae1aaad',
      },
    ],
  },
}))
vi.mock('@netlify/identity', () => ({
  getUser: async () => context.user,
  admin: {
    getUser: async (id: string) => {
      const reviewer = context.reviewerIdentities.find((r) => r.memberId === id)
      if (!reviewer || !context.identities[id])
        throw new Error('Current identity unavailable')
      return {
        id,
        email: reviewer.email,
        confirmedAt: '2026-01-01T00:00:00.000Z',
        invitedAt: '2026-01-01T00:00:00.000Z',
      }
    },
  },
}))
vi.mock('../../db/index', () => ({
  database: () => {
    if (!context.db) throw new Error('Fresh SQL fixture missing')
    return context.db
  },
}))
vi.mock('../../netlify/functions/lib/education-hosted-profile.json', () => ({
  default: context.profile,
}))
import handler from '../../netlify/functions/crm.mts'
import { createHostedEducationPolicy } from '../../netlify/functions/lib/education-hosted-policy.mts'
import {
  hostedReviewerIdSha256,
  hostedReviewerIdentitySha256,
  parseHostedEducationProfile,
} from '../../netlify/functions/lib/education-hosted.mts'
import {
  dispatchEducation,
  getEducationStatus,
} from '../../netlify/functions/lib/education-clearance.mts'
const enabled = process.env.CRM_EDUCATION_HOSTED_POSTGRES_TEST === '1'
const ids = {
  actor: '90000000-0000-4000-8000-000000000002',
  second: '90000000-0000-4000-8000-000000000003',
  viewer: '90000000-0000-4000-8000-000000000004',
  person: '81000000-0000-4000-8000-000000000001',
  application: '82000000-0000-4000-8000-000000000001',
  program: '83000000-0000-4000-8000-000000000001',
  intake: '88000000-0000-4000-8000-000000000001',
}
const fingerprint = 'a'.repeat(64)
const clearance = {
  identity_verified: true,
  onboarding_complete: true,
  agreements_complete: true,
  hr_approved: true,
}
const evidence = {
  identity_verified: 'SYNTHETIC current identity evidence',
  onboarding_complete: 'SYNTHETIC current onboarding evidence',
  agreements_complete: 'SYNTHETIC current agreement evidence',
  hr_approved: 'SYNTHETIC current HR evidence',
}
const platform = {
  site: { id: context.profile.siteId },
  deploy: { id: '6adcc1b33195872cc470df71', context: 'production' },
} as unknown as Context
const profile = () => parseHostedEducationProfile(context.profile)
const policy = () =>
  createHostedEducationPolicy(
    profile(),
    async (member) => context.identities[member.id] === true,
  )
const observation = (overrides: Record<string, unknown> = {}) =>
  db()
    .insert(schema.educationHostedObservations)
    .values({
      identityId: context.profile.databaseIdentity,
      applicationId: ids.application,
      receiverVersion: 0,
      target:
        context.profile.backendOrigin + '/internal/crm/onboarding-handoffs',
      observedAt: new Date(),
      stateHash: createHash('sha256')
        .update('SYNTHETIC empty receiver')
        .digest('hex'),
      source: 'verified-hosted-epdg',
      evidenceSource: 'operator-receiver-observation:isolated-sql-fixture',
      ...overrides,
    })
let cluster: Awaited<ReturnType<typeof createLocalPostgres>> | undefined
function db() {
  if (!context.db) throw new Error('No isolated SQL fixture')
  return context.db
}
function request(body: unknown, origin = context.profile.crmOrigin) {
  return new Request(origin + '/api/crm', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const call = (body: unknown, ctx: Context | undefined = platform) =>
  handler(request(body), ctx)
async function read(response: Response) {
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Expected object response')
  return body as Record<string, unknown>
}
async function state() {
  const response = await call({
    action: 'education-status',
    applicationId: ids.application,
  })
  const body = await read(response)
  expect(response.status, JSON.stringify(body)).toBe(200)
  return body
}
async function review(overrides: Record<string, unknown> = {}) {
  const current = await state()
  return call({
    action: 'education-review',
    applicationId: ids.application,
    expected: {
      applicationRevision: current.applicationRevision,
      personRevision: current.personRevision,
      sourceFingerprint: current.sourceFingerprint,
      decisionVersion: current.decisionVersion,
    },
    decision: 'cleared',
    clearance,
    evidence,
    withdrawn: false,
    reason: 'SYNTHETIC fresh hosted review',
    ...overrides,
  })
}
const receipt = (raw: string) => {
  const body = JSON.parse(raw) as Record<string, unknown>
  return {
    success: true,
    environment: 'synthetic-hosted',
    event_id: body.event_id,
    result: 'accepted',
    received_at: new Date().toISOString(),
    current_status:
      body.withdrawn || body.decision === 'revoked'
        ? 'withdrawn'
        : body.decision === 'cleared'
          ? 'ready'
          : 'held',
    decision_version: body.decision_version,
  }
}

describe.skipIf(!enabled)(
  'hosted policy against fresh isolated CRM SQL',
  () => {
    beforeAll(async () => {
      cluster = await createLocalPostgres('hosted-education')
      context.db = cluster.db
      vi.stubGlobal('Netlify', {
        env: { get: (name: string) => context.environment[name] },
      })
    }, 120000)
    beforeEach(async () => {
      if (!cluster) throw new Error('No fresh cluster')
      await cluster.pool.query(
        'TRUNCATE crm_education_hosted_observations,crm_education_hosted_identity,crm_education_outbox,crm_education_decisions,crm_education_receiver_checkpoints,crm_audit,crm_records,crm_members,crm_settings CASCADE',
      )
      await db()
        .insert(schema.members)
        .values([
          {
            id: ids.actor,
            email: 'reviewer@emerson.example',
            name: 'SYNTHETIC reviewer',
            role: 'manager',
            active: true,
            hr: true,
          },
          {
            id: ids.second,
            email: 'second@emerson.example',
            name: 'SYNTHETIC second reviewer',
            role: 'contributor',
            active: true,
            hr: true,
          },
          {
            id: ids.viewer,
            email: 'viewer@emerson.example',
            name: 'SYNTHETIC viewer',
            role: 'viewer',
            active: true,
            hr: true,
          },
        ])
      await db()
        .insert(schema.records)
        .values([
          {
            id: ids.person,
            kind: 'contact',
            title: 'SYNTHETIC hosted person',
            access: 'hr',
            ownerId: ids.actor,
            data: {
              educationFixture: true,
              email: 'learner-b@epdg.invalid',
              contactPermission: 'Do not contact',
              suppressed: true,
            },
          },
          {
            id: ids.program,
            kind: 'organization',
            title: 'SYNTHETIC hosted program',
            access: 'hr',
            ownerId: ids.actor,
            data: { educationFixture: true, educationProgram: true },
          },
          {
            id: ids.application,
            kind: 'application',
            title: 'SYNTHETIC hosted application',
            access: 'hr',
            ownerId: ids.actor,
            sourceKey: context.profile.fixtureSourceKey,
            data: {
              workflow: 'program',
              educationFixture: true,
              personId: ids.person,
              crmProgramId: ids.program,
              stage: 'Active',
            },
          },
          {
            id: ids.intake,
            kind: 'intake',
            title: 'SYNTHETIC hosted intake',
            access: 'hr',
            ownerId: ids.actor,
            sourceKey: context.profile.fixtureSourceKey,
            data: {
              workflow: 'program',
              educationFixture: true,
              status: 'applied',
              caseId: ids.application,
              personId: ids.person,
              sourceName: 'SYNTHETIC source',
              sourceId: 'unit-row',
              sourceVersion: 'v1',
              sourceFingerprint: fingerprint,
            },
          },
        ])
      await db()
        .insert(schema.educationHostedIdentity)
        .values({
          id: context.profile.databaseIdentity,
          siteId: context.profile.siteId,
          databaseName: 'postgres',
          crmOrigin: context.profile.crmOrigin,
          backendOrigin: context.profile.backendOrigin,
          applicationId: ids.application,
          personId: ids.person,
          programId: ids.program,
          sourceKey: context.profile.fixtureSourceKey,
          reviewerIds: [ids.actor, ids.second],
          syntheticOnly: true,
        })
      await observation()
      context.environment = {
        CRM_HOSTED_EDUCATION_ENABLED: '1',
        CRM_EDUCATION_ENVIRONMENT: 'synthetic-hosted',
      }
      context.user = { id: ids.actor }
      context.identities = { [ids.actor]: true, [ids.second]: true }
    })
    afterAll(async () => {
      context.db = null
      await cluster?.stop()
      vi.unstubAllGlobals()
    }, 60000)
    it('rejects unsigned actors wrong cloud context and non-HR/viewer membership', async () => {
      const body = {
        action: 'education-status',
        applicationId: ids.application,
      }
      context.user = null
      expect((await call(body)).status).toBe(401)
      context.user = { id: ids.actor }
      expect((await handler(request(body))).status).toBe(403)
      expect(
        (
          await handler(request(body), {
            ...platform,
            deploy: { ...platform.deploy, context: 'deploy-preview' },
          } as Context)
        ).status,
      ).toBe(403)
      context.user = { id: ids.viewer }
      expect((await call(body)).status).toBe(403)
      context.user = { id: ids.actor }
      await db()
        .update(schema.members)
        .set({ hr: false })
        .where(eq(schema.members.id, ids.actor))
      expect((await call(body)).status).toBe(403)
    })
    it('requires current confirmed Identity in addition to cached authentication and HR membership', async () => {
      context.identities[ids.actor] = false
      expect(
        (
          await call({
            action: 'education-status',
            applicationId: ids.application,
          })
        ).status,
      ).toBe(403)
      expect(await db().select().from(schema.educationDecisions)).toEqual([])
      context.identities[ids.actor] = true
      expect((await review()).status).toBe(200)
      context.identities[ids.actor] = false
      context.user = { id: ids.second }
      const s = await state()
      expect((s.current as Record<string, unknown>).decision).toBe('held')
      expect((s.current as Record<string, unknown>).reason).toContain(
        'reviewer_authority_changed',
      )
    })
    it('requires exact database marker and never falls back to the local policy', async () => {
      await expect(
        getEducationStatus(db(), ids.actor, ids.application),
      ).rejects.toMatchObject({ status: 403 })
      const wrong = createHostedEducationPolicy(
        {
          ...profile(),
          databaseIdentity: randomUUID(),
        },
        async () => true,
      )
      await expect(
        getEducationStatus(db(), ids.actor, ids.application, wrong),
      ).rejects.toMatchObject({ status: 503 })
      const s = await state()
      expect(s.current).toBe(null)
      expect(s.decisionVersion).toBe(0)
    })
    it('fails closed on identity trigger or browser grant drift', async () => {
      try {
        await db().execute(
          sql`ALTER TABLE crm_education_hosted_identity DISABLE TRIGGER crm_education_hosted_identity_guard`,
        )
        expect(
          (
            await call({
              action: 'education-status',
              applicationId: ids.application,
            })
          ).status,
        ).toBe(503)
      } finally {
        await db().execute(
          sql`ALTER TABLE crm_education_hosted_identity ENABLE TRIGGER crm_education_hosted_identity_guard`,
        )
      }
      try {
        await db().execute(
          sql`GRANT SELECT ON crm_education_hosted_identity TO PUBLIC`,
        )
        expect(
          (
            await call({
              action: 'education-status',
              applicationId: ids.application,
            })
          ).status,
        ).toBe(503)
      } finally {
        await db().execute(
          sql`REVOKE SELECT ON crm_education_hosted_identity FROM PUBLIC`,
        )
      }
    })
    it('binds real authenticated reviewer provenance to minimal hosted bytes without staff grants', async () => {
      const response = await review()
      expect(
        response.status,
        JSON.stringify(await response.clone().json()),
      ).toBe(200)
      const [decision] = await db().select().from(schema.educationDecisions),
        [entry] = await db().select().from(schema.educationOutbox)
      const wire = JSON.parse(entry.rawBody) as Record<string, unknown>
      expect(wire.environment).toBe('synthetic-hosted')
      expect(wire.reviewer_id).toBe(ids.actor)
      expect(Object.keys(wire)).not.toContain('email')
      expect(Object.keys(wire)).not.toContain('evidence')
      expect(decision.criterionReviews.hr_approved.reviewerId).toBe(ids.actor)
      expect((await db().select().from(schema.members)).length).toBe(3)
      expect(
        (
          await call({
            action: 'education-review',
            applicationId: ids.application,
            reviewer_id: ids.second,
          })
        ).status,
      ).toBe(400)
    })
    it('rejects real/source replacements even at the fixed fictional application ID', async () => {
      await db()
        .update(schema.records)
        .set({
          data: {
            workflow: 'program',
            educationFixture: false,
            personId: ids.person,
            crmProgramId: ids.program,
          },
        })
        .where(eq(schema.records.id, ids.application))
      expect(
        (
          await call({
            action: 'education-status',
            applicationId: ids.application,
          })
        ).status,
      ).toBe(403)
      expect(
        (
          await call({
            action: 'education-status',
            applicationId: randomUUID(),
          })
        ).status,
      ).toBe(403)
    })
    it('holds stale source revisions and supersedes old delivery without changing its bytes', async () => {
      expect((await review()).status).toBe(200)
      const [old] = await db().select().from(schema.educationOutbox)
      await db()
        .update(schema.records)
        .set({ revision: 2 })
        .where(eq(schema.records.id, ids.person))
      context.user = { id: ids.second }
      const s = await state()
      expect((s.current as Record<string, unknown>).decision).toBe('held')
      const [retained] = await db()
        .select()
        .from(schema.educationOutbox)
        .where(eq(schema.educationOutbox.id, old.id))
      expect(retained.status).toBe('superseded')
      expect(retained.rawBody).toBe(old.rawBody)
    })
    it('reloads previous reviewer authority and requires explicit withdrawal restoration', async () => {
      expect((await review()).status).toBe(200)
      await db()
        .update(schema.members)
        .set({ hr: false })
        .where(eq(schema.members.id, ids.actor))
      context.user = { id: ids.second }
      let s = await state()
      expect((s.current as Record<string, unknown>).reason).toContain(
        'reviewer_authority_changed',
      )
      expect((s.current as Record<string, unknown>).decision).toBe('held')
      expect(
        (await review({ decision: 'revoked', withdrawn: true })).status,
      ).toBe(200)
      expect((await review()).status).toBe(409)
      expect((await review({ restoreWithdrawal: true })).status).toBe(200)
      s = await state()
      expect((s.current as Record<string, unknown>).reviewerId).toBe(ids.second)
    })
    it('lets another current HR reviewer hold and revoke after the previous reviewer email changes', async () => {
      expect((await review()).status).toBe(200)
      await db()
        .update(schema.members)
        .set({ email: 'changed-reviewer@emerson.example' })
        .where(eq(schema.members.id, ids.actor))
      context.user = { id: ids.second }
      const s = await state()
      expect((s.current as Record<string, unknown>).decision).toBe('held')
      expect((s.current as Record<string, unknown>).reason).toContain(
        'reviewer_authority_changed',
      )
      expect((await review({ decision: 'revoked' })).status).toBe(200)
      const current = (await state()).current as Record<string, unknown>
      expect(current.decision).toBe('revoked')
      expect(current.reviewerId).toBe(ids.second)
    })
    it('records only validated hosted acknowledgements and preserves failed retry bytes', async () => {
      expect((await review()).status).toBe(200)
      const [original] = await db().select().from(schema.educationOutbox)
      await dispatchEducation(
        db(),
        ids.actor,
        ids.application,
        async () => {
          throw new Error('SYNTHETIC timeout')
        },
        policy(),
      )
      const [failed] = await db().select().from(schema.educationOutbox)
      expect(failed.status).toBe('failed')
      expect(failed.rawBody).toBe(original.rawBody)
      await dispatchEducation(
        db(),
        ids.actor,
        ids.application,
        async (raw) => ({ ...receipt(raw), environment: 'synthetic-local' }),
        policy(),
      )
      expect((await db().select().from(schema.educationOutbox))[0].status).toBe(
        'failed',
      )
      await dispatchEducation(
        db(),
        ids.actor,
        ids.application,
        async (raw) => receipt(raw),
        policy(),
      )
      const [delivered] = await db().select().from(schema.educationOutbox)
      expect(delivered.status).toBe('delivered')
      expect(delivered.attempts).toBe(3)
      expect(delivered.rawBody).toBe(original.rawBody)
    })
    it('serializes competing decisions and protects identity/outbox history with database guards', async () => {
      const s = await state(),
        payload = {
          action: 'education-review',
          applicationId: ids.application,
          expected: {
            applicationRevision: s.applicationRevision,
            personRevision: s.personRevision,
            sourceFingerprint: s.sourceFingerprint,
            decisionVersion: s.decisionVersion,
          },
          decision: 'held',
          clearance,
          evidence,
          withdrawn: false,
          reason: 'SYNTHETIC race',
        }
      const responses = await Promise.all([call(payload), call(payload)])
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
      await expect(
        db().execute(
          sql`UPDATE crm_education_hosted_identity SET backend_origin='https://other.example.test'`,
        ),
      ).rejects.toThrow()
      await expect(
        db().execute(sql`UPDATE crm_education_outbox SET raw_body='{}'`),
      ).rejects.toThrow()
    })
    it('fails closed after delayed setup and resumes only from a fresh append-only observation', async () => {
      // Age only this disposable SQL fixture; production never updates history.
      await db().execute(
        sql`ALTER TABLE crm_education_hosted_observations DISABLE TRIGGER crm_education_hosted_observation_guard`,
      )
      try {
        await db().execute(
          sql`UPDATE crm_education_hosted_observations SET observed_at=clock_timestamp()-INTERVAL '6 minutes'`,
        )
      } finally {
        await db().execute(
          sql`ALTER TABLE crm_education_hosted_observations ENABLE TRIGGER crm_education_hosted_observation_guard`,
        )
      }
      const old = await db().select().from(schema.educationHostedObservations)
      expect(
        (
          await call({
            action: 'education-status',
            applicationId: ids.application,
          })
        ).status,
      ).toBe(409)
      await observation()
      expect((await state()).decisionVersion).toBe(0)
      expect(
        (await db().select().from(schema.educationHostedObservations)).find(
          (r) => r.id === old[0].id,
        ),
      ).toEqual(old[0])
      expect((await review()).status).toBe(200)
      await expect(observation()).rejects.toThrow()
      expect(
        (await db().select().from(schema.educationHostedObservations)).length,
      ).toBe(2)
    })
    it('rejects stale future foreign regressing or contradictory operator observations', async () => {
      for (const override of [
        { observedAt: new Date(Date.now() - 301000) },
        { observedAt: new Date(Date.now() + 10000) },
        {
          target: 'https://other.example.test/internal/crm/onboarding-handoffs',
        },
        { identityId: randomUUID() },
        { evidenceSource: 'unverified' },
        { stateHash: 'b'.repeat(64) },
      ])
        await expect(observation(override)).rejects.toThrow()
      await observation({ receiverVersion: 2, stateHash: 'c'.repeat(64) })
      await expect(
        observation({ receiverVersion: 1, stateHash: 'b'.repeat(64) }),
      ).rejects.toThrow()
      const sameTime = new Date()
      const results = await Promise.allSettled([
        observation({
          receiverVersion: 3,
          stateHash: 'd'.repeat(64),
          observedAt: sameTime,
        }),
        observation({
          receiverVersion: 3,
          stateHash: 'd'.repeat(64),
          observedAt: sameTime,
        }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect((await state()).decisionVersion).toBe(3)
    })
    it('rejects observation tampering and fails closed on observation guard or browser grants', async () => {
      await expect(
        db().execute(
          sql`UPDATE crm_education_hosted_observations SET receiver_version=1`,
        ),
      ).rejects.toThrow()
      await expect(
        db().execute(sql`DELETE FROM crm_education_hosted_observations`),
      ).rejects.toThrow()
      try {
        await db().execute(
          sql`ALTER TABLE crm_education_hosted_observations DISABLE TRIGGER crm_education_hosted_observation_guard`,
        )
        expect(
          (
            await call({
              action: 'education-status',
              applicationId: ids.application,
            })
          ).status,
        ).toBe(503)
      } finally {
        await db().execute(
          sql`ALTER TABLE crm_education_hosted_observations ENABLE TRIGGER crm_education_hosted_observation_guard`,
        )
      }
      try {
        await db().execute(
          sql`GRANT SELECT(state_hash) ON crm_education_hosted_observations TO PUBLIC`,
        )
        expect(
          (
            await call({
              action: 'education-status',
              applicationId: ids.application,
            })
          ).status,
        ).toBe(503)
      } finally {
        await db().execute(
          sql`REVOKE SELECT(state_hash) ON crm_education_hosted_observations FROM PUBLIC`,
        )
      }
    })
    it('serializes first review against a competing observation without losing either version floor', async () => {
      const s = await state()
      const results = await Promise.allSettled([
        call({
          action: 'education-review',
          applicationId: ids.application,
          expected: {
            applicationRevision: s.applicationRevision,
            personRevision: s.personRevision,
            sourceFingerprint: s.sourceFingerprint,
            decisionVersion: s.decisionVersion,
          },
          decision: 'held',
          clearance,
          evidence,
          withdrawn: false,
          reason: 'SYNTHETIC first-decision race',
        }),
        observation({ receiverVersion: 1, stateHash: 'b'.repeat(64) }),
      ])
      const response = results[0]
      expect(response.status).toBe('fulfilled')
      if (response.status !== 'fulfilled') throw new Error('No API result')
      const status = (response.value as Response).status
      expect([200, 409]).toContain(status)
      const decisions = await db().select().from(schema.educationDecisions)
      if (status === 200) {
        expect(results[1].status).toBe('rejected')
        expect(decisions[0].decisionVersion).toBe(1)
      } else {
        expect(results[1].status).toBe('fulfilled')
        expect(decisions).toHaveLength(0)
        expect((await state()).decisionVersion).toBe(1)
      }
    })
    it('keeps production DML templates disabled and rehearses their exact SQL with isolated fixture pins only', async () => {
      if (!cluster) throw new Error('No fresh cluster')
      const seed = await readFile(
        new URL(
          '../../docs/operator-migrations/hosted-fixture-seed.sql.template',
          import.meta.url,
        ),
        'utf8',
      )
      const observe = await readFile(
        new URL(
          '../../docs/operator-migrations/hosted-receiver-observation.sql.template',
          import.meta.url,
        ),
        'utf8',
      )
      await expect(cluster.pool.query(seed)).rejects.toMatchObject({
        code: '55000',
      })
      await expect(cluster.pool.query(observe)).rejects.toMatchObject({
        code: '55000',
      })
      const membersBefore = await db().select().from(schema.members)
      // Substitute only explicit fictional pins in this disposable local DB.
      // The checked-in templates stay disabled, unconfigured and undeployed.
      await cluster.pool.query(
        'TRUNCATE crm_records,crm_education_hosted_identity CASCADE',
      )
      await db()
        .update(schema.members)
        .set({ role: 'owner' })
        .where(eq(schema.members.id, ids.actor))
      const membersBeforeSeed = await db().select().from(schema.members)
      const configuredSeed = seed
        .replace('approved boolean := false', 'approved boolean := true')
        .replace(
          'target_and_existing_membership_verified boolean := false',
          'target_and_existing_membership_verified boolean := true',
        )
        .replace(
          'compiled_profile_sha256 text := NULL',
          `compiled_profile_sha256 text := '${'a'.repeat(64)}'`,
        )
        .replace(
          'database_identity uuid := NULL',
          `database_identity uuid := '${context.profile.databaseIdentity}'`,
        )
        .replace(
          'crm_origin text := NULL',
          `crm_origin text := '${context.profile.crmOrigin}'`,
        )
        .replace(
          'backend_origin text := NULL',
          `backend_origin text := '${context.profile.backendOrigin}'`,
        )
        .replace(
          'fixture_source_key text := NULL',
          `fixture_source_key text := '${context.profile.fixtureSourceKey}'`,
        )
        .replaceAll('netlifydb', 'postgres')
        .replace(
          'reviewer_id_sha256 text := NULL',
          `reviewer_id_sha256 text := '${hostedReviewerIdSha256(ids.actor)}'`,
        )
        .replace(
          'reviewer_identity_sha256 text := NULL',
          `reviewer_identity_sha256 text := '${hostedReviewerIdentitySha256(ids.actor, 'reviewer@emerson.example')}'`,
        )
        // This isolated test profile contains two existing fictional reviewers.
        .replace(
          'jsonb_build_array(existing_reviewer::text)',
          `jsonb_build_array(existing_reviewer::text,'${ids.second}')`,
        )
      await expect(
        cluster.pool.query(
          configuredSeed.replace(
            hostedReviewerIdentitySha256(ids.actor, 'reviewer@emerson.example'),
            'b'.repeat(64),
          ),
        ),
      ).rejects.toMatchObject({ code: '55000' })
      expect(await db().select().from(schema.records)).toHaveLength(0)
      expect(
        await db().select().from(schema.educationHostedIdentity),
      ).toHaveLength(0)
      await cluster.pool.query(configuredSeed)
      const membersAfterSeed = await db().select().from(schema.members)
      expect(membersAfterSeed.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
        membersBeforeSeed.sort((a, b) => a.id.localeCompare(b.id)),
      )
      expect(await db().select().from(schema.educationDecisions)).toHaveLength(
        0,
      )
      expect(await db().select().from(schema.educationOutbox)).toHaveLength(0)
      expect(
        await db().select().from(schema.educationHostedObservations),
      ).toHaveLength(0)
      await expect(cluster.pool.query(configuredSeed)).rejects.toMatchObject({
        code: '55000',
      })
      const configuredObservation = observe
        .replace('approved boolean := false', 'approved boolean := true')
        .replace(
          'receiver_and_compiled_profile_verified boolean := false',
          'receiver_and_compiled_profile_verified boolean := true',
        )
        .replace(
          'database_identity uuid := NULL',
          `database_identity uuid := '${context.profile.databaseIdentity}'`,
        )
        .replace(
          'p_backend_origin text := NULL',
          `p_backend_origin text := '${context.profile.backendOrigin}'`,
        )
        .replace(
          'actual_receiver_version integer := NULL',
          'actual_receiver_version integer := 0',
        )
        .replace(
          'actual_observed_at timestamptz := NULL',
          `actual_observed_at timestamptz := '${new Date(Date.now() - 1000).toISOString()}'`,
        )
        .replace(
          'actual_state_sha256 text := NULL',
          `actual_state_sha256 text := '${'a'.repeat(64)}'`,
        )
        .replace(
          'actual_evidence_source text := NULL',
          "actual_evidence_source text := 'operator-receiver-observation:isolated-template-rehearsal'",
        )
        .replaceAll('netlifydb', 'postgres')
      await cluster.pool.query(configuredObservation)
      expect((await state()).decisionVersion).toBe(0)
      expect((await review()).status).toBe(200)
      const after = await db().select().from(schema.members)
      expect(after).toHaveLength(membersBefore.length)
      expect(after.map((m) => m.id).sort()).toEqual(
        membersBefore.map((m) => m.id).sort(),
      )
    })
  },
)
