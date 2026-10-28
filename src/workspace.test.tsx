import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { Workspace } from './workspace'
import { RecordSelector } from './components/record-selector'
import type { RecordEnvelope } from './lib/crm-types'

const identity = vi.hoisted(() => ({
  getUser: vi.fn(),
  handleAuthCallback: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  acceptInvite: vi.fn(),
  requestPasswordRecovery: vi.fn(),
  updateUser: vi.fn(),
}))
vi.mock('@netlify/identity', () => identity)
const fetchMock = vi.fn()
const member = {
  id: 'staff-internal',
  name: 'Pilot staff',
  role: 'owner',
  active: true,
}
const payload = (records: RecordEnvelope[] = []) => ({
  member,
  records: records.map((record) => ({
    ownerId: member.id,
    revision: 1,
    createdAt: '2026-10-24T12:00:00Z',
    updatedAt: '2026-10-24T12:00:00Z',
    ...record,
  })),
  staff: [member],
  settings: [],
})
beforeEach(() => {
  vi.clearAllMocks()
  identity.getUser.mockResolvedValue(null)
  identity.handleAuthCallback.mockResolvedValue(null)
  vi.stubGlobal('fetch', fetchMock)
})
it('requires sign-in without displaying live or zero business totals', async () => {
  render(<Workspace />)
  expect(await screen.findByText('Sign in to your workspace')).toBeVisible()
  expect(screen.queryByText(/Live workspace/)).not.toBeInTheDocument()
  expect(screen.queryByText('00')).not.toBeInTheDocument()
  expect(fetchMock).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'New opportunity' }))
  expect(screen.getByRole('dialog', { name: 'Staff access' })).toBeVisible()
})
it('distinguishes signed-in non-members from an empty workspace', async () => {
  identity.getUser.mockResolvedValue({ id: member.id })
  fetchMock.mockResolvedValue(
    Response.json(
      { error: 'An active staff membership is required' },
      { status: 403 },
    ),
  )
  render(<Workspace />)
  expect(await screen.findByText('Staff access is pending')).toBeVisible()
  expect(screen.queryByText('00')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'New opportunity' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('distinguishes failed loading and allows retry', async () => {
  identity.getUser.mockResolvedValue({ id: member.id })
  fetchMock
    .mockResolvedValueOnce(
      Response.json({ error: 'Service unavailable' }, { status: 503 }),
    )
    .mockResolvedValueOnce(Response.json(payload()))
  render(<Workspace />)
  expect(await screen.findByText('Workspace could not load')).toBeVisible()
  expect(screen.queryByText('00')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retry access' }))
  expect(
    await screen.findByText(/Authorized workspace · no business records yet/),
  ).toBeVisible()
  expect(screen.getAllByText('00').length).toBeGreaterThan(0)
})
it('hides prior totals during authorized refresh, then shows returned records', async () => {
  identity.getUser.mockResolvedValue({ id: member.id })
  fetchMock.mockResolvedValueOnce(Response.json(payload()))
  let resolve!: (r: Response) => void
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((r) => {
        resolve = r
      }),
  )
  render(<Workspace />)
  await screen.findByText(/Authorized workspace · no business records yet/)
  await userEvent.click(
    screen.getByRole('button', { name: 'Refresh workspace' }),
  )
  expect(await screen.findByText('Loading authorized records…')).toBeVisible()
  expect(screen.queryByText('00')).not.toBeInTheDocument()
  resolve(
    Response.json(
      payload([
        {
          id: 'opportunity-internal',
          kind: 'opportunity',
          title: 'PILOT TEST Inquiry',
          ownerId: member.id,
          revision: 1,
          data: { stage: 'S1' },
        },
      ]),
    ),
  )
  expect(await screen.findByText(/Live workspace/)).toBeVisible()
  expect(screen.getAllByText('PILOT TEST Inquiry').length).toBeGreaterThan(0)
})
it('clears records, staff, and totals on sign-out', async () => {
  identity.getUser.mockResolvedValue({ id: member.id })
  fetchMock.mockResolvedValue(Response.json(payload()))
  identity.logout.mockResolvedValue(undefined)
  render(<Workspace />)
  await screen.findByText(/Authorized workspace/)
  await userEvent.click(screen.getByRole('button', { name: /Pilot staff/ }))
  expect(await screen.findByText('Sign in to your workspace')).toBeVisible()
  expect(screen.queryByText('00')).not.toBeInTheDocument()
  expect(identity.logout).toHaveBeenCalledOnce()
})
it.each([
  ['Directory', 'contact', { email: 'private@example.invalid' }],
  ['Workflows', 'application', { workflow: 'sales', stage: 'Screening' }],
  ['Import review', 'intake', { workflow: 'sales', status: 'ready' }],
  [
    'Library',
    'resource',
    { resourceType: 'template', status: 'Draft', audience: 'hr' },
  ],
])(
  'clears the %s view and its private dialog when access refresh fails',
  async (section, kind, data) => {
    identity.getUser.mockResolvedValue({ id: member.id })
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          payload([
            {
              id: 'restricted-foundation-record',
              kind,
              title: 'PILOT TEST protected foundation record',
              ownerId: member.id,
              revision: 1,
              access: 'hr',
              data: {
                ...data,
                notes: 'PILOT TEST restricted foundation detail',
              },
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ error: 'Access unavailable' }, { status: 403 }),
      )
    render(<Workspace />)
    await screen.findByText(/Live workspace/)
    await userEvent.click(screen.getByRole('button', { name: section }))
    await userEvent.click(
      screen.getByRole('button', {
        name: 'PILOT TEST protected foundation record',
      }),
    )
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(
      screen.getByText('PILOT TEST restricted foundation detail'),
    ).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'Refresh workspace' }),
    )
    expect(await screen.findByText('Staff access is pending')).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.queryByText('PILOT TEST restricted foundation detail'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('PILOT TEST protected foundation record'),
    ).not.toBeInTheDocument()
  },
)
it.each([
  [401, 'Sign in to your workspace'],
  [403, 'Staff access is pending'],
  [503, 'Workspace could not load'],
])(
  'clears an open record when a refresh fails with %s',
  async (status, message) => {
    identity.getUser.mockResolvedValue({ id: member.id })
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          payload([
            {
              id: 'private-inquiry',
              kind: 'opportunity',
              title: 'PILOT TEST private inquiry',
              ownerId: member.id,
              revision: 1,
              data: {
                stage: 'S1',
                privateNotes: 'PILOT TEST confidential detail',
              },
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ error: 'PILOT TEST access unavailable' }, { status }),
      )
    render(<Workspace />)
    await screen.findByText(/Live workspace/)
    await userEvent.click(
      screen.getByRole('button', { name: 'PILOT TEST private inquiry' }),
    )
    expect(screen.getByText('PILOT TEST confidential detail')).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'Refresh workspace' }),
    )
    expect(await screen.findByText(message)).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.queryByText('PILOT TEST confidential detail'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('PILOT TEST private inquiry'),
    ).not.toBeInTheDocument()
  },
)
it('wires invitation acceptance to the SDK', async () => {
  identity.handleAuthCallback.mockResolvedValue({
    type: 'invite',
    token: 'synthetic-test-only',
  })
  render(<Workspace />)
  await screen.findByRole('heading', { name: 'Welcome to the team.' })
  await userEvent.type(
    screen.getByLabelText('New password'),
    'synthetic-password-only',
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Set password & continue' }),
  )
  await waitFor(() =>
    expect(identity.acceptInvite).toHaveBeenCalledWith(
      'synthetic-test-only',
      'synthetic-password-only',
    ),
  )
})
it('wires recovery callback to password update', async () => {
  identity.handleAuthCallback.mockResolvedValue({
    type: 'recovery',
    user: { id: member.id },
  })
  render(<Workspace />)
  await screen.findByRole('heading', { name: 'Set a new password.' })
  await userEvent.type(
    screen.getByLabelText('New password'),
    'synthetic-password-only',
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Set password & continue' }),
  )
  await waitFor(() =>
    expect(identity.updateUser).toHaveBeenCalledWith({
      password: 'synthetic-password-only',
    }),
  )
})
it('wires login and recovery requests to the SDK', async () => {
  render(<Workspace />)
  await screen.findByText('Sign in to your workspace')
  await userEvent.click(screen.getByRole('button', { name: 'Staff sign in' }))
  await userEvent.type(
    screen.getByLabelText('Email address'),
    'pilot@example.invalid',
  )
  await userEvent.type(
    screen.getByLabelText('Password'),
    'synthetic-password-only',
  )
  await userEvent.click(screen.getByRole('button', { name: /^Sign in$/ }))
  await waitFor(() =>
    expect(identity.login).toHaveBeenCalledWith(
      'pilot@example.invalid',
      'synthetic-password-only',
    ),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Staff sign in' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Forgot your password?' }),
  )
  await userEvent.type(
    screen.getByLabelText('Email address'),
    'pilot@example.invalid',
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Send recovery link' }),
  )
  await waitFor(() =>
    expect(identity.requestPasswordRecovery).toHaveBeenCalledWith(
      'pilot@example.invalid',
    ),
  )
})
it('searches permitted options by context and submits internal IDs', async () => {
  const change = vi.fn()
  render(
    <RecordSelector
      label="Proposal version"
      value=""
      onChange={change}
      options={[
        { id: 'internal-a', label: 'PILOT TEST Studio · version 1' },
        { id: 'internal-b', label: 'PILOT TEST Studio · version 2' },
      ]}
    />,
  )
  await userEvent.type(screen.getByRole('searchbox'), 'version 2')
  expect(
    screen.queryByRole('option', { name: /version 1/ }),
  ).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByRole('combobox'), 'internal-b')
  expect(change).toHaveBeenCalledWith('internal-b')
  expect(screen.queryByText('internal-b')).not.toBeInTheDocument()
})
it('creates an inquiry using named organization, contact and staff selectors', async () => {
  identity.getUser.mockResolvedValue({ id: member.id })
  const staff = {
    id: 'limited-internal',
    name: 'PILOT TEST Contributor',
    role: 'contributor',
    active: true,
  }
  const organization = {
    id: 'org-internal',
    kind: 'organization',
    title: 'PILOT TEST Studio',
    data: { website: 'https://pilot.invalid' },
  }
  const contact = {
    id: 'contact-internal',
    kind: 'contact',
    title: 'PILOT TEST Contact',
    organizationId: organization.id,
    data: { email: 'pilot@example.invalid' },
  }
  fetchMock.mockImplementation(async (_url, init) =>
    init?.method === 'POST'
      ? Response.json({ ok: true })
      : Response.json({
          ...payload([organization, contact]),
          staff: [member, staff],
        }),
  )
  render(<Workspace />)
  await screen.findByText(/Live workspace/)
  await userEvent.click(screen.getByRole('button', { name: 'New opportunity' }))
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Record title / organization name' }),
    'PILOT TEST Inquiry',
  )
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: /^Organization$/ }),
    organization.id,
  )
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: /^Contact$/ }),
    contact.id,
  )
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Accountable owner' }),
    staff.id,
  )
  expect(screen.queryByText('contact-internal')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Save record' }))
  await waitFor(() => {
    const write = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'POST',
    )
    expect(write).toBeDefined()
    expect(JSON.parse(write![1].body).record).toMatchObject({
      ownerId: staff.id,
      organizationId: organization.id,
      data: { contactId: contact.id },
    })
  })
})

