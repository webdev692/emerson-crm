// @vitest-environment node
// Isolated guard tests: no Identity, Postgres, or deployed requests are made.
import { beforeEach, expect, it, vi } from 'vitest'
import type { RecordData, RecordEnvelope } from './crm-types'
type MockRow = Record<string, unknown>
type TableName = 'members' | 'records' | 'settings' | 'audit'
type MockTable = { table: TableName }
type Predicate = (row: MockRow) => boolean
interface FixtureIdentity {
  id: string
  name?: string
  invitedAt?: string
  confirmedAt?: string
  appMetadata?: { roles: string[] }
}
interface FixtureRecord extends MockRow, RecordEnvelope {
  id: string
  revision: number
}
interface FixtureMember extends MockRow {
  id: string
  email: string
  name: string
  role: string
  active: boolean
  commercial: boolean
}
interface MockQuery extends PromiseLike<MockRow[]> {
  where(predicate: Predicate): MockQuery
  for(): MockQuery
}
interface MockDatabase {
  select(): { from(table: MockTable): MockQuery }
  transaction<T>(work: (database: MockDatabase) => Promise<T>): Promise<T>
  execute(): Promise<void>
  insert(table: MockTable): {
    values(value: MockRow): {
      onConflictDoNothing(): Promise<void>
      returning(): Promise<MockRow[]>
    }
  }
}

