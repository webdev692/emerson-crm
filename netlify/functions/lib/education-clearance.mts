import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { database } from '../../../db/index'
import {
  audit,
  educationDecisions,
  educationOutbox,
  educationReceiverCheckpoints,
  members,
  records,
  type EducationClearance,
  type EducationEvidence,
  type EducationCriterionReviews,
} from '../../../db/schema'
import {
  FIXTURE_IDS,
  SYNTHETIC_HANDOFF,
  serializeDecision,
} from './education-handoff.mts'
import type { EducationPolicy } from './education-policy.mts'

type Database = Pick<ReturnType<typeof database>, 'transaction'>
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type Decision = typeof educationDecisions.$inferSelect
type Member = typeof members.$inferSelect
type Row = typeof records.$inferSelect
const criteria = [
  'identity_verified',
  'onboarding_complete',
  'agreements_complete',
  'hr_approved',
] as const
const noClearance: EducationClearance = {
  identity_verified: false,
  onboarding_complete: false,
  agreements_complete: false,
  hr_approved: false,
}
function requireValue(
  value: unknown,
  message: string,
  status = 400,
): asserts value {
  if (!value) throw Object.assign(new Error(message), { status })
}
function object(value: unknown): Record<string, unknown> {
  requireValue(
    value && typeof value === 'object' && !Array.isArray(value),
    'Education request object required',
  )
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, allowed: readonly string[]) {
  requireValue(
    Object.keys(value).every((key) => allowed.includes(key)),
    'Unexpected education review field',
  )
}
function bounded(value: unknown, name: string) {
  requireValue(
    typeof value === 'string' && value.trim() && value.length <= 1000,
    `${name} evidence is required (maximum 1000 characters)`,
  )
  return value.trim()
}
const hr = (member: Member | undefined) =>
  !!member?.active &&
  member.role !== 'viewer' &&
  (member.role === 'owner' || member.hr === true) &&
  /^[^@\s]+@[^@\s]+\.invalid$/i.test(member.email)