async function prepareResearchImport() {
  await userEvent.click(screen.getByRole('button', { name: 'Research' }))
  await userEvent.click(screen.getByRole('button', { name: 'Import CSV' }))
  await userEvent.type(
    screen.getByRole('textbox', { name: /Stable source name/ }),
    'pilot-retry',
  )
  const fields = [
    'sourceId',
    'organization',
    'sourceUrl',
    'location',
    'service',
    'fitRationale',
    'contactRoute',
    'sourceCategory',
    'sourcedBy',
    'nextAction',
    'nextDue',
  ]
  const values = [
    'row-1',
    'PILOT TEST retry studio',
    'https://pilot-retry.invalid',
    'New York',
    'Operations Setup',
    'PILOT TEST fit',
    'Contact form',
    'Company research list',
    '',
    'Review research',
    '2030-01-01T12:00:00Z',
  ]
  await userEvent.upload(
    screen.getByLabelText('Research CSV'),
    new File([`${fields.join(',')}\n${values.join(',')}`], 'pilot.csv', {
      type: 'text/csv',
    }),
  )
  for (const [index, field] of fields.entries())
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: field }),
      String(index),
    )
}

it('retries a partial research import using its persisted organization', async () => {
  identity.getUser.mockResolvedValue({ id: member.id })
  const records: RecordEnvelope[] = []
  let organizationWrites = 0
  let researchWrites = 0
  fetchMock.mockImplementation(async (_url, init) => {
    if (init?.method !== 'POST') return Response.json(payload([...records]))
    const body = JSON.parse(init.body)
    if (body.action === 'import-summary') return Response.json({ ok: true })
    if (body.record.kind === 'organization') {
      organizationWrites++
      const organization = payload([
        { ...body.record, id: 'persisted-import-org' },
      ]).records[0]
      records.push(organization)
      return Response.json({ record: organization })
    }
    researchWrites++
    if (researchWrites === 1)
      return Response.json(
        { error: 'PILOT TEST research temporarily unavailable' },
        { status: 503 },
      )
    const research = payload([{ ...body.record, id: 'retried-research' }])
      .records[0]
    records.push(research)
    return Response.json({ record: research })
  })
  render(<Workspace />)
  await screen.findByText(/Authorized workspace/)
  await prepareResearchImport()
  await userEvent.click(
    screen.getByRole('button', { name: 'Import accepted rows' }),
  )
  await screen.findByText(
    /Row 2: failed — PILOT TEST research temporarily unavailable/,
  )
  const retry = await screen.findByRole('button', {
    name: 'Import accepted rows',
  })
  await waitFor(() => expect(retry).toBeEnabled())
  expect(organizationWrites).toBe(1)
  expect(researchWrites).toBe(1)
  await userEvent.click(retry)
  await screen.findByText('Row 2: imported')
  expect(organizationWrites).toBe(1)
  expect(researchWrites).toBe(2)
  expect(records.find((r) => r.kind === 'research')).toMatchObject({
    organizationId: 'persisted-import-org',
    sourceKey: 'pilot-retry:row-1',
  })
})

