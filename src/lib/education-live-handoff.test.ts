// @vitest-environment node
// EXPLICIT OPT-IN: real loopback-only EPDG receiver, fresh synthetic CRM SQL.
// Trusted local configuration/credentials stay in memory and are never exported.
import { afterAll, beforeAll, describe, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { desc, eq } from 'drizzle-orm'
import * as schema from '../../db/schema'
import { createLocalPostgres } from '../test/local-postgres'
import { isEducationSnapshot, type EducationDecision } from './education'
import {
  signSyntheticEducationAttempt,
  SYNTHETIC_HANDOFF,
  type SignedEducationAttempt,
} from '../../netlify/functions/lib/education-handoff.mts'
import { sendSyntheticEducationAttempt } from '../../netlify/functions/lib/education-transport.mts'

const context = vi.hoisted(() => ({
  user: null as { id: string } | null,
  db: null as NodePgDatabase<typeof schema> | null,
  environment: {} as Record<string, string | undefined>,
}))
vi.mock('@netlify/identity', () => ({
  getUser: async () => context.user,
  admin: {
    getUser: async () => {
      throw new Error('No Identity administration in live synthetic rehearsal')
    },
  },
}))
vi.mock('../../db/index', () => ({
  database: () => {
    if (!context.db) throw new Error('Synthetic CRM database unavailable')
    return context.db
  },
}))
import handler from '../../netlify/functions/crm.mts'

const enabled =
  process.env.CRM_EDUCATION_LIVE_TEST === '1' &&
  process.env.CRM_EDUCATION_LIVE_RECEIVER_APPROVED === '1'
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const proofRoot = join(
  workspace,
  'build-evidence/emerson-crm-education-live/2026-10-27',
)
const epdgScripts = join(
  workspace,
  'exchange/THE-EMERSON-EMPIRE_Backend/epdg-backend-core/scripts/local-synthetic',
)
const require = createRequire(import.meta.url)
interface TrustedConfig {
  crmHandoffEnabled?: boolean
  crmHandoffKey?: string
  fixturePassword?: string
}
interface ReceiverDb {
  query<Row = Record<string, unknown>>(
    query: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>
  end(): Promise<void>
}
interface TrustedCommon {
  config(): TrustedConfig
  preflight(config: TrustedConfig): Promise<unknown>
  client(config: TrustedConfig, admin?: boolean): Promise<ReceiverDb>
}
interface SnapshotHelpers {
  protectedSnapshot(db: ReceiverDb): Promise<unknown[]>
}
interface FrozenHelpers {
  frozenSnapshot(db: ReceiverDb): Promise<unknown[]>
}
interface IdentityHelpers {
  identityGate(db: ReceiverDb, config: TrustedConfig): Promise<void>
}
interface AdversarialHelper {
  verifyAdversarialReceiver(options: {
    rawBody: string
    usedNonce: string
    signAttempt: (body: string, nonce: string) => SignedEducationAttempt
    receiverSnapshot: () => Promise<unknown>
  }): Promise<unknown>
}
const ids = {
  owner: '80000000-0000-4000-8000-000000000001',
  hr: '80000000-0000-4000-8000-000000000002',
  person: '81000000-0000-4000-8000-000000000001',
  application: '82000000-0000-4000-8000-000000000001',
  program: '83000000-0000-4000-8000-000000000001',
  mapping: '84000000-0000-4000-8000-000000000001',
  enrollment: '86000000-0000-4000-8000-000000000001',
  localProgram: '85000000-0000-4000-8000-000000000001',
  intake: '88000000-0000-4000-8000-000000000001',
}
const clearance = {
  identity_verified: true,
  onboarding_complete: true,
  agreements_complete: true,
  hr_approved: true,
}
const evidence = {
  identity_verified: 'SYNTHETIC live identity review v1',
  onboarding_complete: 'SYNTHETIC live onboarding review v1',
  agreements_complete: 'SYNTHETIC live agreement review v1',
  hr_approved: 'SYNTHETIC live HR approval v1',
}
const gate = { enabled: '1', environment: 'synthetic-local' }
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
function ensure(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label)
}
let cluster: Awaited<ReturnType<typeof createLocalPostgres>> | undefined
let receiver: ReceiverDb | undefined
let common: TrustedCommon | undefined
let trusted: TrustedConfig | undefined
let session: { cookie: string; csrf: string } | undefined
let helpers: SnapshotHelpers
let frozen: FrozenHelpers
let identity: IdentityHelpers
const checks: {
  name: string
  version?: number
  receiverStatus?: string
  hash?: string
}[] = []

async function api(body: unknown) {
  const response = await handler(
    new Request('http://127.0.0.1:59111/api/crm', {
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1:59111',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
  const value: unknown = await response.json()
  return { response, value }
}
async function status() {
  const { response, value } = await api({
    action: 'education-status',
    applicationId: ids.application,
  })
  ensure(
    response.status === 200 && isEducationSnapshot(value),
    'Current CRM education status must be valid',
  )
  return value
}
async function review(
  decision: EducationDecision,
  options: { withdrawn?: boolean; restoreWithdrawal?: boolean } = {},
) {
  const before = await status()
  const { response, value } = await api({
    action: 'education-review',
    applicationId: ids.application,
    expected: {
      applicationRevision: before.applicationRevision,
      personRevision: before.personRevision,
      sourceFingerprint: before.sourceFingerprint,
      decisionVersion: before.decisionVersion,
    },
    clearance,
    evidence,
    decision,
    reason:
      'SYNTHETIC current source and criteria reviewed for live local handoff',
    withdrawn: options.withdrawn === true,
    ...(options.restoreWithdrawal ? { restoreWithdrawal: true } : {}),
  })
  ensure(
    response.status === 200 && isEducationSnapshot(value),
    'Structured CRM HR review must succeed',
  )
  ensure(
    value.decisionVersion === before.decisionVersion + 1,
    'Actual CRM decisions must advance one version',
  )
  return value
}
async function dispatch(expectedStatus: string) {
  const { response, value } = await api({
    action: 'education-dispatch',
    applicationId: ids.application,
  })
  ensure(
    response.status === 200 && isEducationSnapshot(value),
    'CRM dispatch response must be valid',
  )
  const entry = value.outbox.find(
    (row) => row.decisionVersion === value.decisionVersion,
  )
  ensure(
    entry?.status === 'delivered' && entry.currentStatus === expectedStatus,
    'Actual receiver must acknowledge current CRM event',
  )
  return value
}
async function learner(path: string, method = 'GET', body?: unknown) {
  const response = await fetch('http://127.0.0.1:58000' + path, {
    method,
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
    headers: {
      ...(method !== 'GET'
        ? {
            Origin: 'http://127.0.0.1:58080',
            'X-EPDG-Request': 'portal',
            'Content-Type': 'application/json',
          }
        : {}),
      ...(session
        ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const value: unknown = await response.json()
  return { response, value }
}
async function receiverState() {
  ensure(receiver && trusted, 'Verified receiver connection required')
  await receiver.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    await identity.identityGate(receiver, trusted)
    const latest = (
      await receiver.query<{
        decision: string
        decision_version: number
        withdrawn: boolean
        reviewer_id: string
      }>(
        'SELECT decision,decision_version,withdrawn,reviewer_id FROM synthetic_handoff.events WHERE mapping_id=$1 ORDER BY decision_version DESC LIMIT 1',
        [ids.mapping],
      )
    ).rows[0]
    ensure(latest, 'Existing synthetic receiver mapping decision required')
    await receiver.query(
      "SELECT set_config('synthetic_handoff.enabled','on',true)",
    )
    const access = (
      await receiver.query<{ allowed: boolean }>(
        'SELECT synthetic_handoff.enrollment_allowed($1) AS allowed',
        [ids.enrollment],
      )
    ).rows[0].allowed
    const protectedRows = await helpers.protectedSnapshot(receiver),
      immutableRows = await frozen.frozenSnapshot(receiver)
    const sessions = (
      await receiver.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM portal_security.sessions',
      )
    ).rows[0].count
    await receiver.query('COMMIT')
    return {
      latest,
      access,
      protectedHash: hash(protectedRows),
      immutableHash: hash(immutableRows),
      sessions,
    }
  } catch {
    await receiver.query('ROLLBACK')
    throw new Error('Verified local receiver read failed')
  }
}
async function receiverDigest() {
  ensure(receiver, 'Receiver must be connected')
  const journal = (
    await receiver.query(
      "SELECT 'events' AS name,count(*)::int AS count,encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY event_id),''),'UTF8')),'hex') AS sha256 FROM synthetic_handoff.events t UNION ALL SELECT 'nonces',count(*)::int,encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY nonce),''),'UTF8')),'hex') FROM synthetic_handoff.nonces t ORDER BY name",
    )
  ).rows
  const state = await receiverState()
  return { journal, ...state }
}
async function assertAccess(
  expected: 'ready' | 'held' | 'withdrawn',
  version: number,
  practiceIds: string[],
  baseline: { protectedHash: string; immutableHash: string },
) {
  const observed = await receiverState()
  ensure(
    observed.latest.decision_version === version &&
      observed.access === (expected === 'ready'),
    'Receiver version and database access gate must match current decision',
  )
  ensure(
    observed.protectedHash === baseline.protectedHash &&
      observed.immutableHash === baseline.immutableHash,
    'Accounts, roles, enrollment records and immutable learning evidence must stay unchanged',
  )
  const onboarding = await learner('/api/learner/onboarding')
  ensure(
    onboarding.response.status === 200 &&
      object(onboarding.value) &&
      onboarding.value.privileged_controls_available === false &&
      object(onboarding.value.onboarding) &&
      onboarding.value.onboarding.status === expected,
    'Actual learner onboarding read must match the accepted receiver state',
  )
  const dashboard = await learner('/api/learner/dashboard')
  ensure(
    dashboard.response.status === 200 &&
      object(dashboard.value) &&
      Array.isArray(dashboard.value.programs),
    'Actual learner dashboard read must succeed',
  )
  const programIds = dashboard.value.programs
    .map((row) => (object(row) && typeof row.id === 'string' ? row.id : ''))
    .filter(Boolean)
  ensure(
    hash(programIds.filter((id) => id !== ids.localProgram).sort()) ===
      hash(practiceIds),
    'Unrelated practice must remain available without alteration',
  )
  ensure(
    programIds.includes(ids.localProgram) === (expected === 'ready'),
    'Managed program listing must reflect current eligibility',
  )
  const program = await learner('/api/learner/programs/' + ids.localProgram)
  ensure(
    program.response.status === (expected === 'ready' ? 200 : 404),
    'Actual program read must enforce current eligibility',
  )
  checks.push({
    name: 'receiver and learner access match ' + expected,
    version,
    receiverStatus: expected,
  })
}

describe.skipIf(!enabled)('actual CRM to verified local EPDG handoff', () => {
  beforeAll(async () => {
    common = require(join(epdgScripts, 'common.cjs')) as TrustedCommon
    helpers = require(
      join(epdgScripts, 'handoff-verify.cjs'),
    ) as SnapshotHelpers
    frozen = require(
      join(epdgScripts, 'learning-migration-policy.cjs'),
    ) as FrozenHelpers
    identity = require(
      join(epdgScripts, 'learning-migrate.cjs'),
    ) as IdentityHelpers
    try {
      trusted = common.config()
    } catch {
      throw new Error('Trusted local synthetic configuration is unavailable')
    }
    ensure(
      trusted.crmHandoffEnabled === true &&
        typeof trusted.crmHandoffKey === 'string' &&
        typeof trusted.fixturePassword === 'string',
      'Existing local synthetic handoff configuration must be available',
    )
    await common.preflight(trusted)
    receiver = await common.client(trusted, true)
    await identity.identityGate(receiver, trusted)
    cluster = await createLocalPostgres('education-live')
    context.db = cluster.db
    vi.stubGlobal('Netlify', {
      env: { get: (key: string) => context.environment[key] },
    })
    context.environment = {
      CRM_SYNTHETIC_EDUCATION_ENABLED: '1',
      CRM_EDUCATION_ENVIRONMENT: 'synthetic-local',
      EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED: '1',
      EPDG_SYNTHETIC_CRM_HANDOFF_KEY: trusted.crmHandoffKey,
    }
    context.user = { id: ids.owner }
    await cluster.db.insert(schema.members).values([
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
        name: 'SYNTHETIC HR reviewer',
        role: 'manager',
        active: true,
        commercial: false,
        hr: true,
      },
    ])
    const sourceKey = createHash('sha256')
      .update(JSON.stringify(['synthetic live source', 'row-1']))
      .digest('hex')
    await cluster.db.insert(schema.records).values([
      {
        id: ids.person,
        kind: 'contact',
        title: 'SYNTHETIC live person',
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
        title: 'SYNTHETIC live application',
        access: 'hr',
        ownerId: ids.owner,
        sourceKey,
        data: {
          workflow: 'program',
          personId: ids.person,
          crmProgramId: ids.program,
          educationFixture: true,
          stage: 'Active',
          onboardingStatus: 'Descriptive source evidence only',
        },
      },
      {
        id: ids.intake,
        kind: 'intake',
        title: 'SYNTHETIC live source receipt',
        access: 'hr',
        ownerId: ids.owner,
        sourceKey,
        data: {
          workflow: 'program',
          status: 'applied',
          caseId: ids.application,
          personId: ids.person,
          sourceName: 'SYNTHETIC live source',
          sourceId: 'row-1',
          sourceVersion: 'v1',
          sourceFingerprint: 'a'.repeat(64),
          sourceChanged: false,
        },
      },
    ])
  }, 120000)
  afterAll(async () => {
    const cleanup = {
      at: new Date().toISOString(),
      learnerSessionExisted: !!session,
      learnerLogoutSucceeded: !session,
      receiverConnectionClosed: false,
      freshCrmClusterStopped: false,
      credentialsExported: false,
    }
    if (session) {
      try {
        cleanup.learnerLogoutSucceeded =
          (await learner('/api/auth/logout', 'POST', {})).response.status ===
          200
      } catch {
        cleanup.learnerLogoutSucceeded = false
      }
      session = undefined
    }
    context.user = null
    context.environment = {}
    context.db = null
    trusted = undefined
    try {
      await receiver?.end()
      cleanup.receiverConnectionClosed = true
    } finally {
      receiver = undefined
      await cluster?.stop()
      cleanup.freshCrmClusterStopped = true
      vi.unstubAllGlobals()
      await mkdir(proofRoot, { recursive: true })
      await writeFile(
        join(proofRoot, 'cleanup.json'),
        JSON.stringify(cleanup, null, 2),
      )
    }
    ensure(
      cleanup.learnerLogoutSucceeded,
      'Live learner session logout requires operator verification',
    )
  }, 60000)
  it('delivers real persisted decisions, retries exact bytes and finishes held with unchanged prior learning', async () => {
    ensure(
      cluster && receiver && trusted?.crmHandoffKey && trusted.fixturePassword,
      'Verified synthetic fixture must be initialized',
    )
    const baseline = await receiverState()
    ensure(
      baseline.access === false && baseline.latest.decision !== 'cleared',
      'Existing receiver must start held or withdrawn',
    )
    const stateHash = hash({
      mappingId: ids.mapping,
      latest: baseline.latest,
      access: baseline.access,
      protectedHash: baseline.protectedHash,
      immutableHash: baseline.immutableHash,
    })
    await cluster.db.insert(schema.educationReceiverCheckpoints).values({
      applicationId: ids.application,
      receiverVersion: baseline.latest.decision_version,
      target: SYNTHETIC_HANDOFF.target,
      observedAt: new Date(),
      stateHash,
      source: 'verified-local-epdg',
    })
    const initial = await status()
    ensure(
      initial.current === null &&
        initial.decisionVersion === baseline.latest.decision_version &&
        initial.receiverVersionFloor === baseline.latest.decision_version,
      'Verified checkpoint must advance the sequence without historical CRM decisions',
    )
    ensure(
      (await cluster.db.select().from(schema.educationDecisions)).length === 0,
      'No historical CRM decisions may be fabricated',
    )
    const login = await learner('/api/auth/login', 'POST', {
      email: 'learner-b@epdg.invalid',
      password: trusted.fixturePassword,
    })
    ensure(
      login.response.status === 200 &&
        object(login.value) &&
        typeof login.value.csrf_token === 'string' &&
        object(login.value.user) &&
        login.value.user.privileged_controls_available === false &&
        Array.isArray(login.value.user.permissions) &&
        login.value.user.permissions.length === 0,
      'Only the existing synthetic learner may sign in with privileged controls closed',
    )
    const cookie = login.response.headers.get('set-cookie')?.split(';')[0]
    ensure(cookie, 'Private learner session must be present')
    session = { cookie, csrf: login.value.csrf_token }
    const dashboard = await learner('/api/learner/dashboard')
    ensure(
      object(dashboard.value) && Array.isArray(dashboard.value.programs),
      'Existing practice must be readable',
    )
    const practiceIds = dashboard.value.programs
      .map((row) => (object(row) && typeof row.id === 'string' ? row.id : ''))
      .filter((id) => id && id !== ids.localProgram)
      .sort()
    ensure(
      practiceIds.length > 0,
      'Unrelated synthetic practice must already exist',
    )
    let version = baseline.latest.decision_version
    const signed = (rawBody: string, nonce: string = randomUUID()) => {
      ensure(trusted?.crmHandoffKey, 'Private local signer must be available')
      return signSyntheticEducationAttempt({
        rawBody,
        keyBase64url: trusted.crmHandoffKey,
        target: SYNTHETIC_HANDOFF.target,
        timestamp: Math.floor(Date.now() / 1000),
        nonce,
        gate,
        allowExactRetry: true,
      })
    }
    let failure: unknown
    let cleanupFailed = false
    try {
      await review('cleared')
      version++
      const accepted = await dispatch('ready')
      const first = (
        await cluster.db
          .select()
          .from(schema.educationOutbox)
          .where(eq(schema.educationOutbox.decisionVersion, version))
      )[0]
      const firstBody = first.rawBody
      const firstEventId = first.eventId
      const firstUsedNonce = (
        await receiver.query<{ nonce: string }>(
          'SELECT nonce FROM synthetic_handoff.nonces WHERE event_id=$1 ORDER BY received_at LIMIT 1',
          [firstEventId],
        )
      ).rows[0].nonce
      await assertAccess('ready', version, practiceIds, baseline)
      const duplicate = await dispatch('ready')
      const retried = (
        await cluster.db
          .select()
          .from(schema.educationOutbox)
          .where(eq(schema.educationOutbox.eventId, firstEventId))
      )[0]
      ensure(
        retried.rawBody === firstBody &&
          retried.bodyHash === first.bodyHash &&
          retried.attempts === 2 &&
          object(retried.receipt) &&
          retried.receipt.result === 'duplicate',
        'Durable outbox retries must retain event identity and exact body bytes',
      )
      ensure(
        accepted.decisionVersion === duplicate.decisionVersion,
        'Exact retry must not create another CRM decision',
      )
      const nonces = (
        await receiver.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM synthetic_handoff.nonces WHERE event_id=$1',
          [firstEventId],
        )
      ).rows[0].count
      ensure(nonces === 2, 'Each actual retry must use a fresh nonce')
      checks.push({
        name: 'actual API exact-byte retry delivered as duplicate with fresh nonce',
        version,
        hash: first.bodyHash,
      })
      context.user = { id: ids.hr }
      await review('held')
      version++
      await dispatch('held')
      await assertAccess('held', version, practiceIds, baseline)
      await review('revoked')
      version++
      await dispatch('withdrawn')
      await assertAccess('withdrawn', version, practiceIds, baseline)
      ensure(
        (await receiverState()).latest.reviewer_id === ids.hr,
        'A different current HR reviewer must be accepted without impersonation',
      )
      const oldRetry = await sendSyntheticEducationAttempt(signed(firstBody), {
        gate,
      })
      ensure(
        oldRetry.result === 'duplicate' &&
          oldRetry.current_status === 'withdrawn' &&
          oldRetry.decision_version === version,
        'Retrying old cleared bytes must report current revocation without restoring access',
      )
      await assertAccess('withdrawn', version, practiceIds, baseline)
      checks.push({
        name: 'old cleared retry cannot undo a later HR revocation',
        version,
      })
      await review('held', { withdrawn: true })
      version++
      await dispatch('withdrawn')
      const withdrawn = await status()
      const denied = await api({
        action: 'education-review',
        applicationId: ids.application,
        expected: {
          applicationRevision: withdrawn.applicationRevision,
          personRevision: withdrawn.personRevision,
          sourceFingerprint: withdrawn.sourceFingerprint,
          decisionVersion: withdrawn.decisionVersion,
        },
        decision: 'cleared',
        clearance,
        evidence,
        withdrawn: false,
        reason: 'SYNTHETIC missing explicit restoration',
      })
      ensure(
        denied.response.status === 409 &&
          (await status()).decisionVersion === version,
        'Withdrawal must not be cleared without an explicit new restoration review',
      )
      context.user = { id: ids.owner }
      await review('cleared', { restoreWithdrawal: true })
      version++
      await dispatch('ready')
      await assertAccess('ready', version, practiceIds, baseline)
      context.user = { id: ids.hr }
      await review('held')
      version++
      await dispatch('held')
      await assertAccess('held', version, practiceIds, baseline)
      const negative = (await import(
        new URL('../test/live-receiver-adversarial.mjs', import.meta.url).href
      )) as AdversarialHelper
      const adversarial = await negative.verifyAdversarialReceiver({
        rawBody: firstBody,
        usedNonce: firstUsedNonce,
        signAttempt: (body, nonce) => signed(body, nonce),
        receiverSnapshot: receiverDigest,
      })
      const final = await receiverState()
      ensure(
        final.access === false &&
          final.latest.decision === 'held' &&
          final.latest.decision_version === version,
        'Final receiver state must remain held',
      )
      ensure(
        final.protectedHash === baseline.protectedHash &&
          final.immutableHash === baseline.immutableHash &&
          final.sessions === baseline.sessions + 1,
        'Final negative checks must preserve protected state and create only this learner session',
      )
      const decisions = await cluster.db
        .select()
        .from(schema.educationDecisions)
        .orderBy(desc(schema.educationDecisions.decisionVersion))
      ensure(
        decisions.length === 6 &&
          decisions.every(
            (row) => row.decisionVersion > baseline.latest.decision_version,
          ),
        'Only six genuinely reviewed new CRM decisions may exist',
      )
      const outbox = await cluster.db.select().from(schema.educationOutbox)
      ensure(
        outbox.every(
          (row) =>
            !row.rawBody.includes('learner-b@') &&
            !row.rawBody.includes('SYNTHETIC live') &&
            !row.rawBody.includes('resume') &&
            !row.rawBody.includes('evidence'),
        ),
        'Wire bodies must contain only frozen-contract fields',
      )
      const evidenceReceipt = {
        at: new Date().toISOString(),
        scope: 'Local synthetic CRM to existing EPDG receiver only',
        freshCrmDatabase: true,
        syntheticIdentityAdapter:
          'Test-only getUser; active roles and all clearance authority reloaded from real CRM PostgreSQL',
        receiverDatabaseVerified: true,
        receiverVersionFloor: baseline.latest.decision_version,
        operatorCheckpointStateHash: stateHash,
        fabricatedHistoricalCrmDecisions: 0,
        actualNewCrmDecisions: decisions.length,
        finalDecisionVersion: final.latest.decision_version,
        finalDecision: final.latest.decision,
        managedProgramAccessible: final.access,
        accountRolesMembershipsEnrollmentsUnchanged:
          final.protectedHash === baseline.protectedHash,
        immutableLearningEvidenceUnchanged:
          final.immutableHash === baseline.immutableHash,
        protectedBeforeHash: baseline.protectedHash,
        protectedAfterHash: final.protectedHash,
        immutableBeforeHash: baseline.immutableHash,
        immutableAfterHash: final.immutableHash,
        learnerSessionsAdded: final.sessions - baseline.sessions,
        learnerSessionCleanup: 'Recorded separately in cleanup.json',
        productionTouched: false,
        realDataImported: false,
        accountsInvitationsPasswordsCreated: false,
        secretsExported: false,
        checks,
        adversarial,
        events: outbox.map((row) => ({
          eventId: row.eventId,
          decisionVersion: row.decisionVersion,
          decision: row.decision,
          bodyHash: row.bodyHash,
          status: row.status,
          attempts: row.attempts,
        })),
      }
      ensure(
        !JSON.stringify(evidenceReceipt).includes(trusted.crmHandoffKey),
        'Operational key must never enter evidence',
      )
      await mkdir(proofRoot, { recursive: true })
      await writeFile(
        join(proofRoot, 'live-handoff.json'),
        JSON.stringify(evidenceReceipt, null, 2),
      )
    } catch (error) {
      failure = error
    } finally {
      try {
        let observed = await receiverState()
        if (observed.access || observed.latest.decision !== 'held') {
          context.user = { id: ids.owner }
          await review('held')
          await dispatch('held')
          observed = await receiverState()
        }
        ensure(
          !observed.access && observed.latest.decision === 'held',
          'The actual receiver must finish blocked',
        )
      } catch {
        cleanupFailed = true
      }
    }
    ensure(
      !cleanupFailed,
      'Live rehearsal failed; receiver final hold requires operator verification',
    )
    if (failure) throw failure
  }, 180000)
})