const localPolicy: EducationPolicy = Object.freeze({
  environment: 'synthetic-local',
  target: SYNTHETIC_HANDOFF.target,
  checkpointSource: 'verified-local-epdg',
  beforeTransaction: async () => {},
  reviewerAllowed: hr,
  serializeDecision,
})
async function actorFor(
  tx: Transaction,
  actorId: string,
  policy: EducationPolicy,
) {
  await policy.beforeTransaction(tx)
  const [actor] = await tx.select().from(members).where(eq(members.id, actorId))
  requireValue(
    policy.reviewerAllowed(actor),
    'Active synthetic HR review authority required',
    403,
  )
  requireValue(
    !policy.verifyReviewer || (await policy.verifyReviewer(actor)),
    'Current verified synthetic HR identity required',
    403,
  )
  return actor
}
interface Binding {
  application: Row
  person: Row
  program: Row
  sourceKey: string
  sourceFingerprint: string
  sourceVersion: string
  withdrawn: boolean
  holds: string[]
}
async function bindingFor(
  tx: Transaction,
  applicationId: unknown,
  policy: EducationPolicy,
): Promise<Binding> {
  requireValue(
    applicationId === FIXTURE_IDS.applicationId,
    'Only the approved synthetic application is available',
    403,
  )
  const fixtureRows = await tx
    .select()
    .from(records)
    .where(
      inArray(records.id, [
        FIXTURE_IDS.applicationId,
        FIXTURE_IDS.personId,
        FIXTURE_IDS.crmProgramId,
      ]),
    )
  const application = fixtureRows.find(
    (row) => row.id === FIXTURE_IDS.applicationId,
  )
  const person = fixtureRows.find((row) => row.id === FIXTURE_IDS.personId)
  const program = fixtureRows.find((row) => row.id === FIXTURE_IDS.crmProgramId)
  requireValue(
    application?.kind === 'application' && application.access === 'hr',
    'Approved synthetic HR application required',
    403,
  )
  requireValue(
    person?.kind === 'contact' && person.access === 'hr',
    'Approved synthetic HR person required',
    403,
  )
  requireValue(
    program?.kind === 'organization' && program.access === 'hr',
    'Explicit synthetic education program mapping required',
    403,
  )
  const holds: string[] = []
  if (
    application.data.educationFixture !== true ||
    application.data.workflow !== 'program'
  )
    holds.push('synthetic_application_unverified')
  if (
    person.data.educationFixture !== true ||
    person.data.email !== 'learner-b@epdg.invalid'
  )
    holds.push('synthetic_identity_unverified')
  if (
    program.data.educationFixture !== true ||
    program.data.educationProgram !== true ||
    !program.title.startsWith('SYNTHETIC')
  )
    holds.push('synthetic_program_unverified')
  if (application.data.personId !== person.id)
    holds.push('application_person_changed')
  if (application.data.crmProgramId !== program.id)
    holds.push('application_program_changed')
  if (
    application.data.identityHold === true ||
    person.data.identityHold === true
  )
    holds.push('identity_review_hold')
  if (
    application.data.sourceHold === true ||
    application.data.sourceChanged === true
  )
    holds.push('application_source_hold')
  const sourceKey = application.sourceKey || ''
  const sources = sourceKey
    ? await tx
        .select()
        .from(records)
        .where(
          and(eq(records.kind, 'intake'), eq(records.sourceKey, sourceKey)),
        )
    : []
  const source = sources.length === 1 ? sources[0] : undefined
  if (policy.environment === 'synthetic-hosted') {
    requireValue(
      policy.fixtureSourceKey &&
        sourceKey === policy.fixtureSourceKey &&
        application.data.educationFixture === true &&
        person.data.educationFixture === true &&
        program.data.educationFixture === true &&
        source?.data.educationFixture === true &&
        person.data.email === 'learner-b@epdg.invalid' &&
        [application, person, program, source].every((row) =>
          row.title.startsWith('SYNTHETIC'),
        ),
      'Only the pinned hosted fictional source is available',
      403,
    )
  }
  if (
    !source ||
    source.access !== 'hr' ||
    source.data.workflow !== 'program' ||
    source.data.status !== 'applied' ||
    source.data.caseId !== application.id ||
    source.data.personId !== person.id
  )
    holds.push('source_binding_unverified')
  if (source?.data.sourceChanged === true || source?.data.sourceHold === true)
    holds.push('source_review_hold')
  if (source) {
    const observations = await tx
      .select()
      .from(audit)
      .where(
        and(
          eq(audit.recordId, source.id),
          eq(audit.action, 'intake resolved source changed'),
        ),
      )
    if (observations.length) holds.push('resolved_source_changed')
  }
  const sourceFingerprint = source?.data.sourceFingerprint || ''
  const sourceVersion = source?.data.sourceVersion || ''
  if (
    !/^[0-9a-f]{64}$/.test(sourceFingerprint) ||
    !sourceVersion.trim() ||
    !source?.data.sourceName?.trim() ||
    !source.data.sourceId?.trim()
  )
    holds.push('source_version_unverified')
  if (
    application.data.sourceVersion &&
    application.data.sourceVersion !== sourceVersion
  )
    holds.push('application_source_version_changed')
  const withdrawn =
    application.data.withdrawn === true || source?.data.withdrawn === true
  if (withdrawn) holds.push('current_withdrawal')
  return {
    application,
    person,
    program,
    sourceKey,
    sourceFingerprint,
    sourceVersion,
    withdrawn,
    holds,
  }
}
async function latestFor(tx: Transaction, applicationId: string) {
  return (
    await tx
      .select()
      .from(educationDecisions)
      .where(eq(educationDecisions.applicationId, applicationId))
      .orderBy(desc(educationDecisions.decisionVersion))
      .limit(1)
  )[0]
}
async function receiverCheckpoint(
  tx: Transaction,
  applicationId: string,
  policy: EducationPolicy,
) {
  if (policy.receiverCheckpoint)
    return policy.receiverCheckpoint(tx, applicationId)
  return (
    await tx
      .select()
      .from(educationReceiverCheckpoints)
      .where(eq(educationReceiverCheckpoints.applicationId, applicationId))
  )[0]
}
// Only a trusted operator can seed this checkpoint, after observing the
// existing receiver. It advances the first sequence number without inventing CRM
// history. Once CRM decisions exist, their own append-only sequence is used.
async function initialReceiverVersion(
  tx: Transaction,
  applicationId: string,
  policy: EducationPolicy,
) {
  const checkpoint = await receiverCheckpoint(tx, applicationId, policy)
  if (!checkpoint) {
    requireValue(
      policy.environment === 'synthetic-local',
      'A fresh verified hosted receiver checkpoint is required',
      409,
    )
    return 0
  }
  const age = Date.now() - checkpoint.observedAt.getTime()
  requireValue(
    checkpoint.applicationId === FIXTURE_IDS.applicationId &&
      Number.isSafeInteger(checkpoint.receiverVersion) &&
      checkpoint.receiverVersion >= 0 &&
      checkpoint.receiverVersion <= 1000000 &&
      checkpoint.target === policy.target &&
      checkpoint.source === policy.checkpointSource &&
      /^[0-9a-f]{64}$/.test(checkpoint.stateHash) &&
      Number.isFinite(age) &&
      age >= (policy.environment === 'synthetic-hosted' ? 0 : -30000) &&
      age <= 300000,
    'A fresh verified receiver checkpoint is required',
    409,
  )
  return checkpoint.receiverVersion
}
async function currentHolds(
  tx: Transaction,
  binding: Binding,
  latest: Decision | undefined,
  policy: EducationPolicy,
) {
  const holds = [...binding.holds]
  if (!latest) return holds
  if (latest.applicationRevision !== binding.application.revision)
    holds.push('application_revision_changed')
  if (latest.personRevision !== binding.person.revision)
    holds.push('person_revision_changed')
  if (
    latest.sourceKey !== binding.sourceKey ||
    latest.sourceVersion !== binding.sourceVersion ||
    latest.sourceFingerprint !== binding.sourceFingerprint
  )
    holds.push('source_revision_changed')
  const [reviewer] = await tx
    .select()
    .from(members)
    .where(eq(members.id, latest.reviewerId))
  if (
    !policy.reviewerAllowed(reviewer) ||
    (policy.verifyReviewer && !(await policy.verifyReviewer(reviewer)))
  )
    holds.push('reviewer_authority_changed')
  if (
    latest.decision === 'cleared' &&
    (latest.withdrawn ||
      criteria.some(
        (key) =>
          latest.clearance[key] !== true ||
          !latest.evidence[key]?.trim() ||
          latest.criterionReviews[key]?.reviewerId !== latest.reviewerId ||
          latest.criterionReviews[key]?.reviewedAt !==
            latest.issuedAt.toISOString() ||
          latest.criterionReviews[key]?.value !== true,
      ))
  )
    holds.push('clearance_evidence_unverified')
  return [...new Set(holds)]
}
async function appendDecision(
  tx: Transaction,
  actor: Member,
  binding: Binding,
  previous: Decision | undefined,
  values: {
    decision: 'cleared' | 'held' | 'revoked'
    withdrawn: boolean
    clearance: EducationClearance
    evidence: EducationEvidence
    reason: string
  },
  policy: EducationPolicy,
) {
  const decisionVersion =
    (previous?.decisionVersion ??
      (await initialReceiverVersion(tx, binding.application.id, policy))) + 1
  requireValue(
    decisionVersion <= 1000000,
    'Synthetic decision version limit reached',
    409,
  )
  const id = randomUUID(),
    eventId = randomUUID(),
    issuedAt = new Date()
  const criterionReviews = Object.fromEntries(
    criteria.map((key) => [
      key,
      {
        value: values.clearance[key],
        reviewerId: actor.id,
        reviewedAt: issuedAt.toISOString(),
        evidence: values.evidence[key],
      },
    ]),
  ) as EducationCriterionReviews
  const [saved] = await tx
    .insert(educationDecisions)
    .values({
      id,
      applicationId: binding.application.id,
      personId: binding.person.id,
      programId: binding.program.id,
      applicationRevision: binding.application.revision,
      personRevision: binding.person.revision,
      sourceKey: binding.sourceKey,
      sourceFingerprint: binding.sourceFingerprint,
      sourceVersion: binding.sourceVersion,
      decisionVersion,
      reviewerId: actor.id,
      issuedAt,
      criterionReviews,
      ...values,
    })
    .returning()
  const rawBody = policy.serializeDecision({
    version: 1,
    source: 'emerson-crm-synthetic',
    environment: policy.environment,
    event_id: eventId,
    person_id: binding.person.id,
    application_id: binding.application.id,
    program_id: binding.program.id,
    decision_id: id,
    decision_version: decisionVersion,
    decision: values.decision,
    issued_at: issuedAt.toISOString(),
    policy_version: 'synthetic-onboarding-v1',
    reviewer_id: actor.id,
    clearance: values.clearance,
    withdrawn: values.withdrawn,
  })
  await tx
    .update(educationOutbox)
    .set({ status: 'superseded' })
    .where(
      and(
        eq(educationOutbox.applicationId, binding.application.id),
        inArray(educationOutbox.status, ['pending', 'failed']),
      ),
    )
  await tx.insert(educationOutbox).values({
    eventId,
    decisionId: id,
    applicationId: binding.application.id,
    decisionVersion,
    decision: values.decision,
    rawBody,
    bodyHash: createHash('sha256').update(rawBody).digest('hex'),
  })
  await tx.insert(audit).values({
    actorId: actor.id,
    recordId: binding.application.id,
    action: 'education clearance reviewed',
    after: {
      decisionId: id,
      decisionVersion,
      decision: values.decision,
      withdrawn: values.withdrawn,
    },
  })
  return saved
}
async function reconcile(
  tx: Transaction,
  actor: Member,
  binding: Binding,
  latest: Decision | undefined,
  policy: EducationPolicy,
) {
  const holds = await currentHolds(tx, binding, latest, policy)
  if (latest?.decision === 'cleared' && holds.length) {
    const reason = `Fresh HR review required: ${holds.join(', ')}`
    const evidence = Object.fromEntries(
      criteria.map((key) => [key, reason]),
    ) as EducationEvidence
    latest = await appendDecision(
      tx,
      actor,
      binding,
      latest,
      {
        decision: 'held',
        withdrawn: binding.withdrawn || latest.withdrawn,
        clearance: noClearance,
        evidence,
        reason,
      },
      policy,
    )
  }
  return latest
}
async function snapshot(
  tx: Transaction,
  binding: Binding,
  latest: Decision | undefined,
  policy: EducationPolicy,
) {
  const outbox = await tx
    .select()
    .from(educationOutbox)
    .where(eq(educationOutbox.applicationId, binding.application.id))
    .orderBy(desc(educationOutbox.decisionVersion))
  const checkpoint = await receiverCheckpoint(
    tx,
    binding.application.id,
    policy,
  )
  const holds = await currentHolds(tx, binding, latest, policy)
  if (latest?.withdrawn && !holds.includes('current_withdrawal'))
    holds.push('current_withdrawal')
  return {
    applicationId: binding.application.id,
    applicationRevision: binding.application.revision,
    personRevision: binding.person.revision,
    sourceFingerprint: binding.sourceFingerprint,
    sourceVersion: binding.sourceVersion,
    ...(checkpoint ? { receiverVersionFloor: checkpoint.receiverVersion } : {}),
    decisionVersion:
      latest?.decisionVersion ??
      (await initialReceiverVersion(tx, binding.application.id, policy)),
    current: latest
      ? {
          id: latest.id,
          decision: latest.decision,
          withdrawn: latest.withdrawn,
          reviewerId: latest.reviewerId,
          issuedAt: latest.issuedAt.toISOString(),
          reason: latest.reason,
          clearance: latest.clearance,
          evidence: latest.evidence,
        }
      : null,
    holds,
    outbox: outbox.map((entry) => ({
      eventId: entry.eventId,
      decisionVersion: entry.decisionVersion,
      decision: entry.decision,
      status: entry.status,
      attempts: entry.attempts,
      bodyHash: entry.bodyHash,
      ...(typeof entry.receipt?.current_status === 'string'
        ? { currentStatus: entry.receipt.current_status }
        : {}),
    })),
  }
}
export async function getEducationStatus(
  db: Database,
  actorId: string,
  applicationId: unknown,
  policy: EducationPolicy = localPolicy,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7031926)`)
    const actor = await actorFor(tx, actorId, policy),
      binding = await bindingFor(tx, applicationId, policy)
    const latest = await reconcile(
      tx,
      actor,
      binding,
      await latestFor(tx, binding.application.id),
      policy,
    )
    return snapshot(tx, binding, latest, policy)
  })
}
export async function handleEducationReview(
  db: Database,
  actorId: string,
  input: unknown,
  policy: EducationPolicy = localPolicy,
) {
  const body = object(input)
  exact(body, [
    'action',
    'applicationId',
    'expected',
    'clearance',
    'evidence',
    'withdrawn',
    'decision',
    'reason',
    'restoreWithdrawal',
  ])
  if (body.action !== undefined)
    requireValue(body.action === 'education-review', 'Invalid education action')
  const expected = object(body.expected),
    rawClearance = object(body.clearance),
    rawEvidence = object(body.evidence)
  exact(expected, [
    'applicationRevision',
    'personRevision',
    'sourceFingerprint',
    'decisionVersion',
  ])
  exact(rawClearance, criteria)
  exact(rawEvidence, criteria)
  const clearance = {} as EducationClearance,
    evidence = {} as EducationEvidence
  for (const key of criteria) {
    requireValue(
      typeof rawClearance[key] === 'boolean',
      'Each clearance criterion requires a fresh boolean review',
    )
    clearance[key] = rawClearance[key]
    evidence[key] = bounded(rawEvidence[key], key)
  }
  requireValue(
    typeof body.withdrawn === 'boolean',
    'Current withdrawal decision required',
  )
  requireValue(
    body.restoreWithdrawal === undefined ||
      typeof body.restoreWithdrawal === 'boolean',
    'Explicit withdrawal restoration must be boolean',
  )
  requireValue(
    body.decision === 'cleared' ||
      body.decision === 'held' ||
      body.decision === 'revoked',
    'Select a structured education decision',
  )
  const reason = bounded(body.reason, 'Review reason'),
    decision = body.decision,
    withdrawn = body.withdrawn
  requireValue(
    decision !== 'cleared' ||
      (!withdrawn && criteria.every((key) => clearance[key])),
    'Cleared requires all four verified criteria and no withdrawal',
  )
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7031926)`)
    const actor = await actorFor(tx, actorId, policy),
      binding = await bindingFor(tx, body.applicationId, policy)
    const previous = await latestFor(tx, binding.application.id)
    requireValue(
      expected.applicationRevision === binding.application.revision &&
        expected.personRevision === binding.person.revision &&
        expected.sourceFingerprint === binding.sourceFingerprint &&
        expected.decisionVersion ===
          (previous?.decisionVersion ??
            (await initialReceiverVersion(tx, binding.application.id, policy))),
      'Education review changed; refresh the current revisions and source',
      409,
    )
    requireValue(
      !binding.withdrawn || withdrawn,
      'Current source withdrawal must be resolved before restoring eligibility',
      409,
    )
    requireValue(
      !previous?.withdrawn || withdrawn || body.restoreWithdrawal === true,
      'Explicit withdrawal restoration review is required',
      409,
    )
    requireValue(
      decision !== 'cleared' || !binding.holds.length,
      'Identity or source evidence is held; clearance is unavailable',
      409,
    )
    const saved = await appendDecision(
      tx,
      actor,
      binding,
      previous,
      {
        decision,
        withdrawn,
        clearance,
        evidence,
        reason,
      },
      policy,
    )
    return snapshot(tx, binding, saved, policy)
  })
}
function verifiedReceipt(
  value: unknown,
  entry: typeof educationOutbox.$inferSelect,
  latest: Decision,
  policy: EducationPolicy,
) {
  const receipt = object(value)
  const fields = [
    'success',
    'environment',
    'event_id',
    'result',
    'received_at',
    'current_status',
    'decision_version',
  ]
  exact(receipt, fields)
  requireValue(
    Object.keys(receipt).length === fields.length &&
      receipt.success === true &&
      receipt.environment === policy.environment &&
      receipt.event_id === entry.eventId &&
      (receipt.result === 'accepted' || receipt.result === 'duplicate') &&
      typeof receipt.received_at === 'string' &&
      Number.isFinite(Date.parse(receipt.received_at)) &&
      new Date(receipt.received_at).toISOString() === receipt.received_at &&
      (receipt.current_status === 'ready' ||
        receipt.current_status === 'held' ||
        receipt.current_status === 'withdrawn') &&
      typeof receipt.decision_version === 'number' &&
      Number.isSafeInteger(receipt.decision_version) &&
      receipt.decision_version >= latest.decisionVersion &&
      receipt.decision_version <= 1000000,
    'Invalid synthetic handoff receipt',
  )
  const expected =
    latest.withdrawn || latest.decision === 'revoked'
      ? 'withdrawn'
      : latest.decision === 'cleared'
        ? 'ready'
        : 'held'
  requireValue(
    receipt.result !== 'accepted' ||
      receipt.decision_version === latest.decisionVersion,
    'Receipt accepted the wrong decision version',
  )
  requireValue(
    receipt.decision_version !== latest.decisionVersion ||
      receipt.current_status === expected,
    'Receipt current status does not match this decision',
  )
  return {
    success: true,
    environment: policy.environment,
    event_id: entry.eventId,
    result: receipt.result,
    received_at: receipt.received_at,
    current_status: receipt.current_status,
    decision_version: receipt.decision_version,
  }
}
export async function dispatchEducation(
  db: Database,
  actorId: string,
  applicationId: unknown,
  send: (rawBody: string) => Promise<unknown>,
  policy: EducationPolicy = localPolicy,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7031926)`)
    const actor = await actorFor(tx, actorId, policy),
      binding = await bindingFor(tx, applicationId, policy)
    const latest = await reconcile(
      tx,
      actor,
      binding,
      await latestFor(tx, binding.application.id),
      policy,
    )
    requireValue(latest, 'A current structured HR decision is required', 409)
    const [entry] = await tx
      .select()
      .from(educationOutbox)
      .where(eq(educationOutbox.decisionId, latest.id))
    requireValue(
      entry &&
        entry.status !== 'superseded' &&
        createHash('sha256').update(entry.rawBody).digest('hex') ===
          entry.bodyHash,
      'Current immutable handoff body unavailable',
      409,
    )
    await tx
      .update(educationOutbox)
      .set({
        attempts: entry.attempts + 1,
        lastAttemptAt: new Date(),
        lastError: null,
      })
      .where(eq(educationOutbox.id, entry.id))
    try {
      const receipt = verifiedReceipt(
        await send(entry.rawBody),
        entry,
        latest,
        policy,
      )
      await tx
        .update(educationOutbox)
        .set({ status: 'delivered', receipt })
        .where(eq(educationOutbox.id, entry.id))
    } catch {
      await tx
        .update(educationOutbox)
        .set({ status: 'failed', lastError: 'dispatch_failed' })
        .where(eq(educationOutbox.id, entry.id))
    }
    return snapshot(tx, binding, latest, policy)
  })
}
