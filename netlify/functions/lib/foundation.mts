import { createHash, randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { records, members, audit } from '../../../db/schema'
import { normalize } from '../../../src/lib/rules'
import {
  accessLevels,
  affiliations,
  contactPermissions,
  foundationKinds,
  hasHrAccess,
  isHrWorkflow,
  learningProgress,
  resourceStatuses,
  workflows,
} from '../../../src/lib/foundation'

import type { database } from '../../../db/index'
import type {
  FoundationRequest,
  RecordData,
  RecordEnvelope,
} from '../../../src/lib/crm-types'
import type { FoundationWorkflow } from '../../../src/lib/foundation'
type Row = typeof records.$inferSelect
type Member = typeof members.$inferSelect
type Actor = Pick<Member, 'role'> & Partial<Member>
type ScopeRecord = RecordEnvelope

function check(value: unknown, message: string, status = 400): asserts value {
  if (!value) throw Object.assign(new Error(message), { status })
}
function oneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === 'string' && values.some((item) => item === value)
}
function validWorkflow(value: unknown): value is FoundationWorkflow {
  return typeof value === 'string' && Object.hasOwn(workflows, value)
}
const manager = (a: Actor) => ['owner', 'manager'].includes(a.role)
const text = (v: unknown, max = 10000) =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''
const email = (v: unknown) => text(v, 254).toLowerCase()
const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
const https = (v: unknown) => {
  try {
    return (
      typeof v === 'string' &&
      new URL(v).protocol === 'https:' &&
      !new URL(v).username &&
      !new URL(v).password
    )
  } catch {
    return false
  }
}
const linkedKeys = [
  'personId',
  'contactId',
  'resourceId',
  'proposalId',
  'researchId',
]
const privateRecord = (r: ScopeRecord) =>
  r.access === 'hr' ||
  r.kind === 'application' ||
  (r.kind === 'intake' && isHrWorkflow(r.data?.workflow)) ||
  r.data?.audience === 'hr'

// Check restricted scope before role, assignment, reader or parent inheritance.
// Old children and selector links cannot turn restricted HR data into shared data.
export function createFoundationScope(actor: Actor, rows: ScopeRecord[]) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  return (r: ScopeRecord): boolean => {
    if (hasHrAccess(actor)) return true
    const visit = (item: ScopeRecord, seen: Set<string>): boolean => {
      if (privateRecord(item)) return false
      if (item.id && seen.has(item.id)) return true
      if (item.id) seen.add(item.id)
      const nestedIds = (value: unknown): string[] =>
        typeof value === 'string'
          ? byId.has(value)
            ? [value]
            : []
          : Array.isArray(value)
            ? value.flatMap(nestedIds)
            : value && typeof value === 'object'
              ? Object.values(value).flatMap(nestedIds)
              : []
      const ids = [
        item.parentId,
        item.organizationId,
        ...linkedKeys.map((k) => item.data?.[k]),
        ...nestedIds(item.data),
      ]
      return ids.every(
        (id) =>
          typeof id !== 'string' ||
          !id ||
          !byId.has(id) ||
          visit(byId.get(id)!, seen),
      )
    }
    return visit(r, new Set())
  }
}
export function createFoundationRead(actor: Actor, rows: ScopeRecord[]) {
  const scope = createFoundationScope(actor, rows)
  const direct = (r: ScopeRecord) =>
    scope(r) &&
    (manager(actor) ||
      r.access === 'team' ||
      r.kind === 'offer' ||
      r.ownerId === actor.id ||
      r.data?.assigneeId === actor.id ||
      r.data?.deliveryLead === actor.id ||
      (Array.isArray(r.data?.readers) &&
        !!actor.id &&
        r.data.readers.includes(actor.id)))
  return (r: ScopeRecord): boolean =>
    scope(r) &&
    (direct(r) ||
      (r.kind !== 'learning' &&
        !!r.parentId &&
        rows.some((p) => p.id === r.parentId && direct(p))))
}
export function sanitizeFoundationRows(
  rows: Row[],
  canRead: (r: Row) => boolean,
) {
  const visible = new Set(rows.filter(canRead).map((r) => r.id))
  return rows.filter(canRead).map((r) => ({
    ...r,
    data: {
      ...r.data,
      ...(Array.isArray(r.data?.duplicateCandidates)
        ? {
            duplicateCandidates: r.data.duplicateCandidates.filter(
              (id: string) => visible.has(id),
            ),
          }
        : {}),
      ...(Array.isArray(r.data?.candidatePersonIds)
        ? {
            candidatePersonIds: r.data.candidatePersonIds.filter((id: string) =>
              visible.has(id),
            ),
          }
        : {}),
    },
  }))
}
function permission(d: RecordData, old?: Row) {
  if (
    old?.data?.contactPermission === 'Do not contact' ||
    old?.data?.suppressed === true
  ) {
    check(
      d.contactPermission !== 'Marketing permitted',
      'Permanent no-contact restrictions cannot be upgraded to marketing permission',
    )
    return 'Do not contact'
  }
  const value = d.contactPermission || old?.data?.contactPermission || 'Unknown'
  check(oneOf(contactPermissions, value), 'Select a valid contact permission')
  if (value === 'Marketing permitted')
    check(
      https(d.permissionEvidence || old?.data?.permissionEvidence),
      'Explicit marketing permission evidence requires an HTTPS source',
    )
  return value
}
function provenance(d: RecordData) {
  const out: RecordData = {}
  for (const k of ['sourceName', 'sourceId', 'sourceVersion', 'sourceRow'])
    if (d[k] != null) out[k] = text(String(d[k]), 300)
  for (const k of ['sourceCreatedAt', 'sourceUpdatedAt']) {
    if (d[k] == null || d[k] === '') continue
    const value = text(String(d[k]), 100)
    check(
      /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
        Number.isFinite(Date.parse(value)),
      `${k === 'sourceUpdatedAt' ? 'Updated' : 'Created'} source timestamps require an ISO timestamp with Z or an explicit timezone offset`,
    )
    out[k] = new Date(value).toISOString()
  }
  if (d.sourceUrl) {
    check(https(d.sourceUrl), 'Source link must use HTTPS')
    out.sourceUrl = d.sourceUrl
  }
  return out
}
// Applicant detail stays in restricted application/intake payloads. This is not
// an HR clearance decision and never grants staff access or learner eligibility.
function applicantDetails(d: RecordData) {
  const details: RecordData = {}
  for (const key of [
    'applicantId',
    'personSourceId',
    'applicationSourceId',
    'program',
    'cohort',
    'onboardingStatus',
  ])
    if (d[key]) details[key] = text(d[key], 300)
  if (d.participationState) {
    const state = text(d.participationState, 40).toLowerCase()
    check(
      oneOf(['active', 'withdrawn', 'revoked', 'unknown'], state),
      'Current source state must be active, withdrawn, revoked, or unknown',
    )
    details.participationState = state
  }
  if (d.resumeUrl) {
    check(https(d.resumeUrl), 'Resume link must use HTTPS')
    details.resumeUrl = text(d.resumeUrl, 2000)
  }
  if (d.fieldProvenance && typeof d.fieldProvenance === 'object')
    details.fieldProvenance = d.fieldProvenance
  return details
}
function accountable(d: RecordData) {
  check(text(d.nextAction, 1000), 'A next action is required for pending work')
  check(
    typeof d.nextDue === 'string' && Number.isFinite(Date.parse(d.nextDue)),
    'A valid next-action due date is required',
  )
  return {
    nextAction: text(d.nextAction, 1000),
    nextDue: new Date(d.nextDue).toISOString(),
  }
}
function suppressed(
  rows: Row[],
  d: RecordData,
  organizationId?: string | null,
) {
  const identities = [
    d.email,
    d.phone,
    d.website,
    rows.find((r) => r.id === organizationId)?.data?.website,
  ]
    .filter(Boolean)
    .map((v) => normalize(String(v)))
  return rows.some(
    (r) =>
      r.kind === 'suppression' &&
      ((r.organizationId && r.organizationId === organizationId) ||
        identities.includes(normalize(r.data?.identity || ''))),
  )
}
// Only mapped source evidence participates. Review decisions, duplicate hints,
// server stamps, fingerprints and caller-supplied derived fields are excluded.
// CRM next-action/due defaults are operational follow-up, not source facts;
// re-opening the mapper must not turn an identical source into a conflict.
const intakeSourceKeys = [
  'workflow',
  'sourceName',
  'sourceId',
  'sourceVersion',
  'sourceRow',
  'sourceUrl',
  'sourceCreatedAt',
  'sourceUpdatedAt',
  'name',
  'email',
  'organization',
  'contactPermission',
  'permissionEvidence',
] as const
const applicantSourceKeys = [
  'applicantId',
  'personSourceId',
  'applicationSourceId',
  'program',
  'cohort',
  'resumeUrl',
  'onboardingStatus',
  'participationState',
  'fieldProvenance',
] as const
const organizationSourceKeys = [
  'sourceName',
  'sourceId',
  'sourceVersion',
  'sourceRow',
  'sourceUrl',
  'sourceCreatedAt',
  'sourceUpdatedAt',
  'name',
  'website',
  'organizationType',
  'location',
  'notes',
  'nextAction',
  'nextDue',
] as const
const resourceSourceKeys = [
  'sourceName',
  'sourceId',
  'sourceVersion',
  'sourceRow',
  'sourceUrl',
  'sourceCreatedAt',
  'sourceUpdatedAt',
  'name',
  'resourceType',
  'body',
  'assetUrl',
  'description',
  'category',
  'organization',
] as const
const isUnreconciledStableId = (value: unknown) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase() === 'PENDING RECONCILIATION'
function intakeSourceFingerprint(
  data: RecordData,
  hr: boolean,
  batchType = 'contacts',
) {
  const keys = [
    ...(batchType === 'organizations'
      ? organizationSourceKeys
      : batchType === 'resources'
        ? resourceSourceKeys
        : [...intakeSourceKeys, ...(hr ? applicantSourceKeys : [])]),
  ].sort()
  const normalized = keys.map((key) => {
    let value =
      key === 'fieldProvenance'
        ? JSON.stringify(data[key] || {})
        : typeof data[key] === 'string'
          ? data[key].trim()
          : ''
    if (key === 'sourceName' || key === 'email') value = value.toLowerCase()
    if (key === 'contactPermission' && !value) value = 'Unknown'
    return [key, value]
  })
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}
function intakeSourceData(
  raw: RecordData,
  sourceName: string,
  sourceId: string,
  workflow: string,
  hr: boolean,
): RecordData {
  const source = provenance({ ...raw, sourceName, sourceId })
  const rawColumns = raw.sourceFieldColumns
  const sourceFieldColumns =
    rawColumns && typeof rawColumns === 'object' && !Array.isArray(rawColumns)
      ? rawColumns
      : {}
  const sourceFields = [
    ...intakeSourceKeys,
    ...(hr
      ? applicantSourceKeys.filter((key) => key !== 'fieldProvenance')
      : []),
  ]
  const fieldProvenance = Object.fromEntries(
    sourceFields.flatMap((key) => {
      const column = text(sourceFieldColumns[key], 300)
      if (!column && !raw[key]) return []
      return [
        [
          key,
          {
            sourceName,
            sourceId,
            sourceVersion: text(raw.sourceVersion, 300),
            sourceRow: text(raw.sourceRow, 300),
            sourceUrl: source.sourceUrl || '',
            sourceCreatedAt: source.sourceCreatedAt || '',
            sourceUpdatedAt: source.sourceUpdatedAt || '',
            sourceColumn: column,
          },
        ],
      ]
    }),
  )
  return {
    ...source,
    workflow,
    name: text(raw.name, 300),
    email: email(raw.email),
    organization: text(raw.organization, 300),
    contactPermission: permission(raw),
    permissionEvidence: text(raw.permissionEvidence, 1000),
    ...(hr ? applicantDetails({ ...raw, fieldProvenance }) : {}),
    ...(hr ? { fieldProvenance } : {}),
    ...accountable(raw),
  }
}
function mappedSourceProvenance(
  raw: RecordData,
  sourceName: string,
  sourceId: string,
) {
  const source = provenance({ ...raw, sourceName, sourceId })
  const columns =
    raw.sourceFieldColumns &&
    typeof raw.sourceFieldColumns === 'object' &&
    !Array.isArray(raw.sourceFieldColumns)
      ? raw.sourceFieldColumns
      : {}
  const keys = [...organizationSourceKeys, ...resourceSourceKeys]
  const fieldProvenance = Object.fromEntries(
    [...new Set(keys)].flatMap((key) => {
      const column = text(columns[key], 300)
      if (!column && !raw[key]) return []
      return [
        [
          key,
          {
            sourceName,
            sourceId,
            sourceVersion: text(raw.sourceVersion, 300),
            sourceRow: text(raw.sourceRow, 300),
            sourceUrl: source.sourceUrl || '',
            sourceCreatedAt: source.sourceCreatedAt || '',
            sourceUpdatedAt: source.sourceUpdatedAt || '',
            sourceColumn: column,
          },
        ],
      ]
    }),
  )
  return { ...source, fieldProvenance }
}
function organizationSourceData(
  raw: RecordData,
  sourceName: string,
  sourceId: string,
) {
  const source = mappedSourceProvenance(raw, sourceName, sourceId)
  return {
    ...source,
    name: text(raw.name, 300),
    website: text(raw.website, 1000),
    organizationType: text(raw.organizationType, 300),
    location: text(raw.location, 300),
    notes: text(raw.notes),
    nextAction: text(raw.nextAction, 1000),
    nextDue: text(raw.nextDue, 100),
  }
}
function resourceSourceData(
  raw: RecordData,
  sourceName: string,
  sourceId: string,
) {
  const source = mappedSourceProvenance(raw, sourceName, sourceId)
  return {
    ...source,
    name: text(raw.name, 300),
    resourceType: text(raw.resourceType, 40).toLowerCase(),
    body: text(raw.body, 50000),
    assetUrl: text(raw.assetUrl, 2000),
    description: text(raw.description, 10000),
    category: text(raw.category, 300),
    organization: text(raw.organization, 300),
  }
}
const stableKey = (source: string, id: string) =>
  createHash('sha256')
    .update(JSON.stringify([source.trim().toLowerCase(), id.trim()]))
    .digest('hex')