const fixture = vi.hoisted(() => ({
  user: null as FixtureIdentity | null,
  members: [] as FixtureMember[],
  records: [] as FixtureRecord[],
  settings: [] as MockRow[],
  database: vi.fn(),
  verified: null as FixtureIdentity | null,
  identityLookup: vi.fn(),
  bootstrapWrite: vi.fn(),
  insertWrite: vi.fn(),
}))
vi.mock('@netlify/identity', () => ({
  getUser: async () => fixture.user,
  admin: { getUser: (...args: unknown[]) => fixture.identityLookup(...args) },
}))
vi.mock('../../db/schema', () => ({
  members: { table: 'members', id: 'id' },
  records: { table: 'records', id: 'id' },
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
const actor = (role = 'owner', active = true) => ({
  id: 'pilot-owner',
  email: 'pilot@example.invalid',
  name: 'PILOT TEST staff',
  role,
  active,
  commercial: false,
})
const record = (
  kind = 'opportunity',
  data: RecordData = {},
): FixtureRecord => ({
  id: 'pilot-record',
  kind,
  title: 'PILOT TEST Inquiry',
  ownerId: 'pilot-owner',
  organizationId: null,
  parentId: null,
  revision: 1,
  data: { stage: 'S1', ...data },
  createdAt: new Date(),
  updatedAt: new Date(),
})
function database(): MockDatabase {
  const tableRows = (table: MockTable): MockRow[] =>
    table.table === 'audit' ? [] : fixture[table.table]
  const db: MockDatabase = {
    select: () => ({
      from: (table: MockTable) => {
        let rows = tableRows(table)
        const query: MockQuery = {
          where: (predicate) => {
            rows = rows.filter(predicate)
            return query
          },
          for: () => query,
          then: (resolve, reject) =>
            Promise.resolve(rows).then(resolve, reject),
        }
        return query
      },
    }),
    transaction: async (work) => work(db),
    execute: async () => {},
    insert: (table: MockTable) => ({
      values: (value) => {
        fixture.insertWrite(table.table, value)
        return {
          onConflictDoNothing: async () => {
            fixture.bootstrapWrite(table.table, value)
            if (table.table !== 'members') throw new Error('Unexpected table')
            if (!fixture.members.some((m) => m.id === value.id))
              tableRows(table).push({ active: true, ...value })
          },
          returning: async () => {
            const saved = { id: 'new-record', revision: 1, ...value }
            if (table.table === 'records') tableRows(table).push(saved)
            return [saved]
          },
        }
      },
    }),
  }
  return db
}
const request = (body?: unknown, suffix = '') =>
  new Request(
    `https://pilot.invalid/api/crm${suffix}`,
    body
      ? {
          method: 'POST',
          headers: {
            origin: 'https://pilot.invalid',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      : undefined,
  )
const save = (r: RecordEnvelope) =>
  handler(request({ action: 'save', record: r }))
beforeEach(() => {
  vi.clearAllMocks()
  fixture.user = { id: 'pilot-owner' }
  fixture.members = [actor()]
  fixture.records = []
  fixture.settings = []
  fixture.verified = null
  fixture.identityLookup.mockImplementation(async () => fixture.verified)
  fixture.database.mockImplementation(database)
  vi.stubGlobal('Netlify', { env: { get: () => undefined } })
})
it('rejects signed-out GET, POST and export before database access', async () => {
  fixture.user = null
  for (const req of [
    request(),
    request({ action: 'save' }),
    request(undefined, '?export=csv'),
  ])
    expect((await handler(req)).status).toBe(401)
  expect(fixture.database).not.toHaveBeenCalled()
})
it.each(['missing', 'inactive'])('rejects %s membership', async (state) => {
  fixture.members = state === 'missing' ? [] : [actor('owner', false)]
  fixture.records = [record()]
  const response = await handler(request())
  expect(response.status).toBe(403)
  expect(await response.text()).not.toContain('PILOT TEST Inquiry')
})
it('does not bootstrap an arbitrary Identity admin without the configured UUID', async () => {
  fixture.user = { id: 'unconfigured-admin', appMetadata: { roles: ['admin'] } }
  fixture.members = []
  expect((await handler(request())).status).toBe(403)
})
it('bootstraps only the verified configured owner without requiring Identity roles', async () => {
  fixture.members = []
  fixture.verified = {
    id: 'pilot-owner',
    name: 'PILOT TEST verified owner',
    invitedAt: '2026-10-18',
    confirmedAt: '2026-10-19',
  }
  vi.stubGlobal('Netlify', { env: { get: () => 'pilot-owner' } })
  const response = await handler(request())
  expect(response.status).toBe(200)
  const data = await response.json()
  expect(data.member).toMatchObject({
    id: 'pilot-owner',
    role: 'owner',
    active: true,
    commercial: true,
  })
  expect(data.staff).toContainEqual(data.member)
  expect(fixture.identityLookup).toHaveBeenCalledWith('pilot-owner')
  expect(fixture.bootstrapWrite).toHaveBeenCalledOnce()
  expect((await handler(request())).status).toBe(200)
  expect(fixture.bootstrapWrite).toHaveBeenCalledOnce()
})
it.each([
  { id: 'other-user', invitedAt: '2026-10-18', confirmedAt: '2026-10-19' },
  { id: 'pilot-owner', confirmedAt: '2026-10-19' },
  { id: 'pilot-owner', invitedAt: '2026-10-18' },
])(
  'rejects mismatched, uninvited or unconfirmed owner lookup: %j',
  async (verified) => {
    fixture.members = []
    fixture.verified = verified
    vi.stubGlobal('Netlify', { env: { get: () => 'pilot-owner' } })
    const response = await handler(request())
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('accept an invitation')
    expect(fixture.bootstrapWrite).not.toHaveBeenCalled()
    expect(fixture.members).toEqual([])
  },
)
it('preserves an inactive configured owner without attempting bootstrap', async () => {
  fixture.members = [actor('owner', false)]
  const original = structuredClone(fixture.members)
  fixture.verified = {
    id: 'pilot-owner',
    invitedAt: '2026-10-18',
    confirmedAt: '2026-10-19',
  }
  vi.stubGlobal('Netlify', { env: { get: () => 'pilot-owner' } })
  for (const req of [
    request(),
    request({ action: 'staff' }),
    request(undefined, '?export=csv'),
  ])
    expect((await handler(req)).status).toBe(403)
  expect(fixture.members).toEqual(original)
  expect(fixture.identityLookup).not.toHaveBeenCalled()
  expect(fixture.bootstrapWrite).not.toHaveBeenCalled()
})
it('does not allow contributors to manage staff or approve assigned commercial records', async () => {
  fixture.members = [actor('contributor')]
  fixture.records = [record('proposal')]
  for (const body of [
    { action: 'staff' },
    {
      action: 'decide',
      id: 'pilot-record',
      revision: 1,
      decision: 'approved',
      reason: 'PILOT TEST',
    },
  ])
    expect((await handler(request(body))).status).toBe(403)
})
it('blocks viewer writes and edits to unreadable records', async () => {
  fixture.members = [actor('viewer')]
  expect(
    (await save({ kind: 'organization', title: 'PILOT TEST', data: {} }))
      .status,
  ).toBe(403)
  fixture.members = [actor('contributor')]
  fixture.records = [{ ...record(), ownerId: 'other-staff' }]
  expect((await save(record())).status).toBe(403)
})
it('rejects stale revisions with a visible conflict', async () => {
  fixture.records = [record()]
  const response = await save({ ...record(), revision: 0 })
  expect(response.status).toBe(409)
  expect(await response.text()).toContain('Refresh and review')
})
it('rejects editing an immutable approved proposal version', async () => {
  fixture.records = [record('proposal')]
  const response = await save(record('proposal'))
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('immutable')
})
function deliveryFixture(workorderProposal?: string) {
  const opportunity = record('opportunity', {
    stage: 'S8',
    proposalId: 'proposal-current',
    capacityStatus: 'Confirmed',
    writtenAcceptance: 'https://pilot.invalid/acceptance',
    capacityEvidence: 'https://pilot.invalid/capacity',
    deliveryLead: 'pilot-owner',
  })
  fixture.records = [opportunity]
  for (const version of ['old', 'current']) {
    const proposal = {
      ...record('proposal', {
        scope: `PILOT TEST ${version} scope`,
        validUntil: '2099-12-31',
      }),
      id: `proposal-${version}`,
      parentId: opportunity.id,
    }
    fixture.records.push(proposal, {
      ...record('approval', { decision: 'approved', targetRevision: 1 }),
      id: `approval-${version}`,
      parentId: proposal.id,
    })
  }
  if (workorderProposal)
    fixture.records.push({
      ...record('workorder', { proposalId: workorderProposal }),
      id: 'pilot-workorder',
      parentId: opportunity.id,
    })
}
const deliveryRecord = (kind: string, proposalId = 'proposal-current') => ({
  kind,
  title: `PILOT TEST ${kind}`,
  parentId: 'pilot-record',
  data: {
    proposalId,
    deliveryLead: 'pilot-owner',
    reference: 'PILOT TEST WO',
    scope: 'PILOT TEST current scope',
    agreedDates: 'PILOT TEST agreed dates',
    documents: 'https://pilot.invalid/documents',
    outstandingInformation: 'PILOT TEST none',
  },
})
it.each(['workorder', 'handoff'])(
  'rejects a %s for an older approved proposal before writing',
  async (kind) => {
    deliveryFixture(kind === 'handoff' ? 'proposal-current' : undefined)
    const response = await save(deliveryRecord(kind, 'proposal-old'))
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('current proposal version')
    expect(fixture.insertWrite).not.toHaveBeenCalled()
  },
)
it('requires a work order for the handoff proposal before writing acceptance', async () => {
  deliveryFixture('proposal-old')
  const response = await save(deliveryRecord('handoff'))
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('Work order')
  expect(fixture.insertWrite).not.toHaveBeenCalled()
})
it.each([
  { kind: 'workorder', stage: 'S7', role: 'owner' },
  { kind: 'handoff', stage: 'S8', role: 'owner' },
  { kind: 'handoff', stage: 'S8', role: 'delivery' },
])(
  'creates a $kind at $stage as the assigned $role using the current proposal',
  async ({ kind, stage, role }) => {
    deliveryFixture(kind === 'handoff' ? 'proposal-current' : undefined)
    const currentActor = {
      ...actor(role),
      id: role === 'delivery' ? 'pilot-delivery' : 'pilot-owner',
    }
    fixture.user = { id: currentActor.id }
    fixture.members =
      role === 'delivery' ? [actor(), currentActor] : [currentActor]
    const opportunity = fixture.records.find((r) => r.id === 'pilot-record')!
    expect(opportunity).toBeDefined()
    opportunity.data.stage = stage
    opportunity.data.deliveryLead = currentActor.id
    const input = deliveryRecord(kind)
    input.data.deliveryLead = currentActor.id
    const response = await save(input)
    expect(response.status).toBe(200)
    const { record: saved } = await response.json()
    expect(saved.data).toMatchObject({
      proposalId: 'proposal-current',
      commercialSnapshot: { scope: 'PILOT TEST current scope' },
    })
    if (kind === 'handoff') {
      expect(saved.data.acceptedBy).toBe(currentActor.id)
      expect(saved.data.acceptedAt).toEqual(expect.any(String))
    }
    if (role === 'delivery')
      expect(opportunity.ownerId).not.toBe(currentActor.id)
    expect(fixture.insertWrite).toHaveBeenCalledWith(
      'records',
      expect.objectContaining({ kind }),
    )
  },
)
it('rejects direct S9 creation and cumulative S7 bypass even at unchanged stage', async () => {
  const org = { ...record('organization'), id: 'pilot-org' }
  const inquiry = {
    ...record(),
    organizationId: org.id,
    data: {
      stage: 'S1',
      sourceCategory: 'General inbound',
      nextAction: 'PILOT TEST',
      nextDue: '2026-10-23T12:00:00Z',
    },
  }
  fixture.records = [org]
  let response = await save({
    ...inquiry,
    id: undefined,
    data: { ...inquiry.data, stage: 'S9' },
  })
  expect(await response.text()).toContain('New opportunities start at S1')
  for (const stage of ['S1', 'S7']) {
    fixture.records = [org, { ...inquiry, data: { ...inquiry.data, stage } }]
    response = await save({
      ...inquiry,
      data: {
        ...inquiry.data,
        stage: 'S7',
        stageReason: 'PILOT TEST',
        stageEvidence: 'https://pilot.invalid/evidence',
      },
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('acknowledgment')
  }
})
it('rejects a forged inaccessible contact selector value', async () => {
  fixture.members = [actor('contributor')]
  fixture.records = [
    { ...record('contact'), id: 'private-contact', ownerId: 'other-staff' },
  ]
  const response = await save({
    kind: 'opportunity',
    title: 'PILOT TEST',
    data: { contactId: 'private-contact' },
  })
  expect(response.status).toBe(403)
  expect(await response.text()).toContain('access denied')
})
it('blocks outbound logging when normalized suppression matches', async () => {
  fixture.records = [
    record('opportunity', {
      email: 'PILOT@example.invalid',
      contactPermission: 'Consented',
    }),
    {
      ...record('suppression', { identity: 'pilot@example.invalid' }),
      id: 'suppression',
    },
  ]
  const response = await save({
    kind: 'activity',
    title: 'PILOT TEST',
    parentId: 'pilot-record',
    data: {
      activityType: 'Contact',
      occurredAt: '2026-10-18T12:00:00Z',
      notes: 'PILOT TEST manual activity',
    },
  })
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('No-contact restriction')
})
it('filters GET and CSV records while preserving stable IDs, links and formula safety', async () => {
  fixture.members = [actor('viewer')]
  fixture.records = [
    record('organization'),
    {
      ...record('activity'),
      id: 'child-record',
      title: '=PILOT()',
      ownerId: 'other-staff',
      parentId: 'pilot-record',
    },
    {
      ...record(),
      id: 'private-record',
      title: 'Restricted opportunity',
      ownerId: 'other-staff',
    },
  ]
  const json = await (await handler(request())).json()
  expect(json.records.map((r: FixtureRecord) => r.id)).toEqual([
    'pilot-record',
    'child-record',
  ])
  const csv = await (await handler(request(undefined, '?export=csv'))).text()
  expect(csv).toContain('child-record')
  expect(csv).toContain('pilot-record')
  expect(csv).toContain("'=PILOT()")
  expect(csv).not.toContain('private-record')
  expect(json.staff[0]).not.toHaveProperty('email')
})
