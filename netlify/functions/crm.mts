import { getUser, admin } from '@netlify/identity'
import { and, eq, sql } from 'drizzle-orm'
import { database } from '../../db/index'
import { records, members, audit, settings } from '../../db/schema'
import {
  kinds,
  roles,
  discoveryResult,
  stages,
  normalize,
  csvCell,
  businessDeadline,
  calendarDefault,
} from '../../src/lib/rules'
import type { Config, Context } from '@netlify/functions'
import { syntheticEducationAvailable } from './lib/education-gate.mts'
import {
  configuredHostedEducationProfile,
  hostedEducationAvailable,
  hostedReviewerAllowed,
  hostedSigningKey,
  signHostedEducationAttempt,
  sendHostedEducationAttempt,
} from './lib/education-hosted.mts'
import { createHostedEducationPolicy } from './lib/education-hosted-policy.mts'
import {
  pullWebsiteIntake,
  websiteIntakeAvailable,
} from './lib/website-intake.mts'
import {
  createFoundationRead,
  createFoundationScope,
  handleFoundation,
  sanitizeFoundationRows,
} from './lib/foundation.mts'
const fail = (message: string, status = 400): never => {
  throw Object.assign(new Error(message), { status })
}
function need(v: unknown, m: string): asserts v {
  if (!v)
    fail(
      m,
      /changed|Concurrent/.test(m)
        ? 409
        : /Only |cannot |access required|authority required|permissions|access denied/.test(
              m,
            )
          ? 403
          : 400,
    )
}
const safeLink = (s: unknown) =>
  typeof s === 'string' && /^https:\/\/[^\s]+$/.test(s)
type WriteTransaction = Parameters<
  Parameters<ReturnType<typeof database>['transaction']>[0]
