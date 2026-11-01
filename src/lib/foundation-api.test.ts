// @vitest-environment node
// Synthetic mock API tests. No mail, Identity service or external database is used.
import { beforeEach, expect, it, vi } from 'vitest'
import type { RecordData, RecordEnvelope } from './crm-types'

type MockRow = Record<string, unknown>
type TableName = 'members' | 'records' | 'settings' | 'audit'
type MockTable = { table: TableName }
type Predicate = (row: MockRow) => boolean
interface FixtureRecord extends MockRow, RecordEnvelope {
  id: string
  revision: number
}
interface FixtureIdentity {
  id: string
}
interface FixtureMember extends MockRow {
  id: string
  email: string
  name: string
  role: string
  hr: boolean
  active: boolean
  commercial: boolean
}
interface MockQuery extends PromiseLike<MockRow[]> {
  where(predicate: Predicate): MockQuery
  for(): MockQuery
}
interface MockDatabase {
  select(): { from(table: MockTable): MockQuery }
  execute(): Promise<void>
  transaction<T>(work: (database: MockDatabase) => Promise<T>): Promise<T>
  insert(table: MockTable): {
    values(
      value: MockRow,
    ): PromiseLike<MockRow> & { returning(): Promise<MockRow[]> }
  }
  update(table: MockTable): {
    set(values: MockRow): {
      where(predicate: Predicate): { returning(): Promise<MockRow[]> }
    }
  }
}
const deferred = <T>(read: () => T): PromiseLike<T> => ({
  then(resolve, reject) {
    return Promise.resolve().then(read).then(resolve, reject)
  },
})
const fixture = vi.hoisted(() => ({
  user: { id: 'staff-owner' } as FixtureIdentity,
  members: [] as FixtureMember[],
  records: [] as FixtureRecord[],
  settings: [] as MockRow[],
  audit: [] as MockRow[],
  database: vi.fn(),
}))
vi.mock('@netlify/identity', () => ({
  getUser: async () => fixture.user,
  admin: { getUser: vi.fn() },
}))
vi.mock('../../db/schema', () => ({
  members: { table: 'members', id: 'id' },
  records: { table: 'records', id: 'id', revision: 'revision' },
  settings: { table: 'settings', key: 'key' },
  audit: { table: 'audit', recordId: 'recordId' },
}))
vi.mock('drizzle-orm', () => ({
  eq: (key: string, value: unknown) => (row: MockRow) => row[key] === value,
  and:
    (...rules: Predicate[]) =>
    (row: MockRow) =>
      rules.every((rule) => rule(row)),
  sql: () => ({}),
}))
vi.mock('../../db/index', () => ({ database: fixture.database }))
import handler from '../../netlify/functions/crm.mts'
const member = (role = 'owner', hr = false, id = 'staff-owner') => ({
  id,
  email: `${id}@example.invalid`,
  name: id,
  role,
  hr,
  active: true,
  commercial: false,
})
const row = (
  kind: string,
  id: string,
  data: RecordData = {},
  extra: Partial<FixtureRecord> = {},
): FixtureRecord => ({
  id,
  kind,
  title: id,
  access: 'record',
  ownerId: 'staff-owner',
  organizationId: null,
  parentId: null,
  revision: 1,
  data,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
})
const pending = {
  nextAction: 'Review source evidence',
  nextDue: '2027-01-01T15:00:00Z',
}
function db(): MockDatabase {
  const tableRows = (table: MockTable): MockRow[] => fixture[table.table]
  const query = (table: MockTable): MockQuery => {
    let found = [...tableRows(table)]
    const q: MockQuery = {
      ...deferred(() => found),
      where: (predicate) => {
        found = found.filter(predicate)
        return q
      },
      for: () => q,
    }
    return q
  }
  const api: MockDatabase = {
    select: () => ({ from: query }),
    execute: async () => {},
    transaction: async (fn) => {
      const saved = structuredClone({
        members: fixture.members,
        records: fixture.records,
        audit: fixture.audit,
      })
      try {
        return await fn(api)
      } catch (error) {
        fixture.members = saved.members
        fixture.records = saved.records
        fixture.audit = saved.audit
        throw error
      }
    },
    insert: (table) => ({
      values: (value) => {
        let committed: MockRow | undefined
        const commit = (): MockRow => {
          if (committed) return committed
          const target = tableRows(table)
          if (
            table.table === 'records' &&
            value.sourceKey &&
            target.some(
              (r) => r.kind === value.kind && r.sourceKey === value.sourceKey,
            )
          )
            throw Object.assign(new Error('duplicate'), { code: '23505' })
          committed = {
            id: `generated-${target.length}`,
            revision: 1,
            ...value,
          }
          target.push(committed)
          return committed
        }
        return { ...deferred(commit), returning: async () => [commit()] }
      },
    }),
    update: (table) => ({
      set: (values) => ({
        where: (predicate) => ({
          returning: async () => {
            const target = tableRows(table)
            const index = target.findIndex(predicate)
            if (index < 0) return []
            target[index] = { ...target[index], ...values }
            return [target[index]]
          },
        }),
      }),
    }),
  }
  return api
}
const request = (body?: unknown, suffix = '') =>
  new Request(
    `https://synthetic.invalid/api/crm${suffix}`,
    body
      ? {
          method: 'POST',
          headers: {
            origin: 'https://synthetic.invalid',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      : undefined,
  )
const call = (body: unknown) => handler(request(body))
const save = (record: RecordEnvelope) =>
  call({ action: 'foundation-save', record })
const previewAndAssign = async (
  previewRequest: unknown,
  assigneeId: string,
) => {
  const previewResponse = await call(previewRequest)
  const previewBody = await previewResponse.json()
  if (previewResponse.status !== 200 || !previewBody.receipt?.id)
    throw new Error(
      `Synthetic manager preview failed (${previewResponse.status}): ${JSON.stringify(previewBody)}`,
    )
  const assignmentResponse = await call({
    action: 'intake-assignment-create',
    assigneeId,
    receiptId: previewBody.receipt.id,
  })
  const assignmentBody = await assignmentResponse.json()
  if (assignmentResponse.status !== 200)
    throw new Error(
      `Synthetic import assignment failed (${assignmentResponse.status}): ${JSON.stringify(assignmentBody)}`,
    )
  return { previewBody, assignmentResponse, assignmentBody }
}
beforeEach(() => {
  vi.clearAllMocks()
  fixture.user = { id: 'staff-owner' }
  fixture.members = [member()]
  fixture.records = []
  fixture.audit = []
  fixture.database.mockImplementation(db)
  vi.stubGlobal('Netlify', { env: { get: () => undefined } })
})

it.each(['manager', 'contributor', 'viewer'])(
  'denies %s HR reads, CSV, audit and legacy writes even when assigned or named reader',
  async (role) => {
    fixture.members = [member(role)]
    const applicant = row(
      'application',
      'private-applicant',
      {
        workflow: 'sales',
        notes: 'RESTRICTED RESUME',
        readers: ['staff-owner'],
      },
      { access: 'hr' },
    )
    fixture.records = [
      applicant,
      row(
        'task',
        'private-child',
        { notes: 'RESTRICTED CHILD' },
        { parentId: applicant.id },
      ),
      row('import', 'private-summary', {
        summary: [{ id: applicant.id, notes: 'RESTRICTED COPY' }],
      }),
    ]
    for (const suffix of ['', '?export=csv']) {
      const response = await handler(request(undefined, suffix))
      expect(response.status).toBe(200)
      expect(await response.text()).not.toContain('RESTRICTED')
    }
    expect((await call({ action: 'audit', id: applicant.id })).status).toBe(403)
    expect(
      (
        await call({
          action: 'save',
          record: { ...applicant, kind: 'contact' },
        })
      ).status,
    ).toBe(403)
  },
)
it('permits HR membership independently of manager role and keeps common identities separate', async () => {
  fixture.members = [member('contributor', true)]
  fixture.records = [
    row('application', 'private', { workflow: 'program' }, { access: 'hr' }),
    row(
      'contact',
      'public-person',
      { email: 'common@example.invalid' },
      { access: 'team', ownerId: 'another-owner' },
    ),
  ]
  const response = await handler(request())
  expect((await response.json()).records).toHaveLength(2)
})
it('rejects direct HR creation and cross-links by a sales manager', async () => {
  fixture.members = [member('manager')]
  fixture.records = [
    row(
      'contact',
      'hr-person',
      { email: 'restricted@example.invalid' },
      { access: 'hr' },
    ),
  ]
  const response = await save({
    kind: 'engagement',
    title: 'Shared case',
    access: 'team',
    data: {
      workflow: 'partner',
      stage: 'New',
      personId: 'hr-person',
      ...pending,
    },
  })
  expect(response.status).toBe(403)
  expect(
    (
      await save({
        kind: 'application',
        title: 'Applicant',
        data: {
          workflow: 'sales',
          stage: 'Applied',
          personId: 'hr-person',
          ...pending,
        },
      })
    ).status,
  ).toBe(403)
})
it('prevents access downgrade through both new and legacy save routes', async () => {
  const privatePerson = row(
    'contact',
    'hr-person',
    { email: 'private@example.invalid', ...pending },
    { access: 'hr' },
  )
  fixture.records = [privatePerson]
  expect((await save({ ...privatePerson, access: 'team' })).status).toBe(403)
  expect(
    (
      await call({
        action: 'save',
        record: { ...privatePerson, access: 'record' },
      })
    ).status,
  ).toBe(403)
})
it('reuses a contact UUID across distinct workflows and rejects stale edits', async () => {
  fixture.records = [
    row(
      'contact',
      'person',
      { email: 'person@example.invalid' },
      { access: 'team' },
    ),
  ]
  for (const workflow of ['class', 'partner', 'service'])
    expect(
      (
        await save({
          kind: 'engagement',
          title: workflow,
          data: { personId: 'person', workflow, stage: 'New', ...pending },
        })
      ).status,
    ).toBe(200)
  expect(fixture.records.filter((r) => r.kind === 'contact')).toHaveLength(1)
  const engagement = fixture.records.find((r) => r.kind === 'engagement')!
  expect(engagement).toBeDefined()
  expect((await save({ ...engagement, revision: 0 })).status).toBe(409)
})
it('requires an accountable owner, next action, and due date and rejects invalid resource URLs', async () => {
  expect(
    (
      await save({
        kind: 'contact',
        title: 'Person',
        data: { email: 'person@example.invalid' },
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await save({
        kind: 'contact',
        title: 'Person',
        ownerId: 'inactive',
        data: { ...pending },
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await save({
        kind: 'resource',
        title: 'Training',
        data: {
          resourceType: 'training',
          status: 'Draft',
          audience: 'team',
          assetUrl: 'javascript:alert(1)',
          ...pending,
        },
      })
    ).status,
  ).toBe(400)
})
it('stamps owner approval, freezes approved versions, and versions a new draft', async () => {
  const input = {
    kind: 'resource',
    title: 'Approved training',
    data: {
      resourceType: 'training',
      status: 'Approved',
      audience: 'team',
      body: 'Worksheet',
      approvedBy: 'forged',
      approvedAt: 'forged',
      approvalReason: 'Reviewed synthetic training content',
    },
  }
  const response = await save(input)
  expect(response.status).toBe(200)
  const { record } = await response.json()
  expect(record.data.approvedBy).toBe('staff-owner')
  expect(record.data.version).toBe(1)
  expect(
    (await save({ ...record, data: { ...record.data, body: 'Replaced' } }))
      .status,
  ).toBe(400)
  const draft = await save({
    ...input,
    title: 'Second version',
    data: {
      ...input.data,
      status: 'Draft',
      familyId: record.data.familyId,
      approvedBy: 'forged',
      ...pending,
    },
  })
  expect(draft.status).toBe(200)
  const next = (await draft.json()).record
  expect(next.data.version).toBe(2)
  expect(next.data.approvedBy).toBeUndefined()
  fixture.members = [member('manager')]
  expect((await save({ ...input, title: 'Manager approval' })).status).toBe(403)
})
it('lets assigned learners submit while reserving completion for a manager', async () => {
  const training = row(
    'resource',
    'training',
    {
      resourceType: 'training',
      status: 'Approved',
      audience: 'team',
      version: 2,
    },
    { access: 'team' },
  )
  const learning = row('learning', 'assignment', {
    resourceId: 'training',
    resourceVersion: 2,
    assigneeId: 'learner',
    progress: 'Not started',
    ...pending,
  })
  fixture.records = [training, learning]
  fixture.members = [member(), member('contributor', false, 'learner')]
  fixture.user = { id: 'learner' }
  expect(
    (
      await save({
        ...learning,
        data: {
          ...learning.data,
          progress: 'Submitted',
          worksheetUrl: 'https://example.invalid/worksheet',
        },
      })
    ).status,
  ).toBe(200)
  const current = fixture.records.find((r) => r.id === 'assignment')!
  expect(current).toBeDefined()
  expect(
    (
      await save({
        ...current,
        data: { ...current.data, progress: 'Completed' },
      })
    ).status,
  ).toBe(403)
})
it('classifies test and invalid intake, repeats preview safely, and never applies fixtures', async () => {
  const preview = {
    action: 'intake-preview',
    sourceName: 'Synthetic source',
    workflow: 'class',
    rows: [
      {
        sourceId: 'stable-1',
        name: 'Person',
        email: 'person@example.invalid',
        ...pending,
      },
      { sourceId: 'stable-2', name: 'Missing email', ...pending },
    ],
  }
  const first = await call(preview)
  expect(first.status).toBe(200)
  const { rows } = await first.json()
  expect(rows.map((r: FixtureRecord) => r.data.status)).toEqual([
    'test',
    'invalid',
  ])
  const assignedPreview = await call(preview)
  expect(assignedPreview.status, await assignedPreview.clone().text()).toBe(200)
  expect(fixture.records.filter((r) => r.kind === 'intake')).toHaveLength(2)
  expect(
    (
      await call({
        action: 'intake-review',
        id: rows[0].id,
        revision: 1,
        decision: 'apply',
        reason: 'reviewed',
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await call({
        action: 'intake-review',
        id: rows[0].id,
        revision: 1,
        decision: 'exclude',
        reason: 'Synthetic fixture',
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await call({
        action: 'intake-review',
        id: rows[0].id,
        revision: 1,
        decision: 'exclude',
        reason: 'Repeat',
      })
    ).status,
  ).toBe(409)
})
it('enforces review-only duplicate linking and atomic repeat-safe application', async () => {
  // Insert a deliberately ready synthetic queue fixture; preview would flag .invalid.
  fixture.records = [
    row(
      'contact',
      'person',
      { email: 'person@example.invalid', suppressed: true },
      { access: 'team' },
    ),
    row(
      'intake',
      'queue',
      {
        sourceName: 'Synthetic',
        sourceId: 'original-1',
        name: 'Person',
        email: 'person@example.invalid',
        workflow: 'class',
        status: 'duplicate',
        batchReceiptId: 'batch-receipt',
        ...pending,
      },
      { sourceKey: 'stable-key' },
    ),
    row(
      'import',
      'batch-receipt',
      {
        status: 'queued for review',
        targetIds: ['queue'],
        counts: {
          total: 1,
          newlyQueued: 1,
          existingRows: 0,
          accepted: 0,
          failed: 0,
          excluded: 0,
          open: 1,
          reviewReady: 0,
          held: 1,
          alreadyApplied: 0,
          alreadyExcluded: 0,
        },
        blockers: [{ targetId: 'queue', status: 'duplicate' }],
      },
      { sourceKey: 'receipt-key' },
    ),
  ]
  const decision = {
    action: 'intake-review',
    id: 'queue',
    revision: 1,
    decision: 'apply',
    reason: 'Verified exact source email',
  }
  expect((await call(decision)).status).toBe(409)
  expect(fixture.records).toHaveLength(3)
  expect((await call({ ...decision, personId: 'person' })).status).toBe(200)
  expect(fixture.records.filter((r) => r.kind === 'contact')).toHaveLength(1)
  expect(
    fixture.records.find((r) => r.kind === 'engagement')?.data,
  ).toMatchObject({
    personId: 'person',
    suppressed: true,
    contactPermission: 'Do not contact',
  })
  expect(
    fixture.records.find((r) => r.id === 'batch-receipt')?.data,
  ).toMatchObject({
    status: 'reviewed',
    counts: { accepted: 1, open: 0, reviewReady: 0, held: 0 },
    lastReviewerId: 'staff-owner',
  })
  expect((await call({ ...decision, personId: 'person' })).status).toBe(409)
  expect(fixture.records.filter((r) => r.kind === 'engagement')).toHaveLength(1)
})
it('never upgrades marketing permission from class intake or clears permanent suppression', async () => {
  const person = row(
    'contact',
    'person',
    { email: 'person@example.invalid', suppressed: true, ...pending },
    { access: 'team' },
  )
  fixture.records = [person]
  expect(
    (
      await save({
        ...person,
        data: { ...person.data, contactPermission: 'Marketing permitted' },
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await save({
        ...person,
        data: {
          ...person.data,
          suppressed: false,
          contactPermission: 'Unknown',
        },
      })
    ).status,
  ).toBe(200)
  expect(fixture.records[0].data).toMatchObject({
    suppressed: true,
    contactPermission: 'Do not contact',
  })
})
it('registers permanent identity suppression and closes existing sales work when a shared person opts out', async () => {
  const org = row(
    'organization',
    'organization',
    { website: 'https://example.invalid' },
    { access: 'team' },
  )
  const person = row(
    'contact',
    'person',
    { email: 'old@example.invalid', ...pending },
    { organizationId: org.id, access: 'team' },
  )
  const opportunity = row(
    'opportunity',
    'sales-work',
    { stage: 'S5' },
    { organizationId: org.id },
  )
  const research = row('research', 'research-work', {
    email: 'old@example.invalid',
  })
  fixture.records = [org, person, opportunity, research]
  expect(
    (
      await save({
        ...person,
        data: { ...person.data, contactPermission: 'Do not contact' },
      })
    ).status,
  ).toBe(200)
  expect(
    fixture.records.find((r) => r.id === opportunity.id)?.data,
  ).toMatchObject({ suppressed: true, stage: 'X4' })
  expect(
    fixture.records.find((r) => r.id === research.id)?.data.suppressed,
  ).toBe(true)
  expect(
    fixture.records.some(
      (r) =>
        r.kind === 'suppression' && r.data.identity === 'old@example.invalid',
    ),
  ).toBe(true)
  const current = fixture.records.find((r) => r.id === person.id)!
  expect(current).toBeDefined()
  expect(
    (
      await save({
        ...current,
        data: {
          ...current.data,
          email: 'new@example.invalid',
          contactPermission: 'Unknown',
        },
      })
    ).status,
  ).toBe(200)
  expect(
    fixture.records
      .filter((r) => r.kind === 'suppression')
      .map((r) => r.data.identity),
  ).toEqual(
    expect.arrayContaining(['old@example.invalid', 'new@example.invalid']),
  )
  expect(
    fixture.records.find((r) => r.id === person.id)?.data.contactPermission,
  ).toBe('Do not contact')
})
it('creates canonical suppression when reviewed intake links a withdrawal to an existing person', async () => {
  fixture.records = [
    row(
      'contact',
      'person',
      { email: 'person@example.invalid' },
      { access: 'team' },
    ),
    row(
      'intake',
      'queue',
      {
        sourceName: 'Synthetic',
        sourceId: 'withdrawal',
        name: 'Person',
        email: 'person@example.invalid',
        workflow: 'class',
        status: 'duplicate',
        contactPermission: 'Do not contact',
        ...pending,
      },
      { sourceKey: 'withdrawal-key' },
    ),
  ]
  expect(
    (
      await call({
        action: 'intake-review',
        id: 'queue',
        revision: 1,
        decision: 'apply',
        personId: 'person',
        reason: 'Verified withdrawal source',
      })
    ).status,
  ).toBe(200)
  expect(fixture.records.find((r) => r.id === 'person')?.data).toMatchObject({
    suppressed: true,
    contactPermission: 'Do not contact',
  })
  expect(
    fixture.records.some(
      (r) =>
        r.kind === 'suppression' &&
        r.data.identity === 'person@example.invalid',
    ),
  ).toBe(true)
})
it('denies an owner-created shared child under restricted HR data', async () => {
  fixture.records = [
    row(
      'application',
      'private-case',
      { workflow: 'program' },
      { access: 'hr' },
    ),
  ]
  expect(
    (
      await save({
        kind: 'resource',
        title: 'Shared child',
        parentId: 'private-case',
        data: {
          resourceType: 'template',
          audience: 'team',
          status: 'Draft',
          body: 'Text',
          ...pending,
        },
      })
    ).status,
  ).toBe(403)
})
it('keeps organizations, provenance, and no-contact identities created from applicant intake private', async () => {
  fixture.records = [
    row(
      'intake',
      'private-queue',
      {
        sourceName: 'PRIVATE applicant source',
        sourceId: 'private-row-1',
        sourceUrl: 'https://example.invalid/private-form',
        name: 'Private applicant',
        email: 'applicant@example.invalid',
        organization: 'PRIVATE applicant institution',
        workflow: 'program',
        status: 'ready',
        contactPermission: 'Do not contact',
        ...pending,
      },
      { access: 'hr', sourceKey: 'private-source-key' },
    ),
  ]
  expect(
    (
      await call({
        action: 'intake-review',
        id: 'private-queue',
        revision: 1,
        decision: 'apply',
        reason: 'Verified applicant source',
      })
    ).status,
  ).toBe(200)
  const organization = fixture.records.find((r) => r.kind === 'organization')!
  expect(organization).toBeDefined()
  expect(organization.access).toBe('hr')
  expect(organization.data.sourceUrl).toBe(
    'https://example.invalid/private-form',
  )
  expect(fixture.records.filter((r) => r.kind === 'suppression')).toEqual([
    expect.objectContaining({
      access: 'hr',
      data: expect.objectContaining({ identity: 'applicant@example.invalid' }),
    }),
  ])
  fixture.members = [member('manager')]
  for (const suffix of ['', '?export=csv']) {
    const response = await handler(request(undefined, suffix))
    expect(response.status).toBe(200)
    const result = await response.text()
    expect(result).not.toContain('PRIVATE')
    expect(result).not.toContain('private-form')
    expect(result).not.toContain('applicant@example.invalid')
  }
})

it('preserves applicant details only in restricted preview rows and keeps test rows held', async () => {
  const details = {
    applicantId: 'applicant-synthetic-1',
    personSourceId: 'person-synthetic-1',
    applicationSourceId: 'application-synthetic-1',
    program: 'Synthetic program',
    cohort: 'Synthetic cohort',
    resumeUrl: 'https://assets.invalid/restricted-resume',
    onboardingStatus: 'Awaiting verification',
    participationState: 'withdrawn',
    sourceVersion: 'revision-2',
    sourceRow: 'original-row-7',
    sourceUrl: 'https://forms.invalid/restricted-source',
    sourceCreatedAt: '2026-10-21T13:00:00Z',
    sourceUpdatedAt: '2026-10-28T16:30:00-04:00',
  }
  const mapped = {
    ...pending,
    ...details,
    sourceId: 'restricted-detail-1',
    name: 'Synthetic applicant',
    email: 'applicant@review.invalid',
    sourceFieldColumns: {
      applicantId: 'Application ID',
      personSourceId: 'Person ID',
      applicationSourceId: 'Application ID',
      participationState: 'Current status',
      sourceUpdatedAt: 'Updated at',
    },
  }
  const preview = await call({
    action: 'intake-preview',
    sourceName: 'Synthetic applicant details',
    workflow: 'program',
    rows: [mapped],
  })
  expect(preview.status).toBe(200)
  const queue = fixture.records.find((r) => r.kind === 'intake')!
  expect(queue).toBeDefined()
  expect(queue.access).toBe('hr')
  expect(queue.data).toMatchObject({
    ...details,
    status: 'test',
    sourceCreatedAt: '2026-10-21T13:00:00.000Z',
    sourceUpdatedAt: '2026-10-28T20:30:00.000Z',
    fieldProvenance: {
      personSourceId: expect.objectContaining({
        sourceName: 'Synthetic applicant details',
        sourceId: 'restricted-detail-1',
        sourceColumn: 'Person ID',
      }),
      sourceUpdatedAt: expect.objectContaining({
        sourceColumn: 'Updated at',
        sourceUpdatedAt: '2026-10-28T20:30:00.000Z',
      }),
    },
  })
  const responseBody = await preview.json()
  expect(responseBody.summary).toMatchObject({
    total: 1,
    newlyQueued: 1,
    existingRows: 0,
    held: 1,
  })
  const batchReceipt = fixture.records.find((r) => r.kind === 'import')!
  expect(batchReceipt).toMatchObject({
    access: 'hr',
    data: {
      status: 'queued for review',
      mappingVersion: 1,
      operatorId: 'staff-owner',
      targetIds: [queue.id],
    },
  })
  expect(
    (
      await call({
        action: 'intake-review',
        id: queue.id,
        revision: queue.revision,
        decision: 'apply',
        reason: 'Synthetic details remain held',
      })
    ).status,
  ).toBe(400)
  const shared = await call({
    action: 'intake-preview',
    sourceName: 'Synthetic shared details',
    workflow: 'class',
    rows: [mapped],
  })
  expect(shared.status).toBe(200)
  const sharedQueue = fixture.records.find(
    (r) => r.data.sourceName === 'Synthetic shared details',
  )!
  expect(sharedQueue).toBeDefined()
  expect(sharedQueue.access).toBe('record')
  for (const key of [
    'applicantId',
    'program',
    'cohort',
    'resumeUrl',
    'onboardingStatus',
    'personSourceId',
    'applicationSourceId',
    'participationState',
    'fieldProvenance',
  ])
    expect(sharedQueue.data).not.toHaveProperty(key)
  expect(sharedQueue.data).toMatchObject({
    sourceVersion: details.sourceVersion,
    sourceRow: details.sourceRow,
    sourceUrl: details.sourceUrl,
  })
  fixture.members = [member('manager')]
  const visible = await handler(request())
  expect(visible.status).toBe(200)
  const body = await visible.text()
  expect(body).toContain(sharedQueue.id)
  expect(body).not.toContain(queue.id)
  expect(body).not.toContain(details.resumeUrl)
  expect(body).not.toContain(details.applicantId)
  expect(body).not.toContain('Person ID')
  expect(body).not.toContain(batchReceipt.id)
})

it('holds stable HR identity conflicts and persists idempotent batch receipts', async () => {
  fixture.records = [
    row(
      'contact',
      'prior-person',
      { name: 'Casey Emerson', email: 'casey.old@emerson.org' },
      { access: 'hr' },
    ),
    row(
      'application',
      'prior-application',
      {
        personId: 'prior-person',
        personSourceId: 'HR-PERSON-42',
        applicationSourceId: 'HR-APP-1',
      },
      { access: 'hr' },
    ),
  ]
  const preview = {
    action: 'intake-preview',
    sourceName: 'Authoritative HR roster v3',
    workflow: 'program',
    batchIndex: 1,
    batchCount: 1,
    mappingVersion: 2,
    rows: [
      {
        ...pending,
        sourceId: 'source-row-42',
        sourceVersion: 'v3',
        personSourceId: 'HR-PERSON-42',
        applicationSourceId: 'HR-APP-2',
        name: 'Casey Emerson',
        email: 'casey.new@emerson.org',
      },
    ],
  }
  const first = await call(preview)
  expect(first.status).toBe(200)
  const firstBody = await first.json()
  const intake = fixture.records.find((r) => r.kind === 'intake')!
  expect(intake.data).toMatchObject({
    status: 'conflict',
    identityHold: true,
    personSourceId: 'HR-PERSON-42',
  })
  expect(firstBody.summary).toMatchObject({
    newlyQueued: 1,
    reviewReady: 0,
    held: 1,
  })
  const firstReceipt = fixture.records.find((r) => r.kind === 'import')!
  expect(firstReceipt.data).toMatchObject({
    mappingVersion: 2,
    batchIndex: 1,
    batchCount: 1,
    targetIds: [intake.id],
  })
  const second = await call(preview)
  expect(second.status).toBe(200)
  const secondBody = await second.json()
  expect(secondBody.receipt.id).toBe(firstBody.receipt.id)
  expect(fixture.records.filter((r) => r.kind === 'import')).toHaveLength(1)
  expect(fixture.records.filter((r) => r.kind === 'intake')).toHaveLength(1)
})

it('limits an assigned contact batch to its operator and reconciles created vs matched receipts', async () => {
  fixture.members = [
    member('owner', false, 'staff-owner'),
    member('contributor', false, 'intern-1'),
    member('contributor', false, 'outsider'),
  ]
  const managerPreview = {
    action: 'intake-preview',
    batchType: 'contacts',
    sourceName: 'Synthetic bounded contact batch',
    workflow: 'service',
    batchIndex: 1,
    batchCount: 1,
    mappingVersion: 2,
    rows: [
      {
        sourceId: 'synthetic-row-a',
        sourceVersion: 'version-a',
        name: 'Sample Contact',
        email: 'sample.contact@emerson.org',
        sourceFieldColumns: {
          sourceId: 'Source ID',
          sourceVersion: 'Source Version',
          name: 'Name',
          email: 'Email',
        },
        ...pending,
      },
    ],
  }
  const { assignmentResponse, assignmentBody } = await previewAndAssign(
    managerPreview,
    'intern-1',
  )
  expect(assignmentResponse.status).toBe(200)
  const assignment = assignmentBody.record
  expect(assignment.data).toMatchObject({
    assignmentType: 'intake',
    assigneeId: 'intern-1',
    batchType: 'contacts',
    sourceVersion: 'version-a',
    workflow: 'service',
  })
  expect(
    (
      await call({
        action: 'intake-assignment-create',
        assigneeId: 'intern-1',
        receiptId: assignment.data.receiptId,
      })
    ).status,
  ).toBe(200)
  expect(
    fixture.records.filter((record) => record.data.assignmentType === 'intake'),
  ).toHaveLength(1)

  const preview = {
    action: 'intake-preview',
    assignmentId: assignment.id,
    batchType: 'contacts',
    sourceName: 'Synthetic bounded contact batch',
    sourceVersion: 'version-a',
    workflow: 'service',
    batchIndex: 1,
    batchCount: 1,
    mappingVersion: 2,
    rows: [
      {
        sourceId: 'synthetic-row-a',
        sourceVersion: 'version-a',
        name: 'Sample Contact',
        email: 'sample.contact@emerson.org',
        sourceFieldColumns: {
          sourceId: 'Source ID',
          sourceVersion: 'Source Version',
          name: 'Name',
          email: 'Email',
        },
        ...pending,
      },
    ],
  }
  fixture.user = { id: 'intern-1' }
  const wrongBatch = await call({
    ...preview,
    batchIndex: 2,
  })
  expect([400, 403]).toContain(wrongBatch.status)
  expect((await call({ ...preview, sourceVersion: 'version-b' })).status).toBe(
    403,
  )
  const tampered = structuredClone(preview)
  tampered.rows[0].name = 'Substituted Contact'
  expect((await call(tampered)).status).toBe(403)
  expect((await call({ ...preview, assignmentId: undefined })).status).toBe(403)
  const assignedPreview = await call(preview)
  expect(assignedPreview.status, await assignedPreview.clone().text()).toBe(200)
  const intake = fixture.records.find((record) => record.kind === 'intake')!
  expect(intake).toMatchObject({
    ownerId: 'staff-owner',
    access: 'record',
    data: {
      batchAssignmentId: assignment.id,
      assigneeId: 'intern-1',
      batchType: 'contacts',
      status: 'ready',
    },
  })
  const receipt = fixture.records.find(
    (record) => record.kind === 'import' && record.data.batchId,
  )!
  expect(receipt).toMatchObject({
    ownerId: 'staff-owner',
    data: { assigneeId: 'intern-1', assignmentId: assignment.id },
  })
  fixture.user = { id: 'outsider' }
  expect((await call(preview)).status).toBe(403)
  fixture.user = { id: 'intern-1' }
  expect(
    (await call({ ...preview, assignmentId: 'different-assignment' })).status,
  ).toBe(403)

  const applied = await call({
    action: 'intake-review',
    id: intake.id,
    revision: intake.revision,
    assignmentId: assignment.id,
    decision: 'apply',
    reason: 'Synthetic assigned sample reviewed',
  })
  expect(applied.status).toBe(200)
  expect(
    fixture.records.filter((record) => record.kind === 'contact'),
  ).toHaveLength(1)
  expect(
    fixture.records.find((record) => record.kind === 'contact'),
  ).toMatchObject({
    ownerId: 'staff-owner',
    access: 'record',
    data: { suppressed: false, contactPermission: 'Unknown' },
  })
  const updatedReceipt = fixture.records.find(
    (record) => record.id === receipt.id,
  )!
  expect(updatedReceipt.data.counts).toMatchObject({
    accepted: 1,
    created: 1,
    matched: 0,
    held: 0,
    failed: 0,
    reviewReady: 0,
    open: 0,
  })
  const appliedRetry = await call(preview)
  expect(appliedRetry.status).toBe(200)
  const retryBody = await appliedRetry.json()
  expect(retryBody.receipt.batchId).toBe(
    (await (await call(preview)).json()).receipt.batchId,
  )
  expect(retryBody.summary).toMatchObject({
    accepted: 1,
    created: 1,
    matched: 0,
    existingRows: 1,
  })
  expect(
    fixture.records.filter((record) => record.kind === 'contact'),
  ).toHaveLength(1)
})

it('counts a reviewed existing-contact link as matched and preserves suppression', async () => {
  fixture.members = [
    member('owner', false, 'staff-owner'),
    member('contributor', false, 'intern-1'),
  ]
  const existingContact = row(
    'contact',
    'existing-contact',
    {
      email: 'existing@northwind.org',
      suppressed: true,
      contactPermission: 'Do not contact',
      ...pending,
    },
    { access: 'team' },
  )
  fixture.records = [existingContact]
  const managerPreview = {
    action: 'intake-preview',
    batchType: 'contacts',
    sourceName: 'Synthetic match batch',
    workflow: 'service',
    batchIndex: 1,
    batchCount: 1,
    mappingVersion: 2,
    rows: [
      {
        sourceId: 'match-row',
        sourceVersion: 'version-a',
        name: 'Existing Contact',
        email: 'existing@northwind.org',
        ...pending,
      },
    ],
  }
  const { assignmentResponse, assignmentBody } = await previewAndAssign(
    managerPreview,
    'intern-1',
  )
  expect(assignmentResponse.status).toBe(200)
  const assignmentId = assignmentBody.record.id
  fixture.user = { id: 'intern-1' }
  const preview = await call({
    action: 'intake-preview',
    assignmentId,
    batchType: 'contacts',
    sourceName: 'Synthetic match batch',
    sourceVersion: 'version-a',
    workflow: 'service',
    batchIndex: 1,
    batchCount: 1,
    mappingVersion: 2,
    rows: [
      {
        sourceId: 'match-row',
        sourceVersion: 'version-a',
        name: 'Existing Contact',
        email: 'existing@northwind.org',
        ...pending,
      },
    ],
  })
  expect(preview.status, await preview.clone().text()).toBe(200)
  const queue = fixture.records.find((record) => record.kind === 'intake')!
  expect(queue.data.status).toBe('duplicate')
  const receipt = fixture.records.find(
    (record) => record.kind === 'import' && record.data.batchId,
  )!
  expect(receipt.data.counts).toMatchObject({ held: 1, matched: 0 })
  const apply = await call({
    action: 'intake-review',
    id: queue.id,
    revision: queue.revision,
    assignmentId,
    decision: 'apply',
    personId: existingContact.id,
    reason: 'Synthetic exact email confirmed',
  })
  expect(apply.status).toBe(200)
  expect(
    fixture.records.filter((record) => record.kind === 'contact'),
  ).toHaveLength(1)
  expect(
    fixture.records.find((record) => record.kind === 'engagement')?.data,
  ).toMatchObject({
    suppressed: true,
    contactPermission: 'Do not contact',
  })
  expect(receipt.data.counts).toMatchObject({
    accepted: 1,
    created: 0,
    matched: 1,
    held: 0,
    failed: 0,
    open: 0,
  })
})

it('denies HR operators and never assigns restricted applicant workflows', async () => {
  fixture.members = [
    member('owner', false, 'staff-owner'),
    member('contributor', true, 'hr-operator'),
    member('contributor', false, 'intern-1'),
  ]
  const restrictedPreview = await call({
    action: 'intake-preview',
    sourceName: 'Synthetic restricted applicant sample',
    workflow: 'program',
    rows: [
      {
        sourceId: 'restricted-sample-row',
        sourceVersion: 'version-a',
        name: 'Synthetic Applicant',
        email: 'applicant@review.invalid',
        ...pending,
      },
    ],
  })
  const restrictedReceipt = (await restrictedPreview.json()).receipt
  expect(
    (
      await call({
        action: 'intake-assignment-create',
        assigneeId: 'hr-operator',
        receiptId: restrictedReceipt.id,
      })
    ).status,
  ).toBe(403)
  expect(
    (
      await call({
        action: 'intake-assignment-create',
        assigneeId: 'intern-1',
        receiptId: restrictedReceipt.id,
      })
    ).status,
  ).toBe(403)
  const managerPreview = {
    action: 'intake-preview',
    batchType: 'contacts',
    sourceName: 'Synthetic HR denial batch',
    workflow: 'service',
    batchIndex: 1,
    batchCount: 1,
    mappingVersion: 2,
    rows: [
      {
        sourceId: 'hr-row',
        sourceVersion: 'version-a',
        name: 'No disclosure',
        email: 'private@example.com',
        ...pending,
      },
    ],
  }
  const { assignmentBody } = await previewAndAssign(managerPreview, 'intern-1')
  const assignment = assignmentBody.record
  const assignedIntake = fixture.records.find(
    (record) => record.kind === 'intake',
  )!
  const assignedReceipt = fixture.records.find(
    (record) => record.kind === 'import' && record.data.batchId,
  )!
  fixture.records.find(
    (record) => record.id === assignment.id,
  )!.data.assigneeId = 'hr-operator'
  assignedIntake.data.assigneeId = 'hr-operator'
  assignedReceipt.data.assigneeId = 'hr-operator'
  fixture.user = { id: 'hr-operator' }
  expect(
    (
      await call({
        action: 'intake-preview',
        assignmentId: assignment.id,
        batchType: 'contacts',
        sourceName: 'Synthetic HR denial batch',
        sourceVersion: 'version-a',
        workflow: 'service',
        batchIndex: 1,
        batchCount: 1,
        mappingVersion: 2,
        rows: managerPreview.rows,
      })
    ).status,
  ).toBe(403)
})

it('imports a bounded organization and resource sample into separate record kinds only', async () => {
  fixture.members = [
    member('owner', false, 'staff-owner'),
    member('contributor', false, 'intern-1'),
  ]
  fixture.records = [
    row(
      'organization',
      'existing-org',
      { website: 'https://existing.example.com' },
      { title: 'Existing Service Organization', access: 'team' },
    ),
  ]
  const assign = async (previewRequest: unknown) => {
    const { assignmentResponse, assignmentBody } = await previewAndAssign(
      previewRequest,
      'intern-1',
    )
    expect(assignmentResponse.status).toBe(200)
    return assignmentBody.record.id as string
  }
  const orgRequest = {
    action: 'intake-preview',
    batchType: 'organizations',
    sourceName: 'Synthetic org sample',
    sourceVersion: 'bounded-v1',
    batchIndex: 1,
    batchCount: 1,
    mappingVersion: 2,
    rows: [
      {
        sourceId: 'org-row-1',
        sourceVersion: 'bounded-v1',
        name: 'New Pilot Service Organization',
        website: 'https://new-service.example.com',
        sourceFieldColumns: { sourceId: 'ID', name: 'Organization' },
        ...pending,
      },
    ],
  }
  const orgAssignmentId = await assign(orgRequest)
  fixture.user = { id: 'intern-1' }
  const orgPreview = await call({
    ...orgRequest,
    assignmentId: orgAssignmentId,
  })
  const orgBody = await orgPreview.json()
  expect(orgBody.summary.total).toBe(1)
  expect(orgBody.summary.reviewReady).toBe(1)
  const orgQueue = orgBody.rows[0]
  const orgApplied = await call({
    action: 'intake-review',
    id: orgQueue.id,
    revision: orgQueue.revision,
    assignmentId: orgAssignmentId,
    decision: 'apply',
    reason: 'Synthetic organization sample reviewed',
  })
  expect(orgApplied.status).toBe(200)
  const createdOrganization = fixture.records.find(
    (record) =>
      record.kind === 'organization' && record.sourceKey === orgQueue.sourceKey,
  )!
  expect(createdOrganization.data).toMatchObject({
    sourceVersion: 'bounded-v1',
    fieldProvenance: {
      name: expect.objectContaining({ sourceColumn: 'Organization' }),
    },
  })
  expect(
    fixture.records.filter((record) => record.kind === 'contact'),
  ).toHaveLength(0)
  expect(
    fixture.records.filter((record) => record.kind === 'resource'),
  ).toHaveLength(0)
  const orgReceipt = fixture.records.find(
    (record) => record.kind === 'import' && record.data.batchId,
  )!
  expect(orgReceipt.data.counts).toMatchObject({
    created: 1,
    matched: 0,
    held: 0,
    failed: 0,
  })

  const resourceRequest = {
    action: 'intake-preview',
    batchType: 'resources',
    sourceName: 'Synthetic service sample',
    sourceVersion: 'bounded-v1',
    batchIndex: 1,
    batchCount: 1,
    mappingVersion: 2,
    rows: [
      {
        sourceId: 'resource-row-1',
        sourceVersion: 'bounded-v1',
        name: 'Pilot service guide',
        resourceType: 'template',
        body: 'Synthetic instructions only',
        organization: 'Existing Service Organization',
        sourceFieldColumns: {
          sourceId: 'ID',
          sourceVersion: 'Version',
          name: 'Title',
          body: 'Content',
          organization: 'Organization',
        },
      },
    ],
  }
  fixture.user = { id: 'staff-owner' }
  const resourceAssignmentId = await assign(resourceRequest)
  const resourcePreview = await call({
    ...resourceRequest,
    assignmentId: resourceAssignmentId,
  })
  const resourceBody = await resourcePreview.json()
  expect(resourceBody.summary.total).toBe(1)
  expect(resourceBody.summary.reviewReady).toBe(1)
  const resourceQueue = resourceBody.rows[0]
  const resourceApplied = await call({
    action: 'intake-review',
    id: resourceQueue.id,
    revision: resourceQueue.revision,
    assignmentId: resourceAssignmentId,
    decision: 'apply',
    reason: 'Synthetic resource sample reviewed',
  })
  expect(resourceApplied.status).toBe(200)
  const resource = fixture.records.find(
    (record) =>
      record.kind === 'resource' &&
      record.sourceKey === resourceQueue.sourceKey,
  )!
  expect(resource).toMatchObject({
    kind: 'resource',
    access: 'record',
    organizationId: 'existing-org',
    data: {
      resourceType: 'template',
      status: 'Needs review',
      audience: 'team',
      sourceVersion: 'bounded-v1',
      fieldProvenance: {
        body: expect.objectContaining({ sourceColumn: 'Content' }),
      },
    },
  })
  expect(
    fixture.records.filter((record) => record.kind === 'contact'),
  ).toHaveLength(0)
  const resourceReceipt = fixture.records.filter(
    (record) =>
      record.kind === 'import' && record.data.batchType === 'resources',
  )[0]
  expect(resourceReceipt.data.counts).toMatchObject({
    created: 1,
    matched: 0,
    held: 0,
    failed: 0,
  })
})

it('gives each content and mapping version a stable batch identity', async () => {
  const preview = {
    action: 'intake-preview',
    sourceName: 'Synthetic source v1',
    workflow: 'class',
    batchIndex: 1,
    batchCount: 2,
    mappingVersion: 2,
    rows: [
      {
        ...pending,
        sourceId: 'synthetic-batch-row-1',
        sourceVersion: 'version-1',
        name: 'Synthetic applicant',
        email: 'applicant@review.invalid',
      },
    ],
  }
  const first = await call(preview)
  expect(first.status).toBe(200)
  const firstBody = await first.json()
  const retry = await call(preview)
  expect(retry.status).toBe(200)
  const retryBody = await retry.json()
  expect(retryBody.receipt).toMatchObject({
    id: firstBody.receipt.id,
    batchId: firstBody.receipt.batchId,
  })

  const remapped = await call({ ...preview, mappingVersion: 3 })
  expect(remapped.status).toBe(200)
  const remappedBody = await remapped.json()
  expect(remappedBody.receipt.batchId).not.toBe(firstBody.receipt.batchId)
  expect(remappedBody.receipt.mappingVersion).toBe(3)

  const changed = await call({
    ...preview,
    mappingVersion: 3,
    rows: [{ ...preview.rows[0], sourceVersion: 'version-2' }],
  })
  expect(changed.status).toBe(200)
  const changedBody = await changed.json()
  expect(changedBody.receipt.batchId).not.toBe(remappedBody.receipt.batchId)
  expect(changedBody.receipt.id).not.toBe(remappedBody.receipt.id)
  expect(fixture.records.filter((r) => r.kind === 'import')).toHaveLength(3)

  const changedRetry = await call({
    ...preview,
    mappingVersion: 3,
    rows: [{ ...preview.rows[0], sourceVersion: 'version-2' }],
  })
  expect((await changedRetry.json()).receipt).toMatchObject({
    id: changedBody.receipt.id,
    batchId: changedBody.receipt.batchId,
  })
  expect(fixture.records.filter((r) => r.kind === 'import')).toHaveLength(3)
})

it('counts invalid source rows as failed and resolves them on exclusion', async () => {
  const preview = await call({
    action: 'intake-preview',
    sourceName: 'Invalid source',
    workflow: 'program',
    rows: [
      {
        ...pending,
        sourceId: 'invalid-row-1',
        name: 'Applicant Row',
        email: 'malformed',
      },
    ],
  })
  expect(preview.status).toBe(200)
  const body = await preview.json()
  const intake = fixture.records.find((record) => record.kind === 'intake')!
  expect(body.summary).toMatchObject({
    failed: 1,
    held: 0,
    reviewReady: 0,
    open: 1,
  })
  expect(body.receipt.status).toBe('queued for review')

  const exclusion = await call({
    action: 'intake-review',
    id: intake.id,
    revision: intake.revision,
    decision: 'exclude',
    reason: 'Invalid synthetic email fixture',
  })
  expect(exclusion.status).toBe(200)
  expect(
    fixture.records.find((record) => record.kind === 'import')?.data,
  ).toMatchObject({
    status: 'reviewed',
    counts: { failed: 0, excluded: 1, held: 0, reviewReady: 0, open: 0 },
    blockers: [],
  })
})

it('keeps applicant preview and its batch receipt behind explicit HR authority', async () => {
  const requestBody = {
    action: 'intake-preview',
    sourceName: 'Restricted application source',
    workflow: 'program',
    rows: [
      {
        ...pending,
        sourceId: 'application-row-1',
        name: 'Synthetic applicant',
        email: 'applicant@review.invalid',
      },
    ],
  }
  fixture.members = [member('manager', false)]
  expect((await call(requestBody)).status).toBe(403)
  expect(fixture.records).toEqual([])
  fixture.members = [member('manager', true)]
  const allowed = await call(requestBody)
  expect(allowed.status).toBe(200)
  expect(fixture.records.find((r) => r.kind === 'intake')?.access).toBe('hr')
  expect(fixture.records.find((r) => r.kind === 'import')?.access).toBe('hr')
})

it('rejects source timestamps without timezone and repeated stable row IDs atomically', async () => {
  const invalidTimestamp = await call({
    action: 'intake-preview',
    sourceName: 'Authoritative HR timestamps',
    workflow: 'program',
    rows: [
      {
        ...pending,
        sourceId: 'source-row-1',
        sourceUpdatedAt: '2026-10-28T16:30:00',
        name: 'Casey Emerson',
        email: 'casey@emerson.example',
      },
    ],
  })
  expect(invalidTimestamp.status).toBe(400)
  expect(await invalidTimestamp.text()).toContain('explicit timezone offset')
  expect(fixture.records).toEqual([])
  const repeatedIds = await call({
    action: 'intake-preview',
    sourceName: 'Authoritative HR repeated IDs',
    workflow: 'program',
    rows: [
      {
        ...pending,
        sourceId: 'same-row',
        name: 'Casey Emerson',
        email: 'casey@emerson.example',
      },
      {
        ...pending,
        sourceId: 'same-row',
        name: 'Casey Emerson',
        email: 'casey@emerson.example',
      },
    ],
  })
  expect(repeatedIds.status).toBe(400)
  expect(await repeatedIds.text()).toContain('repeated stable source row IDs')
  expect(fixture.records).toEqual([])
})
it('rejects unsafe applicant resume links atomically during restricted intake preview', async () => {
  const response = await call({
    action: 'intake-preview',
    sourceName: 'Synthetic unsafe resume',
    workflow: 'sales',
    rows: [
      {
        ...pending,
        sourceId: 'unsafe-resume-1',
        name: 'Synthetic applicant',
        email: 'applicant@review.invalid',
        resumeUrl: 'http://assets.invalid/resume',
      },
    ],
  })
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('HTTPS')
  expect(fixture.records).toEqual([])
  expect(fixture.audit).toEqual([])
})

it.each([
  ['version', { sourceVersion: 'version-2' }],
  ['content', { cohort: 'Synthetic revised cohort' }],
])(
  'holds a pending intake when its source %s changes without replacing the original payload',
  async (_change, delta) => {
    const mapped = {
      ...pending,
      sourceId: 'original-row',
      name: 'Synthetic applicant',
      email: 'applicant@review.invalid',
      sourceVersion: 'version-1',
      sourceRow: 'sheet-row-7',
      cohort: 'Synthetic original cohort',
      resumeUrl: 'https://assets.invalid/original-resume',
    }
    const preview = {
      action: 'intake-preview',
      sourceName: 'Synthetic versioned applicant source',
      workflow: 'program',
      rows: [mapped],
    }
    expect((await call(preview)).status).toBe(200)
    const original = structuredClone(
      fixture.records.find((record) => record.kind === 'intake')!,
    )
    expect(original).toBeDefined()
    const auditBefore = fixture.audit.length
    expect(
      (
        await call({
          ...preview,
          rows: [
            {
              ...mapped,
              name: '  Synthetic applicant  ',
              email: 'APPLICANT@REVIEW.INVALID',
            },
          ],
        })
      ).status,
    ).toBe(200)
    expect(fixture.records.find((record) => record.id === original.id)).toEqual(
      original,
    )
    expect(fixture.audit).toHaveLength(auditBefore)
    expect(
      (await call({ ...preview, rows: [{ ...mapped, ...delta }] })).status,
    ).toBe(200)
    const held = fixture.records.find((record) => record.id === original.id)!
    expect(held).toBeDefined()
    expect(held.revision).toBe(original.revision + 1)
    expect(held.data).toMatchObject({
      status: 'conflict',
      sourceChanged: true,
      sourceVersion: mapped.sourceVersion,
      cohort: mapped.cohort,
      resumeUrl: mapped.resumeUrl,
    })
    expect(fixture.audit).toHaveLength(auditBefore + 2)
    expect(
      fixture.audit
        .filter((entry) => entry.action === 'intake source changed')
        .at(-1),
    ).toMatchObject({
      recordId: original.id,
      actorId: 'staff-owner',
    })
    const heldSnapshot = structuredClone(held)
    expect((await call(preview)).status).toBe(200)
    expect(fixture.records.find((record) => record.id === held.id)).toEqual(
      heldSnapshot,
    )
    expect(fixture.audit).toHaveLength(auditBefore + 2)
    expect(
      (
        await call({
          action: 'intake-review',
          id: held.id,
          revision: original.revision,
          decision: 'exclude',
          reason: 'Stale source review',
        })
      ).status,
    ).toBe(409)
    fixture.records.push(
      row(
        'contact',
        'existing-shared-person',
        { email: mapped.email },
        { access: 'team' },
      ),
    )
    for (const extra of [{}, { personId: 'existing-shared-person' }]) {
      const response = await call({
        action: 'intake-review',
        id: held.id,
        revision: held.revision,
        decision: 'apply',
        reason: 'Changed source must stay held',
        ...extra,
      })
      expect(response.status).toBe(400)
      expect(await response.text()).toMatch(/source.*changed|changed.*source/i)
    }
    const exclusion = await call({
      action: 'intake-review',
      id: held.id,
      revision: held.revision,
      decision: 'exclude',
      reason: 'Exclude changed source until reconciled',
    })
    expect(exclusion.status).toBe(200)
    const batchReceipts = fixture.records.filter(
      (record) => record.kind === 'import',
    )
    expect(batchReceipts).toHaveLength(2)
    for (const receipt of batchReceipts)
      expect(receipt.data).toMatchObject({
        status: 'reviewed',
        counts: {
          excluded: 1,
          failed: 0,
          held: 0,
          reviewReady: 0,
          open: 0,
        },
        blockers: [],
      })
    const excluded = structuredClone(
      fixture.records.find((record) => record.id === held.id)!,
    )
    const excludedAuditCount = fixture.audit.length
    expect(
      (await call({ ...preview, rows: [{ ...mapped, ...delta }] })).status,
    ).toBe(409)
    expect(fixture.records.find((record) => record.id === held.id)).toEqual(
      excluded,
    )
    expect(fixture.audit).toHaveLength(excludedAuditCount + 1)
    expect(fixture.audit.at(-1)).toMatchObject({
      recordId: held.id,
      action: 'intake resolved source changed',
    })
  },
)
it.each(['applied', 'excluded'])(
  'keeps a resolved %s intake receipt immutable when its source changes',
  async (status) => {
    const mapped = {
      ...pending,
      sourceId: 'resolved-row',
      name: 'Synthetic resolved source',
      email: 'resolved@review.invalid',
      sourceVersion: 'version-1',
    }
    const preview = {
      action: 'intake-preview',
      sourceName: 'Synthetic resolved source',
      workflow: 'class',
      rows: [mapped],
    }
    expect((await call(preview)).status).toBe(200)
    // This mock fixture represents a previously resolved receipt; real apply uses
    // the fresh local PostgreSQL harness, never a hosted test-row exception.
    const resolved = fixture.records.find((record) => record.kind === 'intake')!
    resolved.data = {
      ...resolved.data,
      status,
      reviewedBy: 'staff-owner',
      reviewedAt: '2026-10-24T12:00:00Z',
    }
    const receipt = structuredClone(resolved)
    const auditCount = fixture.audit.length
    expect(
      (
        await call({
          ...preview,
          rows: [{ ...mapped, sourceVersion: 'version-2' }],
        })
      ).status,
    ).toBe(409)
    expect(fixture.records.find((record) => record.id === receipt.id)).toEqual(
      receipt,
    )
    expect(fixture.audit).toHaveLength(auditCount + 1)
    expect(fixture.audit.at(-1)).toMatchObject({
      recordId: receipt.id,
      action: 'intake resolved source changed',
    })
  },
)

it('deduplicates restricted resolved-source observations and rejects the batch without creating earlier new rows', async () => {
  const mapped = {
    ...pending,
    sourceId: 'resolved-private-row',
    sourceVersion: 'version-1',
    name: 'Synthetic private applicant',
    email: 'private@review.invalid',
    resumeUrl: 'https://assets.invalid/PRIVATE-RESUME',
    cohort: 'PRIVATE-COHORT',
  }
  const preview = {
    action: 'intake-preview',
    sourceName: 'Synthetic private terminal source',
    workflow: 'program',
    rows: [mapped],
  }
  expect((await call(preview)).status).toBe(200)
  const resolved = fixture.records.find((record) => record.kind === 'intake')!
  resolved.data = {
    ...resolved.data,
    status: 'applied',
    reviewedBy: 'staff-owner',
    reviewedAt: '2026-10-24T12:00:00.000Z',
  }
  const receipt = structuredClone(resolved)
  const auditBefore = fixture.audit.length
  const changedBatch = {
    ...preview,
    rows: [
      {
        ...mapped,
        sourceId: 'earlier-new-row',
        email: 'earlier@review.invalid',
      },
      { ...mapped, sourceVersion: 'version-2' },
    ],
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    expect((await call(changedBatch)).status).toBe(409)
    expect(
      fixture.records.filter((record) => record.kind === 'intake'),
    ).toEqual([receipt])
    expect(
      fixture.records.filter((record) => record.kind === 'import'),
    ).toHaveLength(1)
    expect(fixture.audit).toHaveLength(auditBefore + 1)
  }
  const observation = fixture.audit.at(-1)!
  expect(observation).toMatchObject({
    recordId: receipt.id,
    action: 'intake resolved source changed',
  })
  expect(Object.keys(observation.after as object).sort()).toEqual(
    [
      'incomingFingerprint',
      'incomingSourceVersion',
      'sourceFingerprint',
      'sourceVersion',
    ].sort(),
  )
  expect(JSON.stringify(observation.after)).not.toContain(
    'private@review.invalid',
  )
  expect(JSON.stringify(observation.after)).not.toContain('PRIVATE-RESUME')
  fixture.members = [member('manager')]
  expect((await call({ action: 'audit', id: receipt.id })).status).toBe(403)
  expect((await call(changedBatch)).status).toBe(403)
  for (const suffix of ['', '?export=csv']) {
    const response = await handler(request(undefined, suffix))
    expect(response.status).toBe(200)
    const payload = await response.text()
    expect(payload).not.toContain(receipt.id)
    expect(payload).not.toContain('PRIVATE-RESUME')
    expect(payload).not.toContain('PRIVATE-COHORT')
  }
})

it('does not retain resolved-source observations from a batch containing a malformed later row', async () => {
  const mapped = {
    ...pending,
    sourceId: 'terminal-row',
    sourceVersion: 'version-1',
    name: 'Synthetic terminal source',
    email: 'terminal@review.invalid',
  }
  const preview = {
    action: 'intake-preview',
    sourceName: 'Synthetic atomic terminal source',
    workflow: 'class',
    rows: [mapped],
  }
  expect((await call(preview)).status).toBe(200)
  const resolved = fixture.records.find((record) => record.kind === 'intake')!
  resolved.data.status = 'excluded'
  const before = structuredClone({
    records: fixture.records,
    audit: fixture.audit,
  })
  const response = await call({
    ...preview,
    rows: [
      { ...mapped, sourceVersion: 'version-2' },
      { ...mapped, sourceId: '' },
    ],
  })
  expect(response.status).toBe(400)
  expect(fixture.records).toEqual(before.records)
  expect(fixture.audit).toEqual(before.audit)
})

it('reuses the same source row when a reopened import dialog supplies different operational review defaults', async () => {
  const mapped = {
    ...pending,
    sourceId: 'stable-source-row',
    name: 'Synthetic applicant',
    email: 'applicant@review.invalid',
    sourceVersion: 'source-version-1',
    cohort: 'Synthetic unchanged cohort',
    resumeUrl: 'https://assets.invalid/unchanged-resume',
  }
  const preview = {
    action: 'intake-preview',
    sourceName: 'Synthetic operational-defaults source',
    workflow: 'program',
    rows: [mapped],
  }
  expect((await call(preview)).status).toBe(200)
  const original = structuredClone(
    fixture.records.find((record) => record.kind === 'intake')!,
  )
  expect(original).toBeDefined()
  const originalAuditCount = fixture.audit.length
  const reopened = await call({
    ...preview,
    rows: [
      {
        ...mapped,
        nextAction: 'Review unchanged source after reopening the dialog',
        nextDue: '2027-02-01T16:00:00Z',
      },
    ],
  })
  expect(reopened.status).toBe(200)
  const current = fixture.records.find((record) => record.id === original.id)!
  expect(current).toEqual(original)
  expect(current.data.status).toBe('test')
  expect(current.data).not.toHaveProperty('sourceChanged')
  expect(current.data.nextAction).toBe(pending.nextAction)
  expect(current.data.nextDue).toBe(new Date(pending.nextDue).toISOString())
  expect(fixture.audit).toHaveLength(originalAuditCount)
})