export async function handleFoundation(
  db: ReturnType<typeof database>,
  requestActor: Member,
  body: FoundationRequest,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7031926)`)
    const staff: Member[] = await tx.select().from(members)
    const actor = staff.find((member) => member.id === requestActor.id)
    check(
      actor?.active &&
        actor.email.toLowerCase() === requestActor.email.toLowerCase(),
      'Current active staff identity required.',
      403,
    )
    check(actor.role !== 'viewer', 'You cannot change foundation records.', 403)
    const rows: Row[] = await tx.select().from(records)
    const canRead = createFoundationRead(actor, rows)
    const activeOwner = (id: unknown, hr = false, unchanged = false) => {
      const owner = staff.find((s) => s.id === id && s.active)
      check(owner, 'An active accountable owner is required')
      check(
        !hr || hasHrAccess(owner),
        'Restricted HR work requires an owner with HR access',
        403,
      )
      check(
        manager(actor) || id === actor.id || unchanged,
        'Only managers assign work to other staff.',
        403,
      )
      return owner.id
    }
    const link = (id: unknown, kind?: string) => {
      const found = rows.find((r) => r.id === id && (!kind || r.kind === kind))
      check(
        found && canRead(found),
        'Selected linked record unavailable or access denied',
        403,
      )
      return found
    }
    const insert = async (v: typeof records.$inferInsert): Promise<Row> =>
      (await tx.insert(records).values(v).returning())[0]
    const update = async (
      old: Row,
      v: Partial<typeof records.$inferInsert>,
      revision: number | undefined,
    ) => {
      check(
        typeof revision === 'number' && old.revision === revision,
        'Record changed; refresh and review.',
        409,
      )
      const [saved] = await tx
        .update(records)
        .set({ ...v, revision: old.revision + 1, updatedAt: new Date() })
        .where(and(eq(records.id, old.id), eq(records.revision, revision)))
        .returning()
      check(saved, 'Concurrent edit conflict; refresh and review.', 409)
      return saved
    }
    const log = async (
      saved: Row,
      old: Row | undefined,
      action = 'foundation saved',
    ) => {
      await tx.insert(audit).values({
        recordId: saved.id,
        actorId: actor.id,
        action,
        before: old || null,
        after: saved,
      })
    }
    const updateIntakeBatchReceipt = async (
      intake: Row,
      outcome: 'accepted' | 'excluded',
    ) => {
      const receipts = rows.filter(
        (r) =>
          r.kind === 'import' &&
          (r.id === intake.data.batchReceiptId ||
            (Array.isArray(r.data.targetIds) &&
              r.data.targetIds.includes(intake.id))),
      )
      for (const receipt of receipts) {
        const priorCounts = receipt.data.counts
        const counts =
          priorCounts &&
          typeof priorCounts === 'object' &&
          !Array.isArray(priorCounts)
            ? { ...priorCounts }
            : {}
        const openBefore = Number(counts.open || 0)
        if (openBefore < 1) continue
        const blocker = (
          Array.isArray(receipt.data.blockers)
            ? receipt.data.blockers.find(
                (entry) =>
                  entry &&
                  typeof entry === 'object' &&
                  !Array.isArray(entry) &&
                  entry.targetId === intake.id,
              )
            : undefined
        ) as Record<string, unknown> | undefined
        const bucket =
          blocker?.status === 'invalid'
            ? 'failed'
            : blocker
              ? 'held'
              : 'reviewReady'
        counts[bucket] = Math.max(0, Number(counts[bucket] || 0) - 1)
        const accepted =
          Number(counts.accepted || 0) + Number(outcome === 'accepted')
        const excluded =
          Number(counts.excluded || 0) + Number(outcome === 'excluded')
        const created =
          Number(counts.created || 0) +
          Number(outcome === 'accepted' && intake.data.resultType === 'created')
        const matched =
          Number(counts.matched || 0) +
          Number(outcome === 'accepted' && intake.data.resultType === 'matched')
        const open = openBefore - 1
        const blockers = Array.isArray(receipt.data.blockers)
          ? receipt.data.blockers.filter(
              (blocker) =>
                !blocker ||
                typeof blocker !== 'object' ||
                Array.isArray(blocker) ||
                blocker.targetId !== intake.id,
            )
          : []
        const saved = await update(
          receipt,
          {
            data: {
              ...receipt.data,
              counts: { ...counts, accepted, excluded, created, matched, open },
              blockers,
              status: open > 0 ? 'queued for review' : 'reviewed',
              lastReviewerId: actor.id,
              lastReviewedAt: new Date().toISOString(),
            },
          },
          receipt.revision,
        )
        await log(saved, receipt, 'intake batch receipt updated')
        Object.assign(receipt, saved)
      }
    }
    // One permanent identity register is also consumed by the original sales guards.
    // Keep it inside the same advisory-locked transaction as the originating change.
    const registerNoContact = async (
      details: RecordData,
      prior: RecordData | undefined,
      organizationId: string | null,
      hr: boolean,
      personId?: string,
    ) => {
      const ids = [
        details.email,
        details.phone,
        details.website,
        prior?.email,
        prior?.phone,
        prior?.website,
      ]
        .filter(Boolean)
        .map((v) => normalize(String(v)))
      check(
        ids.length,
        'No-contact requires a stable email, phone, or website identity',
      )
      for (const identity of new Set(ids)) {
        if (
          rows.some(
            (r) =>
              r.kind === 'suppression' &&
              normalize(r.data.identity || '') === identity,
          )
        )
          continue
        const saved = await insert({
          kind: 'suppression',
          title: 'Permanent no-contact restriction',
          access: hr ? 'hr' : 'record',
          ownerId: actor.id,
          sourceKey: `foundation-dnc:${stableKey('identity', identity)}`,
          data: {
            identity,
            reason: 'Contact permission recorded as Do not contact',
            method: 'Reviewed CRM record',
            appliedBy: actor.id,
            appliedAt: new Date().toISOString(),
          },
        })
        rows.push(saved)
        await log(saved, undefined, 'no-contact identity registered')
      }
      const personIds = new Set(
        rows
          .filter(
            (r) =>
              r.kind === 'contact' &&
              [r.data.email, r.data.phone, r.data.website]
                .filter(Boolean)
                .map((v) => normalize(String(v)))
                .some((v) => ids.includes(v)),
          )
          .map((r) => r.id),
      )
      if (personId) personIds.add(personId)
      for (const target of rows.filter((r) =>
        [
          'contact',
          'engagement',
          'application',
          'opportunity',
          'research',
        ].includes(r.kind),
      )) {
        const identities = [
          target.data.email,
          target.data.phone,
          target.data.website,
          target.data.sourceUrl,
          ...rows
            .filter(
              (c) =>
                c.kind === 'contact' &&
                c.organizationId &&
                c.organizationId === target.organizationId,
            )
            .flatMap((c) => [c.data.email, c.data.phone]),
        ]
          .filter(Boolean)
          .map((v) => normalize(String(v)))
        if (
          !personIds.has(target.id) &&
          !(target.data.personId && personIds.has(target.data.personId)) &&
          !identities.some((v) => ids.includes(v)) &&
          !(
            organizationId &&
            target.organizationId === organizationId &&
            !personId
          )
        )
          continue
        if (
          target.data.suppressed === true &&
          (target.kind !== 'opportunity' || target.data.stage === 'X4')
        )
          continue
        const next = {
          ...target.data,
          suppressed: true,
          contactPermission: 'Do not contact',
          ...(target.kind === 'opportunity'
            ? {
                stage: 'X4',
                stageReason: 'Permanent no-contact restriction',
                closeReason: 'Permanent no-contact restriction',
                closedAt: new Date().toISOString(),
              }
            : {}),
        }
        const saved = await update(target, { data: next }, target.revision)
        await log(saved, target, 'no-contact propagated')
        Object.assign(target, saved)
      }
    }

    if (body.action === 'foundation-save') {
      const input = body.record
      check(
        input && oneOf(foundationKinds, input.kind) && input.kind !== 'intake',
        'Unsupported foundation record type',
      )
      check(
        typeof input.title === 'string' &&
          text(input.title, 300) &&
          input.title.length < 300,
        'A title is required (maximum 300 characters)',
      )
      check(
        input.data &&
          typeof input.data === 'object' &&
          !Array.isArray(input.data),
        'Record details required',
      )
      const old = rows.find((r) => r.id === input.id)
      if (input.id) {
        check(old && canRead(old), 'Record unavailable or access denied', 403)
        check(
          old.kind === input.kind && old.revision === input.revision,
          'Record changed; refresh and review.',
          409,
        )
        check(
          manager(actor) ||
            old.ownerId === actor.id ||
            (old.kind === 'learning' && old.data.assigneeId === actor.id),
          'You cannot edit this record.',
          403,
        )
        check(
          old.kind !== 'resource' || old.data.status !== 'Approved',
          'Approved resource versions are immutable; create a new version',
        )
        check(
          (old.organizationId || null) === (input.organizationId || null),
          'Organization links are immutable; create a reviewed record instead',
        )
      }
      const d = input.data
      let access = input.access || old?.access || 'team'
      check(oneOf(accessLevels, access), 'Invalid access scope')
      if (input.kind === 'application' || d.audience === 'hr') access = 'hr'
      check(
        !old || old.access !== 'hr' || access === 'hr',
        'Restricted records cannot be downgraded to shared access',
        403,
      )
      check(
        !old || (old.access || 'record') === access || manager(actor),
        'Only managers change existing record access.',
        403,
      )
      check(access !== 'hr' || hasHrAccess(actor), 'HR access required', 403)
      const ownerId = activeOwner(
        input.ownerId || old?.ownerId || actor.id,
        access === 'hr',
        !!old && old.ownerId === (input.ownerId || old.ownerId),
      )
      const organizationId = input.organizationId || null
      if (organizationId) {
        const org = link(organizationId, 'organization')
        check(
          access === 'hr' || !privateRecord(org),
          'Shared records cannot link restricted records',
          403,
        )
      }
      if (input.parentId) link(input.parentId)
      let data: RecordData = { ...provenance(d) }
      let sourceKey = old?.sourceKey || null
      if (['organization', 'contact'].includes(input.kind)) {
        data = {
          ...data,
          foundationVersion: 1,
          notes: text(d.notes),
          ...accountable(d),
        }
        if (input.kind === 'contact') {
          const e = email(d.email)
          check(!e || validEmail(e), 'Enter a valid email address')
          // Match globally without exposing IDs or private identities in an error.
          check(
            !e ||
              !rows.some(
                (r) =>
                  r.kind === 'contact' &&
                  r.id !== old?.id &&
                  email(r.data.email) === e,
              ),
            'A person with this email already exists. Review the directory or ask an authorized manager.',
            409,
          )
          data = {
            ...data,
            name: text(d.name || input.title, 300),
            email: e,
            phone: text(d.phone, 100),
            contactPreference: oneOf(
              ['Email', 'Phone', 'Other'],
              d.contactPreference,
            )
              ? d.contactPreference
              : '',
            contactPermission: permission(d, old),
            permissionEvidence: text(
              d.permissionEvidence || old?.data.permissionEvidence,
              1000,
            ),
          }
        } else {
          check(!d.website || https(d.website), 'Website must use HTTPS')
          data.website = text(d.website, 1000)
          data.organizationType = text(d.organizationType, 300)
          data.location = text(d.location, 300)
        }
        data.suppressed =
          old?.data.suppressed === true ||
          suppressed(rows, data, organizationId)
        if (data.suppressed) data.contactPermission = 'Do not contact'
      }
      if (input.kind === 'affiliation') {
        const person = link(d.personId, 'contact')
        check(organizationId, 'An organization is required for an affiliation')
        check(
          oneOf(affiliations, d.relationship),
          'Select an affiliation relationship',
        )
        check(
          access === 'hr' || !privateRecord(person),
          'Shared records cannot link restricted people',
          403,
        )
        data = {
          ...data,
          personId: person.id,
          relationship: d.relationship,
          jobTitle: text(d.jobTitle, 300),
          ...accountable(d),
        }
      }
      if (['engagement', 'application'].includes(input.kind)) {
        check(validWorkflow(d.workflow), 'Select a valid workflow')
        check(
          (input.kind === 'application') === isHrWorkflow(d.workflow),
          'Applicant workflows require restricted application records',
        )
        check(
          oneOf(workflows[d.workflow], d.stage),
          'Select a stage for this workflow',
        )
        const person = link(d.personId, 'contact')
        check(
          access === 'hr' || !privateRecord(person),
          'Shared records cannot link restricted people',
          403,
        )
        check(
          !old || old.data.workflow === d.workflow,
          'Workflow is immutable; create a separate engagement',
        )
        data = {
          ...data,
          personId: person.id,
          workflow: d.workflow,
          stage: d.stage,
          notes: text(d.notes),
          contactPermission: permission(d, old),
          ...accountable(d),
        }
        if (input.kind === 'application')
          data = { ...data, ...applicantDetails(d) }
        else
          for (const key of ['className', 'timezone', 'registrationStatus'])
            if (d[key]) data[key] = text(d[key], 300)
        if (d.sessionDate) {
          check(
            Number.isFinite(Date.parse(d.sessionDate)),
            'Session date must be a valid date',
          )
          data.sessionDate = new Date(d.sessionDate).toISOString()
        }
        data.suppressed =
          old?.data.suppressed === true ||
          person.data.suppressed === true ||
          suppressed(rows, person.data, organizationId)
        if (data.suppressed) data.contactPermission = 'Do not contact'
      }
      if (input.kind === 'resource') {
        check(
          oneOf(['template', 'training'], d.resourceType),
          'Select template or training',
        )
        check(oneOf(resourceStatuses, d.status), 'Select a resource status')
        check(oneOf(['team', 'hr'], d.audience), 'Select a resource audience')
        check(!d.assetUrl || https(d.assetUrl), 'Asset link must use HTTPS')
        check(
          text(d.body) || d.assetUrl,
          'Add resource content or an HTTPS asset link',
        )
        const familyId = old?.data.familyId || d.familyId || randomUUID()
        const family = rows.filter(
          (r) => r.kind === 'resource' && r.data.familyId === familyId,
        )
        if (!old && d.familyId)
          check(
            family.length && family.every(canRead),
            'Resource family unavailable or access denied',
            403,
          )
        const version =
          old?.data.version ||
          Math.max(0, ...family.map((r) => Number(r.data.version) || 0)) + 1
        check(
          !d.version || Number(d.version) === version,
          'Resource version changed; refresh and review.',
          409,
        )
        check(
          !family.length ||
            family.every(
              (r) =>
                r.data.resourceType === d.resourceType &&
                r.data.audience === d.audience,
            ),
          'Resource type and audience are fixed within a family',
        )
        data = {
          ...data,
          resourceType: d.resourceType,
          status: d.status,
          audience: d.audience,
          familyId,
          version,
          body: text(d.body, 50000),
          assetUrl: text(d.assetUrl, 2000),
          description: text(d.description),
          category: text(d.category, 300),
        }
        access = d.audience
        sourceKey = `${familyId}:${version}`
        if (d.status === 'Approved') {
          check(
            actor.role === 'owner',
            'Only the owner approves resource versions.',
            403,
          )
          check(text(d.approvalReason, 1000), 'An approval reason is required')
          data.approvalReason = text(d.approvalReason, 1000)
          data.approvedBy = actor.id
          data.approvedAt = new Date().toISOString()
        } else if (d.status !== 'Archived')
          data = { ...data, ...accountable(d) }
      }
      if (input.kind === 'learning') {
        const resource = link(d.resourceId, 'resource')
        check(
          resource.data.resourceType === 'training' &&
            resource.data.status === 'Approved',
          'Assign an approved training version',
        )
        const assignee = staff.find((s) => s.id === d.assigneeId && s.active)
        check(assignee, 'Select an active staff learner')
        check(
          manager(actor) ||
            (old &&
              old.data.assigneeId === actor.id &&
              d.assigneeId === actor.id),
          'Manager access required to assign learning',
          403,
        )
        check(
          !old ||
            (old.data.resourceId === d.resourceId &&
              old.data.assigneeId === d.assigneeId),
          'Learning resource and learner are immutable',
        )
        check(
          oneOf(learningProgress, d.progress),
          'Select a learning progress status',
        )
        check(
          !d.worksheetUrl || https(d.worksheetUrl),
          'Worksheet link must use HTTPS',
        )
        access = resource.data.audience === 'hr' ? 'hr' : 'record'
        check(
          access !== 'hr' || hasHrAccess(assignee),
          'Restricted training requires a learner with HR access',
          403,
        )
        data = {
          ...data,
          resourceId: resource.id,
          resourceVersion: resource.data.version,
          assigneeId: assignee.id,
          progress: d.progress,
          worksheetUrl: text(d.worksheetUrl, 2000),
          notes: text(d.notes),
          ...accountable(d),
        }
        if (d.personId) data.personId = link(d.personId, 'contact').id
        if (d.progress === 'Completed') {
          check(
            manager(actor),
            'Manager access required to verify learning completion',
            403,
          )
          data.completedBy = actor.id
          data.completedAt = new Date().toISOString()
        }
      }
      // Preserve existing operator-seeded local integration controls. They are
      // server-owned metadata, never accepted as new caller claims here.
      if (
        old &&
        ['application', 'contact', 'organization'].includes(input.kind)
      )
        for (const key of [
          'educationFixture',
          'crmProgramId',
          'educationProgram',
          'withdrawn',
          'identityHold',
          'sourceHold',
          'sourceChanged',
        ])
          if (Object.hasOwn(old.data, key)) data[key] = old.data[key]
      // Scope is checked again after constructing all links and forced audiences.
      const values = {
        kind: input.kind,
        title: text(input.title, 299),
        access,
        ownerId,
        parentId: input.parentId || null,
        organizationId,
        sourceKey,
        data,
        updatedAt: new Date(),
      }
      activeOwner(ownerId, access === 'hr', !!old && old.ownerId === ownerId)
      check(
        access === 'hr' ||
          createFoundationScope({ role: 'viewer', hr: false }, rows)(values),
        'Links to restricted information require HR access scope',
        403,
      )
      if (data.contactPermission === 'Do not contact') {
        const person =
          input.kind === 'contact'
            ? old
            : rows.find((r) => r.id === data.personId)
        await registerNoContact(
          input.kind === 'contact' ? data : person?.data || data,
          person?.data,
          organizationId,
          access === 'hr',
          input.kind === 'contact' ? old?.id : person?.id,
        )
        // Propagation may have revisioned this same identity; use its new locked revision.
        if (old) input.revision = old.revision
        data.suppressed = true
      }
      check(
        createFoundationScope(actor, [...rows, values])(values),
        'HR access required',
        403,
      )
      const saved = old
        ? await update(old, values, input.revision)
        : await insert(values)
      await log(saved, old)
      return { record: saved }
    }

    if (body.action === 'intake-assignment-create') {
      check(manager(actor), 'Only managers can assign import batches.', 403)
      const receipt = rows.find(
        (record) =>
          record.kind === 'import' &&
          record.id === body.receiptId &&
          !!record.data.batchId,
      )
      check(
        receipt && canRead(receipt),
        'Import preview receipt unavailable.',
        403,
      )
      const batchType = String(receipt.data.batchType || 'contacts')
      const workflow =
        batchType === 'contacts' ? String(receipt.data.workflow || '') : ''
      check(
        oneOf(['contacts', 'organizations', 'resources'], batchType) &&
          !isHrWorkflow(workflow),
        'Restricted HR batches cannot be assigned to import operators.',
        403,
      )
      const sourceName = text(receipt.data.sourceName, 300)
      const sourceVersion = Array.isArray(receipt.data.sourceVersions)
        ? receipt.data.sourceVersions.length === 1
          ? text(receipt.data.sourceVersions[0], 300)
          : ''
        : ''
      const batchIndex = Number(receipt.data.batchIndex)
      const batchCount = Number(receipt.data.batchCount)
      const mappingVersion = Number(receipt.data.mappingVersion)
      const targetIds = Array.isArray(receipt.data.targetIds)
        ? receipt.data.targetIds.filter(
            (id): id is string => typeof id === 'string',
          )
        : []
      const sourceKey = stableKey('import assignment', String(receipt.id))
      const existing = rows.find(
        (record) =>
          record.kind === 'import' &&
          record.data.assignmentType === 'intake' &&
          record.sourceKey === sourceKey,
      )
      const receiptCounts =
        receipt.data.counts &&
        typeof receipt.data.counts === 'object' &&
        !Array.isArray(receipt.data.counts)
          ? (receipt.data.counts as Record<string, unknown>)
          : {}
      check(
        sourceName &&
          sourceVersion &&
          !!receipt.data.sourceFingerprint &&
          targetIds.length > 0 &&
          targetIds.length === Number(receiptCounts.total || 0) &&
          Number.isInteger(batchIndex) &&
          batchIndex >= 1 &&
          Number.isInteger(batchCount) &&
          batchCount >= batchIndex &&
          Number.isInteger(mappingVersion) &&
          mappingVersion >= 1,
        'Only a complete, versioned preview receipt can be assigned.',
        409,
      )
      const targets = targetIds.map((id) =>
        rows.find((record) => record.kind === 'intake' && record.id === id),
      )
      check(
        targets.every(
          (target) =>
            !!target &&
            target.data.batchId === receipt.data.batchId &&
            target.data.status !== 'applied' &&
            target.data.status !== 'excluded' &&
            (target.data.batchType || 'contacts') === batchType &&
            (!target.data.batchAssignmentId ||
              (existing && target.data.batchAssignmentId === existing.id)) &&
            canRead(target),
        ),
        'Preview rows are unavailable, already assigned or already reviewed.',
        409,
      )
      const assignee = staff.find(
        (candidate) => candidate.id === body.assigneeId && candidate.active,
      )
      check(assignee, 'An active operator is required')
      check(
        assignee.role === 'contributor' && !hasHrAccess(assignee),
        'Import batches may be assigned only to active non-HR contributors.',
        403,
      )
      if (existing) {
        check(
          existing.data.assigneeId === assignee.id &&
            existing.ownerId === actor.id,
          'This source batch is already assigned to another operator.',
          409,
        )
        return { record: existing, existing: true }
      }
      const assignment = await insert({
        kind: 'import',
        title: `${sourceName} · ${batchType} · batch ${batchIndex}/${batchCount}`,
        access: 'record',
        ownerId: actor.id,
        sourceKey,
        data: {
          assignmentType: 'intake',
          batchType,
          sourceName,
          sourceVersion,
          workflow,
          batchIndex,
          batchCount,
          mappingVersion,
          batchId: receipt.data.batchId,
          sourceFingerprint: receipt.data.sourceFingerprint,
          targetIds,
          receiptId: receipt.id,
          assigneeId: assignee.id,
          assignedBy: actor.id,
          status: 'assigned',
        },
      })
      for (const target of targets) {
        const saved = await update(
          target!,
          {
            data: {
              ...target!.data,
              batchAssignmentId: assignment.id,
              assigneeId: assignee.id,
            },
          },
          target!.revision,
        )
        await log(saved, target!, 'import batch assigned')
        Object.assign(target!, saved)
      }
      const assignedReceipt = await update(
        receipt,
        {
          data: {
            ...receipt.data,
            assignmentId: assignment.id,
            assigneeId: assignee.id,
          },
        },
        receipt.revision,
      )
      Object.assign(receipt, assignedReceipt)
      await log(assignment, undefined, 'import batch assigned')
      return { record: assignment, existing: false }
    }

    const resolveBatchAssignment = (
      assignmentId: unknown,
      batchType: string,
      sourceName: string,
      sourceVersion: string,
      workflow: string,
      batchIndex: number,
      batchCount: number,
      mappingVersion: number,
      sourceRows: unknown,
    ) => {
      if (manager(actor)) return undefined
      check(
        actor.role === 'contributor' && !hasHrAccess(actor),
        'A manager-assigned non-HR import batch is required.',
        403,
      )
      const assignment = rows.find(
        (record) =>
          record.kind === 'import' &&
          record.id === assignmentId &&
          record.data.assignmentType === 'intake',
      )
      check(
        assignment &&
          assignment.data.assigneeId === actor.id &&
          assignment.data.status === 'assigned',
        'This import batch is not assigned to you.',
        403,
      )
      const assigningManager = staff.find(
        (candidate) =>
          candidate.id === assignment.ownerId &&
          candidate.active &&
          manager(candidate),
      )
      check(assigningManager, 'The import assignment is unavailable.', 403)
      check(
        !isHrWorkflow(workflow) &&
          batchType === assignment.data.batchType &&
          sourceName === assignment.data.sourceName &&
          sourceVersion === assignment.data.sourceVersion &&
          sourceVersion &&
          workflow === assignment.data.workflow &&
          batchIndex === assignment.data.batchIndex &&
          batchCount === assignment.data.batchCount &&
          mappingVersion === assignment.data.mappingVersion,
        'This source version or batch does not match your assignment.',
        403,
      )
      check(
        Array.isArray(sourceRows) &&
          sourceRows.every(
            (raw) =>
              !!raw &&
              typeof raw === 'object' &&
              text((raw as RecordData).sourceVersion, 300) === sourceVersion,
          ),
        'Every row must match the assigned source version.',
        403,
      )
      return assignment
    }

    if (body.action === 'intake-preview') {
      const batchType = body.batchType || 'contacts'
      check(
        oneOf(['contacts', 'organizations', 'resources'], batchType),
        'Select a supported import batch type',
      )
      const sourceName = text(body.sourceName, 300)
      check(sourceName && sourceName.length <= 300, 'A source name is required')
      const workflow = batchType === 'contacts' ? text(body.workflow, 100) : ''
      check(
        batchType !== 'contacts' || validWorkflow(workflow),
        'Select a valid intake workflow',
      )
      const hr = batchType === 'contacts' && isHrWorkflow(workflow)
      check(
        !hr || hasHrAccess(actor),
        'HR access required for applicant imports',
        403,
      )
      check(
        batchType === 'contacts' || !hr,
        'Only contact batches can use applicant workflows.',
        403,
      )
      check(
        Array.isArray(body.rows) &&
          body.rows.length > 0 &&
          body.rows.length <= 200,
        'Preview 1–200 mapped rows at a time',
      )
      const batchIndex = Number.isInteger(body.batchIndex)
        ? Number(body.batchIndex)
        : 1
      const batchCount = Number.isInteger(body.batchCount)
        ? Number(body.batchCount)
        : 1
      const mappingVersion = Number.isInteger(body.mappingVersion)
        ? Number(body.mappingVersion)
        : 1
      check(
        batchIndex >= 1 && batchCount >= batchIndex && batchCount <= 1000,
        'Invalid import batch position',
      )
      check(
        mappingVersion >= 1 && mappingVersion <= 20,
        'Invalid mapping version',
      )
      const sourceVersion = text(body.sourceVersion, 300)
      const assignment = resolveBatchAssignment(
        body.assignmentId,
        batchType,
        sourceName,
        sourceVersion,
        workflow,
        batchIndex,
        batchCount,
        mappingVersion,
        body.rows,
      )
      check(
        manager(actor) ||
          (body.assignmentId && assignment && actor.role === 'contributor'),
        'A manager-assigned import batch is required.',
        403,
      )
      // Validate the full batch before recording observations. If a resolved
      // source changed, commit only deduplicated evidence of that change; do not
      // partially create new preview rows from the same rejected batch.
      const mapped = body.rows.map((raw) => {
        check(raw && typeof raw === 'object', 'Mapped row required')
        const sourceId = text(String(raw.sourceId || ''), 300)
        check(sourceId, 'Every row requires its stable original source ID')
        const key = stableKey(
          batchType === 'contacts' ? sourceName : `${sourceName}\0${batchType}`,
          sourceId,
        )
        const existing = rows.find(
          (r) => r.kind === 'intake' && r.sourceKey === key,
        )
        if (existing) {
          check(
            canRead(existing),
            'Source row unavailable or access denied',
            403,
          )
          check(
            (existing.data.batchType || 'contacts') === batchType &&
              (batchType !== 'contacts' || existing.data.workflow === workflow),
            'A source row is already registered to another workflow',
            409,
          )
        }
        const sourceData =
          batchType === 'contacts'
            ? intakeSourceData(raw, sourceName, sourceId, workflow, hr)
            : batchType === 'organizations'
              ? organizationSourceData(raw, sourceName, sourceId)
              : resourceSourceData(raw, sourceName, sourceId)
        const sourceFingerprint = intakeSourceFingerprint(
          sourceData,
          hr,
          batchType,
        )
        return { raw, key, existing, sourceData, sourceFingerprint }
      })
      check(
        new Set(mapped.map((item) => item.key)).size === mapped.length,
        'This batch contains repeated stable source row IDs. Reconcile the source rows before importing.',
      )
      const contentFingerprint = createHash('sha256')
        .update(
          JSON.stringify(
            mapped.map((item) => [item.key, item.sourceFingerprint]),
          ),
        )
        .digest('hex')
      if (assignment) {
        const approvedTargetIds = Array.isArray(assignment.data.targetIds)
          ? assignment.data.targetIds
          : []
        check(
          contentFingerprint === assignment.data.sourceFingerprint &&
            mapped.length === approvedTargetIds.length &&
            mapped.every(
              (item, index) => item.existing?.id === approvedTargetIds[index],
            ),
          'Mapped content does not match the manager-approved batch receipt.',
          403,
        )
      }
      const resolvedChanges = mapped.filter(
        ({ existing, sourceFingerprint }) =>
          existing &&
          oneOf(['applied', 'excluded'], existing.data.status) &&
          sourceFingerprint !==
            (existing.data.sourceFingerprint ||
              intakeSourceFingerprint(existing.data, hr, batchType)),
      )
      if (resolvedChanges.length) {
        for (const change of resolvedChanges) {
          const existing = change.existing!
          const observations = await tx
            .select()
            .from(audit)
            .where(eq(audit.recordId, existing.id))
          const seen = observations.some(
            (entry) =>
              entry.action === 'intake resolved source changed' &&
              entry.after &&
              typeof entry.after === 'object' &&
              'incomingFingerprint' in entry.after &&
              entry.after.incomingFingerprint === change.sourceFingerprint,
          )
          if (!seen)
            await tx.insert(audit).values({
              recordId: existing.id,
              actorId: actor.id,
              action: 'intake resolved source changed',
              after: {
                incomingFingerprint: change.sourceFingerprint,
                incomingSourceVersion: change.sourceData.sourceVersion || '',
                sourceFingerprint:
                  existing.data.sourceFingerprint ||
                  intakeSourceFingerprint(existing.data, hr, batchType),
                sourceVersion: existing.data.sourceVersion || '',
              },
            })
        }
        return {
          error:
            'Reviewed source content changed; retain its history and review a separate source version.',
          status: 409,
        }
      }
      const batchId = assignment
        ? String(assignment.data.batchId)
        : stableKey(
            batchType === 'contacts'
              ? `${sourceName}\0${workflow}`
              : `${sourceName}\0${batchType}`,
            `${batchIndex}:${batchCount}:${mappingVersion}:${contentFingerprint}`,
          )
      const newReceiptId = randomUUID()
      const queue: Row[] = []
      let newRows = 0
      let existingRows = 0
      for (const { raw, key, sourceData, sourceFingerprint } of mapped) {
        const existing = rows.find(
          (r) => r.kind === 'intake' && r.sourceKey === key,
        )
        if (existing) {
          const originalFingerprint =
            existing.data.sourceFingerprint ||
            intakeSourceFingerprint(existing.data, hr, batchType)
          if (sourceFingerprint !== originalFingerprint) {
            // Keep the original evidence and decision inputs intact. A hold is
            // committed rather than thrown away with a transaction rollback.
            if (
              existing.data.sourceChanged !== true ||
              existing.data.incomingFingerprint !== sourceFingerprint
            ) {
              const saved = await update(
                existing,
                {
                  data: {
                    ...existing.data,
                    sourceFingerprint: originalFingerprint,
                    sourceFingerprintVersion: 1,
                    status: 'conflict',
                    sourceChanged: true,
                    sourceChangeReason:
                      'Mapped source content or version changed after preview. Exclude this row and use a separately reviewed source version.',
                    sourceChangedAt: new Date().toISOString(),
                    incomingFingerprint: sourceFingerprint,
                    incomingSourceVersion: sourceData.sourceVersion || '',
                  },
                },
                existing.revision,
              )
              await log(saved, existing, 'intake source changed')
              Object.assign(existing, saved)
            }
          }
          queue.push(existing)
          existingRows++
          continue
        }
        const e = sourceData.email || ''
        const name = sourceData.name || ''
        let status = 'ready'
        let identityHold = false
        let identityHoldReason = ''
        let candidatePersonIds: string[] = []
        let linkedOrganizationId = ''
        if (batchType === 'contacts') {
          const matches = rows.filter(
            (r) => r.kind === 'contact' && e && email(r.data.email) === e,
          )
          const visible = matches.filter(canRead)
          candidatePersonIds = visible.map((r) => r.id)
          const sourcePersonId = String(sourceData.personSourceId || '')
          const sourceApplicationId = String(
            sourceData.applicationSourceId || sourceData.applicantId || '',
          )
          const unresolvedPersonId = isUnreconciledStableId(sourcePersonId)
          const unresolvedApplicationId =
            isUnreconciledStableId(sourceApplicationId)
          const stablePersonId = unresolvedPersonId ? '' : sourcePersonId
          const stableApplicationId = unresolvedApplicationId
            ? ''
            : sourceApplicationId
          const applicantCases = hr
            ? rows.filter((r) => r.kind === 'application')
            : []
          const sameApplication = stableApplicationId
            ? applicantCases.filter(
                (r) =>
                  String(
                    r.data.applicationSourceId || r.data.applicantId || '',
                  ) === stableApplicationId,
              )
            : []
          const samePerson = stablePersonId
            ? applicantCases.filter(
                (r) => String(r.data.personSourceId || '') === stablePersonId,
              )
            : []
          const conflictingPersonIdentity = samePerson.some((application) => {
            const priorPerson = rows.find(
              (r) => r.kind === 'contact' && r.id === application.data.personId,
            )
            return (
              !!priorPerson &&
              !!email(priorPerson.data.email) &&
              email(priorPerson.data.email) !== e
            )
          })
          const conflictingPersonIdentityInBatch = stablePersonId
            ? mapped.some(
                (other) =>
                  other.key !== key &&
                  String(other.sourceData.personSourceId || '') ===
                    stablePersonId &&
                  String(other.sourceData.email || '') !== e,
              )
            : false
          const duplicateApplicationInBatch = stableApplicationId
            ? mapped.some(
                (other) =>
                  other.key !== key &&
                  String(
                    other.sourceData.applicationSourceId ||
                      other.sourceData.applicantId ||
                      '',
                  ) === stableApplicationId,
              )
            : false
          const identityConflict =
            unresolvedPersonId ||
            unresolvedApplicationId ||
            sameApplication.length > 0 ||
            conflictingPersonIdentity ||
            conflictingPersonIdentityInBatch ||
            duplicateApplicationInBatch
          if (
            /\b(test|example|dummy|synthetic)\b/i.test(
              `${name} ${e} ${raw.organization || ''}`,
            ) ||
            /@[^@]+\.invalid$/i.test(e)
          )
            status = 'test'
          else if (!name || !validEmail(e)) status = 'invalid'
          else if (identityConflict) status = 'conflict'
          else if (matches.length > 1 || matches.some((r) => !canRead(r)))
            status = 'conflict'
          else if (matches.length) status = 'duplicate'
          identityHold = identityConflict
          identityHoldReason =
            unresolvedPersonId || unresolvedApplicationId
              ? 'PENDING RECONCILIATION is a placeholder, not a stable identifier. Reconcile the authoritative source before applying this row.'
              : identityConflict
                ? 'A stable HR identity conflicts with current CRM evidence. Reconcile authoritative sources; identities are never merged automatically.'
                : ''
        } else if (batchType === 'organizations') {
          const matches = rows.filter(
            (r) =>
              r.kind === 'organization' &&
              ((name && normalize(r.title) === normalize(name)) ||
                (sourceData.website &&
                  normalize(String(r.data.website || '')) ===
                    normalize(String(sourceData.website)))),
          )
          const overlappingRows = mapped.filter(
            (other) =>
              other.key !== key &&
              ((name && normalize(other.sourceData.name) === normalize(name)) ||
                (sourceData.website &&
                  normalize(String(other.sourceData.website || '')) ===
                    normalize(String(sourceData.website)))),
          )
          if (
            /\b(test|example|dummy|synthetic)\b/i.test(name) ||
            /\.invalid\b/i.test(`${sourceData.website} ${sourceData.sourceUrl}`)
          )
            status = 'test'
          else if (
            !name ||
            (sourceData.website && !https(sourceData.website)) ||
            !sourceData.nextAction ||
            !Number.isFinite(Date.parse(String(sourceData.nextDue || '')))
          )
            status = 'invalid'
          else if (overlappingRows.length || matches.length > 1)
            status = 'conflict'
          else if (matches.some((r) => !canRead(r))) status = 'conflict'
          else if (matches.length) status = 'duplicate'
        } else {
          const orgMatches = sourceData.organization
            ? rows.filter(
                (r) =>
                  r.kind === 'organization' &&
                  normalize(r.title) === normalize(sourceData.organization),
              )
            : []
          const matchingOrg =
            orgMatches.length === 1 && canRead(orgMatches[0])
              ? orgMatches[0]
              : undefined
          const duplicates = rows.filter(
            (r) =>
              r.kind === 'resource' &&
              normalize(r.title) === normalize(name) &&
              String(r.data.resourceType || '') ===
                String(sourceData.resourceType || ''),
          )
          const overlappingRows = mapped.filter(
            (other) =>
              other.key !== key &&
              normalize(other.sourceData.name) === normalize(name) &&
              String(other.sourceData.resourceType || '') ===
                String(sourceData.resourceType || ''),
          )
          if (
            /\b(test|example|dummy|synthetic)\b/i.test(name) ||
            /\.invalid\b/i.test(
              `${sourceData.assetUrl} ${sourceData.sourceUrl}`,
            )
          )
            status = 'test'
          else if (
            !name ||
            !oneOf(['template', 'training'], sourceData.resourceType) ||
            (!sourceData.body && !sourceData.assetUrl) ||
            (sourceData.assetUrl && !https(sourceData.assetUrl))
          )
            status = 'invalid'
          else if (
            overlappingRows.length ||
            duplicates.length > 1 ||
            (sourceData.organization && orgMatches.length !== 1) ||
            orgMatches.some((r) => !canRead(r))
          )
            status = 'conflict'
          else if (duplicates.length) status = 'duplicate'
          else if (matchingOrg) linkedOrganizationId = matchingOrg.id
        }
        const data = {
          ...sourceData,
          batchType,
          status,
          ...(identityHold
            ? {
                identityHold: true,
                identityHoldReason,
              }
            : {}),
          ...(linkedOrganizationId ? { linkedOrganizationId } : {}),
          ...(batchType === 'contacts' ? { candidatePersonIds } : {}),
          sourceFingerprint,
          sourceFingerprintVersion: 1,
          batchId,
          batchIndex,
          mappingVersion,
          batchReceiptId: newReceiptId,
          ...(assignment
            ? {
                batchAssignmentId: assignment.id,
                assigneeId: actor.id,
              }
            : {}),
        }
        const saved = await insert({
          kind: 'intake',
          title: name || 'Invalid intake row',
          access: hr ? 'hr' : 'record',
          ownerId: activeOwner(
            assignment?.ownerId || actor.id,
            hr,
            !!assignment,
          ),
          sourceKey: key,
          data,
        })
        rows.push(saved)
        queue.push(saved)
        newRows++
        await log(saved, undefined, 'intake previewed')
      }
      const alreadyApplied = queue.filter(
        (r) => r.data.status === 'applied',
      ).length
      const alreadyExcluded = queue.filter(
        (r) => r.data.status === 'excluded',
      ).length
      const counts = {
        total: queue.length,
        newlyQueued: newRows,
        existingRows,
        accepted: alreadyApplied,
        created: queue.filter(
          (r) => r.data.status === 'applied' && r.data.resultType === 'created',
        ).length,
        matched: queue.filter(
          (r) => r.data.status === 'applied' && r.data.resultType === 'matched',
        ).length,
        failed: queue.filter((r) => r.data.status === 'invalid').length,
        excluded: alreadyExcluded,
        open: queue.length - alreadyApplied - alreadyExcluded,
        reviewReady: queue.filter((r) => r.data.status === 'ready').length,
        held: queue.filter((r) =>
          oneOf(['duplicate', 'conflict', 'test'], r.data.status),
        ).length,
        alreadyApplied,
        alreadyExcluded,
      }
      const resultFingerprint = createHash('sha256')
        .update(
          JSON.stringify(
            queue.map((r) => [
              r.sourceKey,
              r.data.sourceFingerprint,
              r.data.status,
            ]),
          ),
        )
        .digest('hex')
      const receiptSourceKey = stableKey(batchId, 'batch receipt')
      let receipt = rows.find(
        (r) => r.kind === 'import' && r.sourceKey === receiptSourceKey,
      )
      if (!receipt) {
        receipt = await insert({
          id: newReceiptId,
          kind: 'import',
          title: `${sourceName} · ${batchType} · batch ${batchIndex}/${batchCount}`,
          access: hr ? 'hr' : 'record',
          ownerId: assignment?.ownerId || actor.id,
          sourceKey: receiptSourceKey,
          data: {
            sourceName,
            workflow,
            batchType,
            sourceVersion,
            batchId,
            batchIndex,
            batchCount,
            mappingVersion,
            operatorId: actor.id,
            ...(assignment
              ? {
                  assignmentId: assignment.id,
                  assigneeId: actor.id,
                }
              : {}),
            privacyDecision: hr ? 'HR-restricted' : 'record-scoped',
            status: 'queued for review',
            counts,
            targetIds: queue.map((r) => r.id),
            blockers: queue
              .filter((r) => r.data.status !== 'ready')
              .map((r) => ({
                targetId: r.id,
                status: String(r.data.status || 'held'),
                reason: String(
                  r.data.identityHoldReason ||
                    r.data.sourceChangeReason ||
                    r.data.reason ||
                    (Array.isArray(r.data.issues)
                      ? r.data.issues.join('; ')
                      : ''),
                ),
              })),
            sourceVersions: [
              ...new Set(
                queue
                  .map((r) => String(r.data.sourceVersion || ''))
                  .filter(Boolean),
              ),
            ],
            sourceFingerprint: contentFingerprint,
            resultFingerprint,
            finishedAt: new Date().toISOString(),
          },
        })
        await log(receipt, undefined, 'intake batch receipt created')
      }
      return {
        rows: queue,
        summary: counts,
        receipt: {
          id: receipt.id,
          batchId,
          batchIndex,
          batchCount,
          mappingVersion,
          status: receipt.data.status,
        },
      }
    }
    check(body.action === 'intake-review', 'Unknown foundation action')
    const row = link(body.id, 'intake')
    check(
      row.revision === body.revision,
      'Intake row changed; refresh and review.',
      409,
    )
    check(
      ['apply', 'exclude'].includes(body.decision) && text(body.reason, 1000),
      'A review decision and reason are required',
    )
    check(
      !oneOf(['applied', 'excluded'], row.data.status),
      'Intake row already reviewed; refresh and review.',
      409,
    )
    const batchType = String(row.data.batchType || 'contacts')
    check(
      oneOf(['contacts', 'organizations', 'resources'], batchType),
      'Unsupported import batch type',
    )
    const workflow =
      batchType === 'contacts' ? String(row.data.workflow || '') : ''
    check(
      batchType !== 'contacts' || validWorkflow(workflow),
      'Select a valid intake workflow',
    )
    const hr = batchType === 'contacts' && isHrWorkflow(workflow)
    check(
      !hr || hasHrAccess(actor),
      'HR access required for applicant imports',
      403,
    )
    const assignment = row.data.batchAssignmentId
      ? resolveBatchAssignment(
          body.assignmentId,
          batchType,
          String(row.data.sourceName || ''),
          String(row.data.sourceVersion || ''),
          workflow,
          Number(row.data.batchIndex || 1),
          Number(row.data.batchCount || 1),
          Number(row.data.mappingVersion || 1),
          [row.data],
        )
      : undefined
    check(
      manager(actor) ||
        (!!assignment && body.assignmentId === row.data.batchAssignmentId),
      'Only the manager or assigned batch operator may review this row.',
      403,
    )
    const markApplied = async (details: RecordData = {}) => {
      const saved = await update(
        row,
        {
          data: {
            ...row.data,
            ...details,
            status: 'applied',
            reviewedBy: actor.id,
            reviewedAt: new Date().toISOString(),
            reviewReason: text(body.reason, 1000),
          },
        },
        body.revision,
      )
      await log(saved, row, 'intake applied')
      await updateIntakeBatchReceipt(saved, 'accepted')
      return saved
    }
    if (body.decision === 'exclude') {
      const saved = await update(
        row,
        {
          data: {
            ...row.data,
            status: 'excluded',
            reviewedBy: actor.id,
            reviewedAt: new Date().toISOString(),
            reviewReason: text(body.reason, 1000),
          },
        },
        body.revision,
      )
      await log(saved, row, 'intake excluded')
      await updateIntakeBatchReceipt(row, 'excluded')
      return { record: saved }
    }
    check(
      row.data.sourceChanged !== true,
      'Source changed after preview; exclude this row and review a separate source version.',
    )
    check(
      row.data.identityHold !== true,
      'Stable HR identity conflicts must be reconciled in the source before applying this row.',
      409,
    )
    check(
      !oneOf(['test', 'invalid'], row.data.status),
      'Test and invalid rows must be excluded',
    )
    if (batchType !== 'contacts') {
      check(
        row.data.status === 'ready',
        'Duplicate and conflicting rows must be resolved before applying.',
        409,
      )
      check(
        !body.personId,
        'Person links are available only for contact imports.',
        403,
      )
    }
    activeOwner(row.ownerId, hr, !!assignment)
    if (batchType === 'organizations') {
      const duplicate = rows.some(
        (record) =>
          record.kind === 'organization' &&
          ((normalize(record.title) === normalize(row.data.name) &&
            !!row.data.name) ||
            (!!row.data.website &&
              normalize(String(record.data.website || '')) ===
                normalize(String(row.data.website)))),
      )
      check(
        !duplicate,
        'Organization identity changed after preview; refresh and reconcile the directory.',
        409,
      )
      const saved = await insert({
        kind: 'organization',
        title: text(row.data.name, 300),
        access: assignment ? 'record' : 'team',
        ownerId: row.ownerId,
        sourceKey: row.sourceKey,
        data: {
          foundationVersion: 1,
          notes: text(row.data.notes),
          website: text(row.data.website, 1000),
          organizationType: text(row.data.organizationType, 300),
          location: text(row.data.location, 300),
          ...accountable(row.data),
          ...provenance(row.data),
          fieldProvenance: row.data.fieldProvenance || {},
        },
      })
      await log(saved, undefined, 'intake organization created')
      const reviewed = await markApplied({
        organizationId: saved.id,
        resultType: 'created',
        resultRecordId: saved.id,
      })
      return { record: reviewed, organizationId: saved.id }
    }
    if (batchType === 'resources') {
      const duplicate = rows.some(
        (record) =>
          record.kind === 'resource' &&
          normalize(record.title) === normalize(row.data.name) &&
          String(record.data.resourceType || '') ===
            String(row.data.resourceType || ''),
      )
      check(
        !duplicate,
        'Resource identity changed after preview; refresh and reconcile the library.',
        409,
      )
      let organization: Row | undefined
      if (row.data.organization) {
        organization = link(row.data.linkedOrganizationId, 'organization')
        check(
          normalize(organization.title) === normalize(row.data.organization),
          'The linked organization changed after preview; refresh and reconcile the mapping.',
          409,
        )
      }
      const resource = await insert({
        kind: 'resource',
        title: text(row.data.name, 300),
        access: 'record',
        ownerId: row.ownerId,
        organizationId: organization?.id || null,
        sourceKey: row.sourceKey,
        data: {
          resourceType: row.data.resourceType,
          status: 'Needs review',
          audience: 'team',
          familyId: randomUUID(),
          version: 1,
          body: text(row.data.body, 50000),
          assetUrl: text(row.data.assetUrl, 2000),
          description: text(row.data.description, 10000),
          category: text(row.data.category, 300),
          ...provenance(row.data),
          fieldProvenance: row.data.fieldProvenance || {},
        },
      })
      await log(resource, undefined, 'intake resource created for review')
      const reviewed = await markApplied({
        resourceId: resource.id,
        resultType: 'created',
        resultRecordId: resource.id,
      })
      return { record: reviewed, resourceId: resource.id }
    }
    const matches = rows.filter(
      (r) => r.kind === 'contact' && email(r.data.email) === row.data.email,
    )
    let person: Row | undefined
    if (body.personId) {
      person = link(body.personId, 'contact')
      check(
        email(person.data.email) === row.data.email,
        'Explicit linking requires the same verified source email',
      )
    } else {
      check(
        matches.length === 0 && row.data.status === 'ready',
        'Duplicate or conflicting identities require an explicit reviewed link',
        409,
      )
    }
    let organization: Row | undefined
    if (row.data.organization) {
      const orgs = rows.filter(
        (r) =>
          r.kind === 'organization' &&
          normalize(r.title) === normalize(row.data.organization),
      )
      check(
        orgs.length <= 1 && orgs.every(canRead),
        'Organization is ambiguous or unavailable; resolve the directory before applying',
        409,
      )
      organization = orgs[0]
      if (!organization) {
        organization = await insert({
          kind: 'organization',
          title: row.data.organization,
          access: hr ? 'hr' : assignment ? 'record' : 'team',
          ownerId: row.ownerId,
          data: {
            notes: '',
            ...accountable(row.data),
            ...provenance(row.data),
          },
        })
        await log(organization, undefined, 'intake organization created')
      }
    }
    if (!person) {
      const data = {
        name: row.data.name,
        email: row.data.email,
        contactPermission: row.data.contactPermission || 'Unknown',
        permissionEvidence: row.data.permissionEvidence || '',
        ...accountable(row.data),
        ...provenance(row.data),
      }
      const noContact = suppressed(rows, data, organization?.id)
      person = await insert({
        kind: 'contact',
        title: row.data.name || row.title,
        access: hr ? 'hr' : assignment ? 'record' : 'team',
        ownerId: row.ownerId,
        organizationId: organization?.id || null,
        data: {
          ...data,
          suppressed: noContact,
          ...(noContact ? { contactPermission: 'Do not contact' } : {}),
        },
      })
      await log(person, undefined, 'intake person created')
    }
    check(person, 'A reviewed person is required')
    if (
      row.data.contactPermission === 'Do not contact' ||
      person.data.contactPermission === 'Do not contact'
    ) {
      await registerNoContact(
        person.data,
        person.data,
        organization?.id || null,
        hr,
        person.id,
      )
      person.data.suppressed = true
      person.data.contactPermission = 'Do not contact'
    }
    check(
      hr || !privateRecord(person),
      'Shared workflows cannot link restricted people',
      403,
    )
    const caseKind = hr ? 'application' : 'engagement'
    check(
      !rows.some((r) => r.kind === caseKind && r.sourceKey === row.sourceKey),
      'This source row was already applied',
      409,
    )
    const noContact =
      person.data.suppressed === true ||
      suppressed(rows, person.data, organization?.id)
    const caseRecord = await insert({
      kind: caseKind,
      title: `${row.data.name} · ${row.data.workflow}`,
      access: hr ? 'hr' : 'record',
      ownerId: row.ownerId,
      organizationId: organization?.id || null,
      sourceKey: row.sourceKey,
      data: {
        personId: person.id,
        workflow: row.data.workflow,
        stage: workflows[workflow as FoundationWorkflow][0],
        ...(hr ? applicantDetails(row.data) : {}),
        ...accountable(row.data),
        ...provenance(row.data),
        contactPermission: noContact
          ? 'Do not contact'
          : row.data.contactPermission || 'Unknown',
        suppressed: noContact,
      },
    })
    await log(caseRecord, undefined, 'intake case created')
    const saved = await markApplied({
      personId: person.id,
      caseId: caseRecord.id,
      resultType: body.personId ? 'matched' : 'created',
      resultRecordId: person.id,
    })
    return { record: saved, personId: person.id, caseId: caseRecord.id }
  })
}