>[0]
export default async function (req: Request, context?: Context) {
  try {
    const user = await getUser()
    if (!user)
      return Response.json(
        { error: 'Sign in to access Emerson CRM.' },
        { status: 401 },
      )
    if (
      req.method !== 'GET' &&
      req.headers.get('origin') !== new URL(req.url).origin
    )
      return Response.json(
        { error: 'Same-origin requests required.' },
        { status: 403 },
      )
    const db = database()
    let [member] = await db
      .select()
      .from(members)
      .where(eq(members.id, user.id))
    // Bootstrap only an exact, verified Identity ID configured by the site administrator.
    if (!member && user.id === Netlify.env.get('CRM_OWNER_ID')) {
      const verifiedOwner = await admin.getUser(user.id)
      need(
        verifiedOwner.id === user.id &&
          verifiedOwner.confirmedAt &&
          verifiedOwner.invitedAt,
        'The configured owner must accept an invitation and verify their email first.',
      )
      await db
        .insert(members)
        .values({
          id: user.id,
          email: user.email || '',
          name: verifiedOwner.name || user.name || 'Owner',
          role: 'owner',
          commercial: true,
        })
        .onConflictDoNothing()
      ;[member] = await db.select().from(members).where(eq(members.id, user.id))
    }
    if (!member?.active)
      return Response.json(
        {
          error:
            'Your account needs an active staff membership. Ask the owner to grant access.',
        },
        { status: 403 },
      )
    const actor = member
    const currentWriteActor = async (tx: WriteTransaction) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7031926)`)
      const [current] = await tx
        .select()
        .from(members)
        .where(eq(members.id, actor.id))
      if (
        !current?.active ||
        current.id !== actor.id ||
        current.email.toLowerCase() !== actor.email.toLowerCase() ||
        current.role === 'viewer'
      )
        fail('Current active writing identity required.', 403)
      return current
    }
    const readEnvironment = (name: string) => Netlify.env.get(name)
    const hostedProfile = configuredHostedEducationProfile()
    const hostedEducation =
      hostedEducationAvailable(
        req,
        readEnvironment,
        hostedProfile,
        context
          ? {
              siteId: context.site.id || '',
              deployId: context.deploy.id,
              deployContext: context.deploy.context,
            }
          : undefined,
      ) &&
      hostedProfile !== null &&
      hostedReviewerAllowed(hostedProfile, actor)
    const educationPolicy =
      hostedEducation && hostedProfile
        ? createHostedEducationPolicy(hostedProfile, async (member) => {
            try {
              const identity = await admin.getUser(member.id)
              return (
                identity.id === member.id &&
                identity.email?.toLowerCase() === member.email.toLowerCase() &&
                !!identity.confirmedAt &&
                Number.isFinite(Date.parse(identity.confirmedAt)) &&
                !!identity.invitedAt &&
                Number.isFinite(Date.parse(identity.invitedAt))
              )
            } catch {
              return false
            }
          })
        : undefined
    const educationAvailable =
      hostedEducation ||
      (syntheticEducationAvailable(req, (name) => Netlify.env.get(name)) &&
        actor.role !== 'viewer' &&
        (actor.role === 'owner' || actor.hr) &&
        actor.email.endsWith('.invalid'))
    const reconcileEducation = async () => {
      if (!educationAvailable) return undefined
      try {
        const { getEducationStatus } =
          await import('./lib/education-clearance.mts')
        await getEducationStatus(
          db,
          actor.id,
          '82000000-0000-4000-8000-000000000001',
          educationPolicy,
        )
        return 'checked'
      } catch {
        return 'unavailable'
      }
    }
    const all = () => db.select().from(records)
    const accessibleRecords = await all()
    const isManager = ['owner', 'manager'].includes(actor.role)
    const canRead = createFoundationRead(actor, accessibleRecords)
    const url = new URL(req.url)
    if (req.method === 'GET') {
      const rows = sanitizeFoundationRows(accessibleRecords, canRead)
      if (url.searchParams.get('export') === 'csv') {
        const fields = [
          'id',
          'kind',
          'title',
          'access',
          'ownerId',
          'parentId',
          'organizationId',
          'sourceKey',
          'revision',
          'createdAt',
          'updatedAt',
          'data',
        ] as const
        return new Response(
          [
            fields.join(','),
            ...rows.map((r) => fields.map((f) => csvCell(r[f])).join(',')),
          ].join('\r\n'),
          {
            headers: {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': 'attachment; filename="emerson-crm.csv"',
              'Cache-Control': 'no-store',
            },
          },
        )
      }
      return Response.json(
        {
          member: actor,
          syntheticWebsiteIntake: websiteIntakeAvailable(
            req,
            readEnvironment,
            context?.deploy,
          ),
          syntheticEducation: educationAvailable,
          ...(educationAvailable
            ? {
                educationEnvironment: hostedEducation
                  ? 'synthetic-hosted'
                  : 'synthetic-local',
              }
            : {}),
          records: rows,
          staff: isManager
            ? await db.select().from(members)
            : (await db.select().from(members))
                .filter((s) => s.active)
                .map(({ id, name, role, active }) => ({
                  id,
                  name,
                  role,
                  active,
                })),
          settings: await db.select().from(settings),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    need(req.method === 'POST', 'Method not supported')
    const body = await req.json()
    if (body.action === 'website-intake-pull') {
      need(
        Object.keys(body).length === 1,
        'Only the intake action is accepted.',
      )
      need(
        websiteIntakeAvailable(req, readEnvironment, context?.deploy),
        'Synthetic website intake unavailable.',
      )
      const result = await pullWebsiteIntake(
        db,
        actor,
        readEnvironment('CRM_WEBSITE_INTAKE_HMAC_KEY') || '',
      )
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
    }
    need(JSON.stringify(body).length < 500000, 'Request too large')
    if (
      typeof body.action === 'string' &&
      body.action.startsWith('education-')
    ) {
      if (!educationAvailable)
        fail('Synthetic HR clearance is unavailable.', 403)
      const education = await import('./lib/education-clearance.mts')
      if (body.action === 'education-status')
        return Response.json(
          await education.getEducationStatus(
            db,
            actor.id,
            body.applicationId,
            educationPolicy,
          ),
          { headers: { 'Cache-Control': 'no-store' } },
        )
      if (body.action === 'education-review')
        return Response.json(
          await education.handleEducationReview(
            db,
            actor.id,
            body,
            educationPolicy,
          ),
          { headers: { 'Cache-Control': 'no-store' } },
        )
      if (body.action === 'education-dispatch') {
        if (hostedEducation && hostedProfile && educationPolicy) {
          if (Netlify.env.get('EPDG_HOSTED_PRACTICE_HANDOFF_ENABLED') !== '1')
            fail('The hosted synthetic EPDG sender is disabled.', 403)
          const keyBase64url = hostedSigningKey(readEnvironment)
          const { randomUUID } = await import('node:crypto')
          const result = await education.dispatchEducation(
            db,
            actor.id,
            body.applicationId,
            async (rawBody: string) =>
              sendHostedEducationAttempt(
                signHostedEducationAttempt({
                  profile: hostedProfile,
                  rawBody,
                  keyBase64url,
                  timestamp: Math.floor(Date.now() / 1000),
                  nonce: randomUUID(),
                  allowExactRetry: true,
                }),
                { profile: hostedProfile },
              ),
            educationPolicy,
          )
          return Response.json(result, {
            headers: { 'Cache-Control': 'no-store' },
          })
        }
        if (Netlify.env.get('EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED') !== '1')
          fail('The local synthetic EPDG sender is disabled.', 403)
        const { signSyntheticEducationAttempt, SYNTHETIC_HANDOFF } =
          await import('./lib/education-handoff.mts')
        const { sendSyntheticEducationAttempt } =
          await import('./lib/education-transport.mts')
        const { randomUUID } = await import('node:crypto')
        const keyBase64url =
          Netlify.env.get('EPDG_SYNTHETIC_CRM_HANDOFF_KEY') ||
          fail('Local handoff configuration is unavailable.', 503)
        const result = await education.dispatchEducation(
          db,
          actor.id,
          body.applicationId,
          async (rawBody: string) =>
            sendSyntheticEducationAttempt(
              signSyntheticEducationAttempt({
                rawBody,
                keyBase64url,
                target: SYNTHETIC_HANDOFF.target,
                timestamp: Math.floor(Date.now() / 1000),
                nonce: randomUUID(),
                gate: { enabled: '1', environment: 'synthetic-local' },
                allowExactRetry: true,
              }),
              { gate: { enabled: '1', environment: 'synthetic-local' } },
            ),
        )
        return Response.json(result, {
          headers: { 'Cache-Control': 'no-store' },
        })
      }
      fail('Unknown education operation.')
    }
    if (
      ['foundation-save', 'intake-preview', 'intake-review'].includes(
        body.action,
      )
    ) {
      const result = await handleFoundation(db, actor, body)
      // The source edit has committed. Queue any resulting hold promptly, while
      // dispatch independently reloads the same source under the shared lock.
      // An unavailable fixture must not misreport the committed edit as failed.
      const educationReconciliation = await reconcileEducation()
      return Response.json(
        {
          ...result,
          ...(educationReconciliation ? { educationReconciliation } : {}),
        },
        {
          status: 'status' in result && result.status === 409 ? 409 : 200,
          headers: { 'Cache-Control': 'no-store' },
        },
      )
    }
    if (body.action === 'staff') {
      await db.transaction(async (tx) => {
        const actor = await currentWriteActor(tx)
        need(
          actor.role === 'owner',
          'Only an active owner manages staff access.',
        )
        need(roles.includes(body.role), 'Invalid role')
        need(/^[0-9a-f-]{36}$/i.test(body.id), 'Identity user UUID required')
        need(
          body.email && body.name,
          'Name and verified Identity email required',
        )
        need(
          body.id !== actor.id,
          'Use an independent owner administrator to change your own membership.',
        )
        const invitedUser = await admin.getUser(body.id)
        need(
          invitedUser.id === body.id &&
            invitedUser.invitedAt &&
            invitedUser.confirmedAt &&
            normalize(invitedUser.email) === normalize(body.email),
          'The Identity account must have accepted an invitation and verified this email.',
        )
        await tx
          .insert(members)
          .values({
            id: body.id,
            email: body.email,
            name: body.name,
            role: body.role,
            active: body.active !== false,
            commercial: body.commercial === true,
            hr: body.hr === true,
          })
          .onConflictDoUpdate({
            target: members.id,
            set: {
              email: body.email,
              name: body.name,
              role: body.role,
              active: body.active !== false,
              commercial: body.commercial === true,
              ...(typeof body.hr === 'boolean' ? { hr: body.hr } : {}),
            },
          })
        await tx.insert(audit).values({
          actorId: actor.id,
          recordId: body.id,
          action: 'staff access changed',
          after: {
            role: body.role,
            active: body.active,
            commercial: body.commercial,
            hr: body.hr,
          },
        })
      })
      const educationReconciliation = await reconcileEducation()
      return Response.json({
        ok: true,
        ...(educationReconciliation ? { educationReconciliation } : {}),
      })
    }
    if (body.action === 'settings') {
      await db.transaction(async (tx) => {
        const actor = await currentWriteActor(tx)
        need(actor.role === 'owner', 'Only the owner manages settings.')
        const d = body.data
        need(
          d && typeof d === 'object' && !Array.isArray(d),
          'Calendar data required',
        )
        need(
          d.timezone === 'America/New_York',
          'This release supports America/New_York.',
        )
        need(
          Array.isArray(d.workingDays) &&
            d.workingDays.length > 0 &&
            d.workingDays.every(
              (x: unknown) =>
                typeof x === 'number' &&
                Number.isInteger(x) &&
                x >= 0 &&
                x <= 6,
            ),
          'Select working days',
        )
        need(
          Array.isArray(d.holidays) &&
            d.holidays.every(
              (x: unknown) =>
                typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x),
            ),
          'Holiday dates must be YYYY-MM-DD',
        )
        need(
          d.clock === 'same-local-time' && d.holdsPause === false,
          'This release uses same local time and clocks continue on holds.',
        )
        await tx
          .insert(settings)
          .values({ key: 'calendar', data: d })
          .onConflictDoUpdate({ target: settings.key, set: { data: d } })
        await tx
          .insert(audit)
          .values({ actorId: actor.id, action: 'calendar changed', after: d })
      })
      return Response.json({ ok: true })
    }
    if (body.action === 'import-summary') {
      const saved = await db.transaction(async (tx) => {
        const actor = await currentWriteActor(tx)
        need(
          ['owner', 'manager'].includes(actor.role),
          'Manager access required',
        )
        need(
          body.source && Array.isArray(body.summary),
          'Import summary required',
        )
        const [record] = await tx
          .insert(records)
          .values({
            kind: 'import',
            title: body.source,
            ownerId: actor.id,
            data: {
              summary: body.summary,
              counts: body.counts,
              finishedAt: new Date().toISOString(),
            },
          })
          .returning()
        return record
      })
      return Response.json({ record: saved })
    }
    if (body.action === 'audit') {
      need(isManager, 'Manager access required')
      need(
        accessibleRecords.some((r) => r.id === body.id && canRead(r)),
        'Record unavailable or access denied',
      )
      return Response.json(
        await db.select().from(audit).where(eq(audit.recordId, body.id)),
      )
    }
    if (body.action === 'decide') {
      await db.transaction(async (tx) => {
        const actor = await currentWriteActor(tx)
        need(
          actor.role === 'owner' || actor.commercial,
          'Explicit commercial approval authority required.',
        )
        need(
          ['approved', 'declined', 'changes requested'].includes(
            body.decision,
          ) && body.reason,
          'Decision and reason required',
        )
        const rows = await tx.select().from(records)
        const canRead = createFoundationRead(actor, rows)
        const [target] = await tx
          .select()
          .from(records)
          .where(eq(records.id, body.id))
          .for('update')
        need(target && canRead(target), 'Record unavailable')
        need(
          ['offer', 'proposal', 'research', 'quote'].includes(target.kind),
          'This record does not support commercial decisions',
        )
        need(
          target.revision === body.revision,
          'Record changed; refresh before deciding.',
        )
        if (
          body.decision === 'approved' &&
          ['offer', 'proposal'].includes(target.kind)
        ) {
          need(
            target.data.scope &&
              target.data.terms &&
              target.data.deliverables &&
              target.data.exclusions &&
              target.data.clientRequirements &&
              target.data.waiver &&
              target.data.disclaimer &&
              target.data.validUntil &&
              target.data.effectiveDate,
            'Complete scope, deliverables, exclusions, requirements, terms, waiver, disclaimer and validity dates first.',
          )
          need(
            target.data.pricingModel === 'free' ||
              (Number(target.data.price) > 0 &&
                ['fixed', 'recurring'].includes(
                  target.data.pricingModel || '',
                )),
            'Define a genuine free service or a specific proposed price first.',
          )
        }
        if (
          body.decision === 'approved' &&
          ['offer', 'proposal'].includes(target.kind)
        ) {
          need(
            typeof target.data.effectiveDate === 'string' &&
              typeof target.data.validUntil === 'string' &&
              /^\d{4}-\d{2}-\d{2}$/.test(target.data.effectiveDate) &&
              /^\d{4}-\d{2}-\d{2}$/.test(target.data.validUntil) &&
              target.data.validUntil >= target.data.effectiveDate,
            'Use valid effective and expiry dates in chronological order.',
          )
          if (target.data.pricingModel === 'free')
            need(
              Number(target.data.price) === 0,
              'A genuinely free service must explicitly record zero as its price.',
            )
        }
        if (body.decision === 'approved' && target.kind === 'research')
          need(
            !target.data.suppressed,
            'Suppressed research cannot be authorized for outreach.',
          )
        await tx.insert(records).values({
          kind: 'approval',
          title: `${target.kind} · ${target.title}`,
          ownerId: actor.id,
          parentId: target.id,
          data: {
            decision: body.decision,
            reason: body.reason,
            targetRevision: target.revision,
            snapshot: target.data,
            approvedBy: actor.id,
            decidedAt: new Date().toISOString(),
            type:
              target.kind === 'research'
                ? 'outreach'
                : target.kind === 'offer'
                  ? 'catalogue'
                  : 'client-specific',
          },
        })
        await tx.insert(audit).values({
          actorId: actor.id,
          recordId: target.id,
          action: body.decision,
          after: { revision: target.revision, reason: body.reason },
        })
      })
      return Response.json({ ok: true })
    }
    need(body.action === 'save', 'Unknown action')
    const input = body.record
    need(input && kinds.includes(input.kind), 'Unsupported record type')
    need(
      !['approval', 'ownership', 'import'].includes(input.kind),
      'This record is generated by the workflow.',
    )
    need(
      typeof input.title === 'string' &&
        input.title.trim() &&
        input.title.length < 300,
      'A title is required (maximum 300 characters).',
    )
    need(
      input.data &&
        typeof input.data === 'object' &&
        !Array.isArray(input.data),
      'Record details required',
    )
    const result = await db.transaction(async (tx) => {
      // Serializes suppression checks and duplicate-sensitive writes across requests.
      const actor = await currentWriteActor(tx)
      const rows = await tx.select().from(records)
      const isManager = ['owner', 'manager'].includes(actor.role)
      const canRead = createFoundationRead(actor, rows)
      const inScope = createFoundationScope(actor, rows)
      const canWrite = (r: typeof records.$inferSelect) =>
        inScope(r) &&
        actor.role !== 'viewer' &&
        (isManager ||
          (r.ownerId === actor.id &&
            (actor.role === 'contributor'
              ? [
                  'research',
                  'opportunity',
                  'activity',
                  'task',
                  'discovery',
                  'offer',
                  'proposal',
                  'quote',
                  'organization',
                  'contact',
                ].includes(r.kind)
              : ['handoff', 'workorder'].includes(r.kind))))
      const old = rows.find((r) => r.id === input.id)
      if (input.id) need(old && canWrite(old), 'You cannot edit this record.')
      else
        need(
          actor.role !== 'viewer' &&
            (isManager ||
              (actor.role === 'contributor' &&
                [
                  'research',
                  'opportunity',
                  'activity',
                  'task',
                  'discovery',
                  'offer',
                  'proposal',
                  'quote',
                  'organization',
                  'contact',
                  'suppression',
                ].includes(input.kind)) ||
              (actor.role === 'delivery' &&
                ['handoff', 'workorder'].includes(input.kind))),
          'You cannot create this record.',
        )
      need(
        !old ||
          !['organization', 'contact'].includes(old.kind) ||
          !old.access ||
          old.access === 'record',
        'You cannot edit shared directory records through this action. Use the directory workflow.',
      )
      if (['organization', 'contact'].includes(input.kind))
        need(
          ![
            'resumeUrl',
            'assessment',
            'assessmentScore',
            'applicantId',
            'cohort',
            'onboardingStatus',
            'audience',
            'contactPermission',
            'permissionEvidence',
          ].some((key) => key in input.data),
          'You cannot store applicant or permission details through the legacy directory action.',
        )
      if (old)
        need(
          (old.organizationId || null) === (input.organizationId || null),
          'Organization links are immutable; create a reviewed record instead.',
        )
      if (old)
        need(
          old.kind === input.kind && old.revision === input.revision,
          'This record changed in another session. Refresh and review before saving.',
        )
      need(
        !input.access || input.access === (old?.access || 'record'),
        'Use the directory workflow to change record access.',
      )
      need(
        !old ||
          ![
            'offer',
            'proposal',
            'workorder',
            'handoff',
            'suppression',
            'activity',
          ].includes(old.kind),
        'This record is immutable. Create a new version or event to preserve history.',
      )
      const ownerId = input.ownerId || old?.ownerId || actor.id
      const [owner] = await tx
        .select()
        .from(members)
        .where(eq(members.id, ownerId))
      need(owner?.active, 'An active accountable owner is required')
      if (!isManager)
        need(
          ownerId === actor.id,
          'Only a manager can assign records to other staff.',
        )
      for (const key of ['parentId', 'organizationId'])
        if (input[key])
          need(
            rows.some((r) => r.id === input[key] && canRead(r)),
            'Linked record unavailable',
          )
      if (input.organizationId)
        need(
          rows.some(
            (r) => r.id === input.organizationId && r.kind === 'organization',
          ),
          'Select an organization record',
        )
      const d = { ...input.data }
      // Apply the same visibility and relationship checks to submitted selector IDs.
      for (const [key, kind] of Object.entries({
        contactId: 'contact',
        proposalId: 'proposal',
        researchId: 'research',
      })) {
        if (!d[key]) continue
        const linked = rows.find((r) => r.id === d[key] && r.kind === kind)
        need(
          linked && canRead(linked),
          'Selected linked record unavailable or access denied',
        )
        if (input.organizationId)
          need(
            linked!.organizationId === input.organizationId,
            'Selected record belongs to a different organization',
          )
        if (key === 'proposalId')
          need(
            linked!.parentId ===
              (input.kind === 'opportunity' ? input.id : input.parentId),
            'Select a proposal version for this opportunity',
          )
      }
      for (const key of ['capacityReviewer', 'deliveryLead']) {
        if (!d[key]) continue
        const [designated] = await tx
          .select()
          .from(members)
          .where(eq(members.id, d[key]))
        need(
          designated?.active && ['owner', 'delivery'].includes(designated.role),
          'Select an active delivery lead or owner',
        )
      }
      if (input.kind === 'research')
        d.researchedBy = old?.data.researchedBy || actor.id
      if (typeof d.readers === 'string')
        d.readers = d.readers
          .split(',')
          .map((x: string) => x.trim())
          .filter(Boolean)
      if (d.readers) {
        need(Array.isArray(d.readers), 'Read permissions must be staff IDs')
        const activeStaff = await tx.select().from(members)
        need(
          d.readers.every((id: string) =>
            activeStaff.some((s) => s.id === id && s.active),
          ),
          'Select active staff for reader permissions',
        )
      }
      if (!isManager) {
        need(
          !('readers' in d) ||
            JSON.stringify(d.readers) === JSON.stringify(old?.data.readers),
          'Only managers manage record access.',
        )
      }
      if (input.sourceKey) {
        need(isManager, 'Imports require owner or manager access.')
        need(
          !/\bEXAMPLE\b/i.test(input.title + ' ' + JSON.stringify(d)),
          'Example rows are excluded from production imports.',
        )
      }
      delete d.approvedBy
      delete d.acceptedAt
      delete d.lastContact
      delete d.approvalStatus
      delete d.acceptedBy
      const parent = rows.find((r) => r.id === input.parentId)
      const approved = (r: typeof records.$inferSelect | undefined) =>
        r &&
        rows.some(
          (a) =>
            a.kind === 'approval' &&
            a.parentId === r.id &&
            a.data.targetRevision === r.revision &&
            a.data.decision === 'approved' &&
            (!['offer', 'proposal'].includes(r.kind) ||
              !r.data.validUntil ||
              r.data.validUntil >= new Date().toISOString().slice(0, 10)) &&
            !rows.some(
              (b) =>
                b.kind === 'approval' &&
                b.parentId === r.id &&
                b.createdAt > a.createdAt &&
                b.data.targetRevision === r.revision,
            ),
        )
      const org = rows.find(
        (r) => r.id === input.organizationId && r.kind === 'organization',
      )
      const identities = [
        d.email,
        d.phone,
        d.website,
        d.sourceUrl,
        org?.data.website,
        ...rows
          .filter(
            (r) =>
              r.kind === 'contact' && r.organizationId === input.organizationId,
          )
          .flatMap((r) => [r.data.email, r.data.phone]),
      ]
        .filter(Boolean)
        .map(normalize)
      const suppressed =
        old?.data.suppressed === true ||
        rows.some(
          (r) =>
            r.kind === 'suppression' &&
            ((r.organizationId && r.organizationId === input.organizationId) ||
              (r.data.identity &&
                identities.includes(normalize(r.data.identity)))),
        )
      if (d.email)
        need(
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email),
          'Enter a valid email address',
        )
      if (d.sourceCategory === 'Company research list') d.sourcedBy = ''
      if (['research', 'opportunity'].includes(input.kind)) {
        need(input.organizationId, 'Link an organization first')
        need(
          d.sourceCategory &&
            d.nextAction &&
            d.nextDue &&
            !Number.isNaN(Date.parse(d.nextDue)),
          'Source category, next action and a valid due date are required',
        )
        d.nextDue = new Date(d.nextDue).toISOString()
        need(
          [
            'Partner referral',
            'Personally sourced',
            'General inbound',
            'Company research list',
            'Unresolved',
          ].includes(d.sourceCategory),
          'Invalid source category',
        )
        if (d.sourceCategory === 'Personally sourced')
          need(d.sourcedBy, 'Personal sourcing credit is required')
        d.suppressed = suppressed
      }
      if (input.kind === 'research' && d.usBased === 'No')
        d.reviewFlag = 'Non-US: Lyric review required'
      if (input.kind === 'research')
        need(
          safeLink(d.sourceUrl) &&
            d.location &&
            d.fitRationale &&
            d.contactRoute &&
            d.service,
          'Research needs an official HTTPS source, location, service fit, rationale and contact route',
        )
      if (input.kind === 'activity') {
        need(
          parent && ['opportunity', 'research'].includes(parent.kind),
          'Activity needs a research or opportunity link',
        )
        need(canWrite(parent), 'You cannot log activities for this record')
        need(
          d.occurredAt &&
            !Number.isNaN(Date.parse(d.occurredAt)) &&
            new Date(d.occurredAt) <= new Date() &&
            d.activityType &&
            d.notes,
          'A valid past event time, type and notes are required',
        )
        d.occurredAt = new Date(d.occurredAt).toISOString()
        need(
          [
            'Note',
            'Research',
            'Acknowledgment',
            'Discovery booked',
            'Discovery held',
            'Follow-up',
            'Reschedule offer',
            'Client initiated contact',
            'Proposal sent',
            'Contact',
          ].includes(d.activityType),
          'Invalid activity type',
        )
        if (d.activityType === 'Proposal sent') {
          const proposal = rows.find(
            (r) =>
              r.id === d.proposalId &&
              r.kind === 'proposal' &&
              r.parentId === parent.id,
          )
          need(
            approved(proposal),
            'Log proposal sending only for an approved, valid client-specific version.',
          )
        }
        d.contactEvent = [
          'Acknowledgment',
          'Discovery held',
          'Follow-up',
          'Reschedule offer',
          'Client initiated contact',
          'Proposal sent',
          'Contact',
        ].includes(d.activityType)
        if (d.activityType === 'Client initiated contact')
          need(
            safeLink(d.evidence),
            'Prospect-initiated contact requires evidence',
          )
        if (d.contactEvent && d.activityType !== 'Client initiated contact') {
          const parentOrg = rows.find((r) => r.id === parent.organizationId)
          const contactKeys = [
            parent.data.email,
            parent.data.phone,
            parentOrg?.data.website,
            parent.data.sourceUrl,
            ...rows
              .filter(
                (r) =>
                  r.kind === 'contact' &&
                  r.organizationId === parent.organizationId,
              )
              .flatMap((r) => [r.data.email, r.data.phone]),
          ]
            .filter(Boolean)
            .map(normalize)
          need(
            !parent.data.suppressed &&
              !rows.some(
                (r) =>
                  r.kind === 'suppression' &&
                  (r.organizationId === parent.organizationId ||
                    contactKeys.includes(normalize(r.data.identity))),
              ),
            'No-contact restriction: outbound contact is blocked',
          )
          need(
            parent.data.contactPermission === 'Consented' ||
              (parent.kind === 'research' && approved(parent)),
            'Contact permission or approved research outreach required',
          )
        }
        if (
          parent.kind === 'research' &&
          d.contactEvent &&
          d.activityType !== 'Client initiated contact'
        )
          need(approved(parent), 'Founder outreach approval required')
      }
      if (input.kind === 'discovery') {
        need(
          parent?.kind === 'opportunity' && canWrite(parent),
          'Link an assigned opportunity',
        )
        need(
          d.criteria &&
            d.criteria.length === 5 &&
            d.rationale &&
            d.facts &&
            d.buyerStatements &&
            d.nextStep,
          'Complete rubric, facts, buyer statements, rationale and next step',
        )
        need(
          Array.isArray(d.criteria) &&
            d.criteria.every(
              (v: unknown) =>
                typeof v === 'string' &&
                ['Met', 'Not met', 'Unclear'].includes(v),
            ),
          'Each criterion must be Met, Not met or Unclear',
        )
        d.result = discoveryResult(d.criteria)
        need(
          d.heldAt && !Number.isNaN(Date.parse(d.heldAt)),
          'Actual discovery time is required',
        )
        d.heldAt = new Date(d.heldAt).toISOString()
        const [cal] = await tx
          .select()
          .from(settings)
          .where(eq(settings.key, 'calendar'))
        d.documentationDue = businessDeadline(
          d.heldAt,
          (cal?.data || calendarDefault) as typeof calendarDefault,
        )
      }
      if (input.kind === 'opportunity') {
        const stage = d.stage || 'S1'
        need(stages[stage], 'Invalid stage code')
        d.stage = stage
        if (d.researchId && (!old || d.researchId !== old.data.researchId)) {
          const research = rows.find(
            (r) => r.id === d.researchId && r.kind === 'research',
          )
          need(research && canRead(research), 'Research unavailable')
          need(
            approved(research) &&
              rows.some(
                (a) =>
                  a.kind === 'activity' &&
                  a.parentId === research.id &&
                  a.data.contactEvent,
              ),
            'Conversion requires approved outreach and an actual contact event',
          )
          need(
            !rows.some(
              (r) =>
                r.kind === 'opportunity' &&
                r.id !== old?.id &&
                r.data.researchId === research.id,
            ),
            'Research already converted',
          )
          d.sourceCategory = research.data.sourceCategory
          d.sourcedBy = research.data.sourcedBy
          d.sourceEvidence = research.data.sourceUrl
        }
        if (suppressed)
          need(
            stage === 'X4',
            'Suppression is active; use X4 and retain the history.',
          )
        if (stage === 'X4') need(suppressed, 'Apply a no-contact record first')
        if (stage.startsWith('H')) need(d.holdReason, 'Hold reason required')
        if (stage.startsWith('X'))
          need(d.closeReason, 'Closure reason required')
        if (!old)
          need(
            stage === 'S1' || stage === 'X4',
            'New opportunities start at S1; later stages require recorded evidence.',
          )
        if (old) {
          if (stage !== old.data.stage)
            need(
              d.stageReason && safeLink(d.stageEvidence),
              'Every stage change requires a reason and internal evidence HTTPS link',
            )
          const acts = rows.filter(
            (r) => r.kind === 'activity' && r.parentId === old.id,
          )
          const disc = rows
            .filter((r) => r.kind === 'discovery' && r.parentId === old.id)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
          if (old.data.stage === 'X3' && stage !== old.data.stage)
            need(
              acts.some(
                (a) =>
                  a.data.activityType === 'Client initiated contact' &&
                  a.createdAt > old.updatedAt,
              ),
              'Reopening requires new prospect-initiated contact',
            )
          if (stage.startsWith('H')) need(d.holdReason, 'Hold reason required')
          if (stage.startsWith('X'))
            need(d.closeReason, 'Closure reason required')
          if (stage === 'X3')
            need(
              acts.some(
                (a) =>
                  a.data.activityType === 'Follow-up' ||
                  a.data.activityType === 'Reschedule offer',
              ),
              'No response requires a logged follow-up or reschedule offer; there is no automatic deadline',
            )
          if (stage === 'X4')
            need(suppressed, 'Apply a no-contact record first')
          const n = stage.startsWith('S') ? Number(stage.slice(1)) : 0
          if (n >= 2)
            need(
              acts.some((a) => a.data.activityType === 'Acknowledgment') ||
                safeLink(d.autoConfirmationEvidence),
              'Record an acknowledgment or verified automatic confirmation',
            )
          if (n >= 3)
            need(
              d.discoveryAt && !Number.isNaN(Date.parse(d.discoveryAt)),
              'Confirmed discovery date and time required',
            )
          if (n >= 4) need(disc, 'Completed discovery assessment required')
          if (n >= 5)
            need(
              disc?.data.result === 'S5',
              'All five discovery criteria must be met',
            )
          if (n >= 6) {
            need(
              d.recommendation &&
                d.capacityReviewer &&
                safeLink(d.capacityEvidence),
              'Package recommendation and delivery-capacity review evidence required',
            )
            const [reviewer] = await tx
              .select()
              .from(members)
              .where(eq(members.id, d.capacityReviewer))
            need(
              reviewer?.active && ['delivery', 'owner'].includes(reviewer.role),
              'Capacity reviewer must be an active delivery lead or owner',
            )
          }
          const proposal = rows.find(
            (r) =>
              r.id === d.proposalId &&
              r.kind === 'proposal' &&
              r.parentId === old.id,
          )
          if (n >= 7)
            need(
              approved(proposal) &&
                acts.some(
                  (a) =>
                    a.data.activityType === 'Proposal sent' &&
                    a.data.proposalId === proposal?.id,
                ),
              'Approved specific proposal version and a matching proposal-sent activity required',
            )
          if (n >= 8)
            need(
              safeLink(d.writtenAcceptance) &&
                d.capacityStatus === 'Confirmed' &&
                rows.some(
                  (r) =>
                    r.kind === 'workorder' &&
                    r.parentId === old.id &&
                    r.data.proposalId === proposal?.id,
                ),
              'Written acceptance, confirmed capacity and a linked work order are required',
            )
          if (n === 9)
            need(
              rows.some(
                (r) =>
                  r.kind === 'handoff' &&
                  r.parentId === old.id &&
                  r.data.acceptedAt &&
                  r.data.proposalId === proposal?.id,
              ),
              'Authorized delivery acceptance required; S9 does not represent payment',
            )
          if ((n === 9 || stage.startsWith('X')) && stage !== old.data.stage)
            d.closedAt = new Date().toISOString()
        }
        if (!old) {
          if (stage === 'X4') d.closedAt = new Date().toISOString()
          const [cal] = await tx
            .select()
            .from(settings)
            .where(eq(settings.key, 'calendar'))
          d.acknowledgmentDue = businessDeadline(
            new Date().toISOString(),
            (cal?.data || calendarDefault) as typeof calendarDefault,
          )
        }
      }
      if (input.kind === 'task') {
        need(
          parent &&
            canWrite(parent) &&
            d.nextDue &&
            !Number.isNaN(Date.parse(d.nextDue)) &&
            d.nextAction,
          'Task requires a permitted linked record, next action and valid due date',
        )
        d.nextDue = new Date(d.nextDue).toISOString()
      }
      if (input.kind === 'offer' || input.kind === 'proposal') {
        need(
          d.company && d.service && d.version && d.offerId,
          'Company, service, stable offer ID and version required',
        )
        need(
          ['pending', 'fixed', 'recurring', 'custom quote', 'free'].includes(
            d.pricingModel,
          ),
          'Select a pricing model',
        )
        need(
          d.price === undefined ||
            d.price === null ||
            d.price === '' ||
            Number(d.price) > 0 ||
            d.pricingModel === 'free',
          'Unknown prices must be blank, not zero',
        )
        if (input.kind === 'proposal')
          need(
            parent?.kind === 'opportunity' && canWrite(parent),
            'Proposal needs an assigned opportunity',
          )
        d.price = d.price === '' ? null : d.price
        d.currency = d.currency || 'USD'
        need(
          !rows.some(
            (r) =>
              r.kind === input.kind &&
              r.data.offerId === d.offerId &&
              r.data.version === d.version &&
              (input.kind === 'offer' || r.parentId === input.parentId),
          ),
          'That offer ID and version already exist; create a new version.',
        )
      }
      if (input.kind === 'quote')
        need(
          parent && canWrite(parent) && d.scope && d.missingInformation,
          'Quote needs a permitted linked record, scope and missing-information assessment',
        )
      if (input.kind === 'workorder' || input.kind === 'handoff') {
        need(
          parent?.kind === 'opportunity' &&
            (canWrite(parent) ||
              (actor.role === 'delivery' &&
                parent.data.deliveryLead === actor.id)),
          'Link an opportunity you manage or a delivery assignment.',
        )
        const proposal = rows.find(
          (r) =>
            r.id === d.proposalId &&
            r.parentId === parent.id &&
            r.kind === 'proposal',
        )
        need(approved(proposal), 'Approved client-specific proposal required')
        need(
          d.proposalId === parent.data.proposalId,
          'Work orders and handoffs must use the opportunity’s current proposal version',
        )
        need(
          parent.data.capacityStatus === 'Confirmed' &&
            safeLink(parent.data.writtenAcceptance),
          'Confirmed capacity and written client acceptance required',
        )
        need(
          !rows.some((r) => r.kind === input.kind && r.parentId === parent.id),
          'A record already exists for this opportunity; repeated creation is blocked',
        )
        need(
          (d.reference && d.scope) || (input.kind === 'handoff' && d.reference),
          'Work-order reference and scope are required',
        )
        d.commercialSnapshot = proposal!.data
        d.capacityConfirmation = {
          status: parent.data.capacityStatus,
          evidence: parent.data.capacityEvidence,
        }
        d.client = {
          organizationId: parent.organizationId,
          contactId: parent.data.contactId,
          email: parent.data.email,
        }
        if (input.kind === 'handoff') {
          const [lead] = await tx
            .select()
            .from(members)
            .where(eq(members.id, d.deliveryLead))
          need(
            lead?.active && ['delivery', 'owner'].includes(lead.role),
            'Assign an active delivery lead',
          )
          need(
            actor.id === d.deliveryLead &&
              parent.data.deliveryLead === d.deliveryLead,
            'Only the assigned delivery lead can accept this handoff',
          )
          need(
            rows.some(
              (r) =>
                r.kind === 'workorder' &&
                r.parentId === parent.id &&
                r.data.proposalId === proposal!.id,
            ) &&
              d.agreedDates &&
              d.documents &&
              d.outstandingInformation,
            'Work order, agreed dates, document links and outstanding information required',
          )
          d.acceptedAt = new Date().toISOString()
          d.acceptedBy = actor.id
        }
      }
      if (input.kind === 'suppression') {
        need(
          isManager || actor.role === 'contributor',
          'No-contact access required',
        )
        need(
          org &&
            (canWrite(org) ||
              rows.some(
                (r) =>
                  r.organizationId === org.id &&
                  ['opportunity', 'research'].includes(r.kind) &&
                  canWrite(r),
              )),
          'No-contact records require a permitted organization',
        )
        need(
          input.organizationId && d.identity && d.reason && d.method,
          'Organization, matching email/phone/domain, reason and request method required',
        )
        d.identity = normalize(d.identity)
        d.appliedBy = actor.id
        d.appliedAt = new Date().toISOString()
      }
      if (old?.ownerId !== ownerId && old) {
        need(d.ownershipReason, 'Ownership change reason required')
        await tx.insert(records).values({
          kind: 'ownership',
          title: old.title,
          ownerId: actor.id,
          parentId: old.id,
          data: {
            previousOwner: old.ownerId,
            newOwner: ownerId,
            reason: d.ownershipReason,
            actor: actor.id,
            at: new Date().toISOString(),
          },
        })
      }
      if (['organization', 'contact'].includes(input.kind)) {
        d.suppressed = suppressed
        const matches = rows.filter(
          (r) =>
            r.id !== old?.id &&
            r.kind === input.kind &&
            [r.data.email, r.data.phone, r.data.website]
              .filter(Boolean)
              .map(normalize)
              .some((v) =>
                [d.email, d.phone, d.website]
                  .filter(Boolean)
                  .map(normalize)
                  .includes(v),
              ),
        )
        d.duplicateCandidates = matches.map((r) => r.id)
      }
      const values = {
        kind: input.kind,
        access: old?.access || 'record',
        title: input.title.trim(),
        ownerId,
        parentId: input.parentId || null,
        organizationId: input.organizationId || null,
        sourceKey: old?.sourceKey || input.sourceKey || null,
        data: d,
        updatedAt: new Date(),
      }
      const [saved] = old
        ? await tx
            .update(records)
            .set({ ...values, revision: old.revision + 1 })
            .where(
              and(eq(records.id, old.id), eq(records.revision, input.revision)),
            )
            .returning()
        : await tx.insert(records).values(values).returning()
      need(saved, 'Concurrent edit conflict. Refresh and review.')
      if (
        input.kind === 'activity' &&
        d.activityType === 'Discovery held' &&
        parent
      ) {
        const [cal] = await tx
          .select()
          .from(settings)
          .where(eq(settings.key, 'calendar'))
        const due = businessDeadline(
          d.occurredAt,
          (cal?.data || calendarDefault) as typeof calendarDefault,
        )
        await tx.insert(records).values({
          kind: 'task',
          title: 'Document discovery: ' + parent.title,
          ownerId: parent.ownerId,
          parentId: parent.id,
          organizationId: parent.organizationId,
          data: {
            nextAction: 'Complete discovery notes and fit rationale',
            nextDue: due,
            status: 'Open',
            triggerActivity: saved.id,
          },
        })
      }
      if (input.kind === 'opportunity' && !old && d.stage === 'S1')
        await tx.insert(records).values({
          kind: 'task',
          title: 'Acknowledge inquiry: ' + saved.title,
          ownerId,
          parentId: saved.id,
          organizationId: saved.organizationId,
          data: {
            nextAction: 'Acknowledge inquiry (one business day)',
            nextDue: d.acknowledgmentDue,
            status: 'Open',
          },
        })
      if (input.kind === 'suppression') {
        for (const r of rows.filter(
          (r) =>
            ['opportunity', 'research'].includes(r.kind) &&
            (r.organizationId === input.organizationId ||
              [
                r.data.email,
                r.data.phone,
                r.data.website,
                r.data.sourceUrl,
                rows.find((o) => o.id === r.organizationId)?.data.website,
              ]
                .filter(Boolean)
                .map(normalize)
                .includes(d.identity)),
        )) {
          const next = {
            ...r.data,
            suppressed: true,
            ...(r.kind === 'opportunity'
              ? {
                  stage: 'X4',
                  stageReason: d.reason,
                  closeReason: d.reason,
                  closedAt: d.appliedAt,
                }
              : {}),
          }
          await tx
            .update(records)
            .set({
              data: next,
              revision: r.revision + 1,
              updatedAt: new Date(),
            })
            .where(eq(records.id, r.id))
          await tx.insert(audit).values({
            recordId: r.id,
            actorId: actor.id,
            action: 'suppression applied',
            before: r.data,
            after: next,
          })
        }
      }
      await tx.insert(audit).values({
        recordId: saved.id,
        actorId: actor.id,
        action: old ? 'updated' : 'created',
        before: old || null,
        after: saved,
      })
      return saved
    })
    return Response.json({ record: result })
  } catch (error: unknown) {
    const details = error && typeof error === 'object' ? error : {}
    const code = 'code' in details ? details.code : undefined
    const status =
      'status' in details && typeof details.status === 'number'
        ? details.status
        : undefined
    const message = error instanceof Error ? error.message : undefined
    if (code === '23505')
      return Response.json(
        {
          error:
            'This source ID or version already exists. Refresh and review the duplicate.',
        },
        { status: 409 },
      )
    return Response.json(
      {
        error: status
          ? message
          : 'The operation could not be completed. No changes were saved. Check configuration or retry.',
      },
      { status: status || 503 },
    )
  }
}
export const config: Config = { path: '/api/crm' }
