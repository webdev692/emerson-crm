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
  for (const key of ['applicantId', 'program', 'cohort', 'onboardingStatus'])
    if (d[key]) details[key] = text(d[key], 300)
  if (d.resumeUrl) {
    check(https(d.resumeUrl), 'Resume link must use HTTPS')
    details.resumeUrl = text(d.resumeUrl, 2000)
  }
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
  'name',
  'email',
  'organization',
  'contactPermission',
  'permissionEvidence',
] as const
const applicantSourceKeys = [
  'applicantId',
  'program',
  'cohort',
  'resumeUrl',
  'onboardingStatus',
] as const
function intakeSourceFingerprint(data: RecordData, hr: boolean) {
  const keys = [...intakeSourceKeys, ...(hr ? applicantSourceKeys : [])].sort()
  const normalized = keys.map((key) => {
    let value = typeof data[key] === 'string' ? data[key].trim() : ''
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
  return {
    ...provenance({ ...raw, sourceName, sourceId }),
    workflow,
    name: text(raw.name, 300),
    email: email(raw.email),
    organization: text(raw.organization, 300),
    contactPermission: permission(raw),
    permissionEvidence: text(raw.permissionEvidence, 1000),
    ...(hr ? applicantDetails(raw) : {}),
    ...accountable(raw),
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

    check(manager(actor), 'Manager access required for import review', 403)
    if (body.action === 'intake-preview') {
      check(
        text(body.sourceName, 300) && body.sourceName.length <= 300,
        'A source name is required',
      )
      check(validWorkflow(body.workflow), 'Select a valid intake workflow')
      const hr = isHrWorkflow(body.workflow)
      check(
        !hr || hasHrAccess(actor),
        'HR access required for applicant imports',
        403,
      )
      check(
        Array.isArray(body.rows) &&
          body.rows.length > 0 &&
          body.rows.length <= 200,
        'Preview 1–200 mapped rows at a time',
      )
      // Validate the full batch before recording observations. If a resolved
      // source changed, commit only deduplicated evidence of that change; do not
      // partially create new preview rows from the same rejected batch.
      const mapped = body.rows.map((raw) => {
        check(raw && typeof raw === 'object', 'Mapped row required')
        const sourceId = text(String(raw.sourceId || ''), 300)
        check(sourceId, 'Every row requires its stable original source ID')
        const key = stableKey(body.sourceName, sourceId)
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
            existing.data.workflow === body.workflow,
            'A source row is already registered to another workflow',
            409,
          )
        }
        const sourceData = intakeSourceData(
          raw,
          body.sourceName,
          sourceId,
          body.workflow,
          hr,
        )
        const sourceFingerprint = intakeSourceFingerprint(sourceData, hr)
        return { raw, key, existing, sourceData, sourceFingerprint }
      })
      const resolvedChanges = mapped.filter(
        ({ existing, sourceFingerprint }) =>
          existing &&
          oneOf(['applied', 'excluded'], existing.data.status) &&
          sourceFingerprint !==
            (existing.data.sourceFingerprint ||
              intakeSourceFingerprint(existing.data, hr)),
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
                  intakeSourceFingerprint(existing.data, hr),
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
      const queue: Row[] = []
      for (const { raw, key, sourceData, sourceFingerprint } of mapped) {
        const existing = rows.find(
          (r) => r.kind === 'intake' && r.sourceKey === key,
        )
        if (existing) {
          const originalFingerprint =
            existing.data.sourceFingerprint ||
            intakeSourceFingerprint(existing.data, hr)
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
          continue
        }
        const e = sourceData.email || '',
          name = sourceData.name || ''
        const matches = rows.filter(
          (r) => r.kind === 'contact' && e && email(r.data.email) === e,
        )
        const visible = matches.filter(canRead)
        let status = 'ready'
        if (
          /\b(test|example|dummy|synthetic)\b/i.test(
            `${name} ${e} ${raw.organization || ''}`,
          ) ||
          /@[^@]+\.invalid$/i.test(e)
        )
          status = 'test'
        else if (!name || !validEmail(e)) status = 'invalid'
        else if (matches.length > 1 || matches.some((r) => !canRead(r)))
          status = 'conflict'
        else if (matches.length) status = 'duplicate'
        const data = {
          ...sourceData,
          status,
          candidatePersonIds: visible.map((r) => r.id),
          sourceFingerprint,
          sourceFingerprintVersion: 1,
        }
        const saved = await insert({
          kind: 'intake',
          title: name || 'Invalid intake row',
          access: hr ? 'hr' : 'record',
          ownerId: activeOwner(actor.id, hr),
          sourceKey: key,
          data,
        })
        rows.push(saved)
        queue.push(saved)
        await log(saved, undefined, 'intake previewed')
      }
      return { rows: queue }
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
    check(validWorkflow(row.data.workflow), 'Select a valid intake workflow')
    const workflow = row.data.workflow
    const hr = isHrWorkflow(workflow)
    check(
      !hr || hasHrAccess(actor),
      'HR access required for applicant imports',
      403,
    )
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
      return { record: saved }
    }
    check(
      row.data.sourceChanged !== true,
      'Source changed after preview; exclude this row and review a separate source version.',
    )
    check(
      !oneOf(['test', 'invalid'], row.data.status),
      'Test and invalid rows must be excluded',
    )
    activeOwner(row.ownerId, hr)
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
          access: hr ? 'hr' : 'team',
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
        access: hr ? 'hr' : 'team',
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
        stage: workflows[workflow][0],
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
    const saved = await update(
      row,
      {
        data: {
          ...row.data,
          status: 'applied',
          personId: person.id,
          caseId: caseRecord.id,
          reviewedBy: actor.id,
          reviewedAt: new Date().toISOString(),
          reviewReason: text(body.reason, 1000),
        },
      },
      body.revision,
    )
    await log(saved, row, 'intake applied')
    return { record: saved, personId: person.id, caseId: caseRecord.id }
  })
}