it('still holds an import matching an unrelated organization domain as a duplicate', async () => {
  identity.getUser.mockResolvedValue({ id: member.id })
  fetchMock.mockResolvedValue(
    Response.json(
      payload([
        {
          id: 'unrelated-org',
          kind: 'organization',
          title: 'PILOT TEST existing studio',
          sourceKey: 'another-source:another-row:org',
          data: { website: 'https://pilot-retry.invalid' },
        },
      ]),
    ),
  )
  render(<Workspace />)
  await screen.findByText(/Live workspace/)
  await prepareResearchImport()
  expect(
    screen.getByRole('button', { name: 'Import accepted rows' }),
  ).toBeDisabled()
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(0)
})

it.each(['resolve', 'reject'])(
  'ignores a stale refresh %s after sign-out',
  async (outcome) => {
    identity.getUser.mockResolvedValue({ id: member.id })
    identity.logout.mockResolvedValue(undefined)
    fetchMock.mockResolvedValueOnce(Response.json(payload()))
    let resolve!: (r: Response) => void
    let reject!: (e: Error) => void
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((yes, no) => {
          resolve = yes
          reject = no
        }),
    )
    render(<Workspace />)
    await screen.findByText(/Authorized workspace/)
    await userEvent.click(
      screen.getByRole('button', { name: 'Refresh workspace' }),
    )
    await screen.findByText('Loading authorized records…')
    await userEvent.click(screen.getByRole('button', { name: /Pilot staff/ }))
    await screen.findByText('Sign in to your workspace')
    await act(async () => {
      if (outcome === 'resolve')
        resolve(
          Response.json(
            payload([
              {
                id: 'stale-record',
                kind: 'opportunity',
                title: 'PILOT TEST stale response',
                data: { stage: 'S1' },
              },
            ]),
          ),
        )
      else reject(new Error('PILOT TEST stale failure'))
    })
    expect(screen.getByText('Sign in to your workspace')).toBeVisible()
    expect(
      screen.queryByText('PILOT TEST stale response'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('PILOT TEST stale failure'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('00')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Pilot staff/ }),
    ).not.toBeInTheDocument()
  },
)

it('closes the navigation drawer with Escape and restores keyboard focus to its toggle', async () => {
  render(<Workspace />)
  await screen.findByText('Sign in to your workspace')
  const toggle = screen.getByRole('button', { name: 'Toggle navigation' })
  expect(toggle).toHaveAttribute('aria-controls', 'workspace-navigation')
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await userEvent.tab()
  expect(toggle).not.toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(toggle).toHaveFocus()
})

it('rejects a malformed workspace snapshot without showing its protected records', async () => {
  identity.getUser.mockResolvedValue({ id: member.id })
  fetchMock.mockResolvedValue(
    Response.json({
      ...payload(),
      records: [
        {
          id: 'malformed-record',
          kind: 'contact',
          title: 'PILOT TEST malformed protected record',
          data: { notes: 'PILOT TEST malformed private detail' },
        },
      ],
    }),
  )
  render(<Workspace />)
  expect(await screen.findByText('Workspace could not load')).toBeVisible()
  expect(
    screen.queryByText('PILOT TEST malformed protected record'),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText('PILOT TEST malformed private detail'),
  ).not.toBeInTheDocument()
  expect(screen.queryByText('00')).not.toBeInTheDocument()
})
