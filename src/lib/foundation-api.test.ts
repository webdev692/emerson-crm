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
  expect((await call(preview)).status).toBe(200)
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
        ...pending,
      },
      { sourceKey: 'stable-key' },
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
  expect(fixture.records).toHaveLength(2)
  expect((await call({ ...decision, personId: 'person' })).status).toBe(200)
  expect(fixture.records.filter((r) => r.kind === 'contact')).toHaveLength(1)
  expect(
    fixture.records.find((r) => r.kind === 'engagement')?.data,
  ).toMatchObject({
    personId: 'person',
    suppressed: true,
    contactPermission: 'Do not contact',
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
    program: 'Synthetic program',
    cohort: 'Synthetic cohort',
    resumeUrl: 'https://assets.invalid/restricted-resume',
    onboardingStatus: 'Awaiting verification',
    sourceVersion: 'revision-2',
    sourceRow: 'original-row-7',
    sourceUrl: 'https://forms.invalid/restricted-source',
  }
  const mapped = {
    ...pending,
    ...details,
    sourceId: 'restricted-detail-1',
    name: 'Synthetic applicant',
    email: 'applicant@review.invalid',
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
  expect(queue.data).toMatchObject({ ...details, status: 'test' })
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
    expect(fixture.audit).toHaveLength(auditBefore + 1)
    expect(fixture.audit.at(-1)).toMatchObject({
      recordId: original.id,
      actorId: 'staff-owner',
    })
    const heldSnapshot = structuredClone(held)
    expect((await call(preview)).status).toBe(200)
    expect(fixture.records.find((record) => record.id === held.id)).toEqual(
      heldSnapshot,
    )
    expect(fixture.audit).toHaveLength(auditBefore + 1)
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
    expect(
      (
        await call({
          action: 'intake-review',
          id: held.id,
          revision: held.revision,
          decision: 'exclude',
          reason: 'Exclude changed source until reconciled',
        })
      ).status,
    ).toBe(200)
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
    expect(fixture.records).toEqual([receipt])
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
