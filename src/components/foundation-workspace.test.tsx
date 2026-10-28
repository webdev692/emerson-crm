import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import {
  FoundationWorkspace,
  mappedDueDate,
  parseIntakeCSV,
  type FoundationRecord,
} from './foundation-workspace'

const member = {
  id: 'owner-1',
  name: 'Review owner',
  role: 'owner',
  active: true,
}
const person = {
  id: 'person-1',
  kind: 'contact',
  title: 'PILOT TEST Person',
  ownerId: member.id,
  revision: 1,
  data: {
    email: 'person@example.invalid',
    contactPermission: 'Unknown',
    nextAction: 'Review source',
    nextDue: '2026-11-01T12:00:00Z',
  },
}
const org = {
  id: 'org-1',
  kind: 'organization',
  title: 'PILOT TEST College',
  ownerId: member.id,
  revision: 1,
  data: { website: 'https://college.example.invalid' },
}
function setup(
  section: 'Directory' | 'Workflows' | 'Library' | 'Import review',
  records: FoundationRecord[] = [],
  actor = member,
) {
  const api = vi.fn().mockResolvedValue({ record: {} })
  const reload = vi.fn().mockResolvedValue(undefined)
  const result = render(
    <FoundationWorkspace
      section={section}
      records={records}
      member={actor}
      staff={[member]}
      api={api}
      reload={reload}
    />,
  )
  return { ...result, api, reload }
}

it('keeps one person with multiple organization affiliations', async () => {
  setup('Directory', [
    person,
    org,
    { ...org, id: 'org-2', title: 'PILOT TEST Company' },
    {
      ...person,
      id: 'aff-1',
      kind: 'affiliation',
      title: 'College contact',
      organizationId: org.id,
      data: { personId: person.id, relationship: 'College contact' },
    },
    {
      ...person,
      id: 'aff-2',
      kind: 'affiliation',
      title: 'Customer',
      organizationId: 'org-2',
      data: { personId: person.id, relationship: 'Customer' },
    },
  ])
  await userEvent.click(screen.getByRole('button', { name: /^People$/ }))
  expect(screen.getAllByRole('button', { name: person.title })).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: /^Affiliations$/ }))
  expect(screen.getByRole('button', { name: 'College contact' })).toBeVisible()
  expect(screen.getByRole('button', { name: /^Customer$/ })).toBeVisible()
  expect(
    screen.getByText(/PILOT TEST Person → PILOT TEST College/),
  ).toBeVisible()
})

it('preserves assigned-reader visibility when editing a legacy contact', async () => {
  const { api } = setup('Directory', [person])
  expect(screen.getByText('Assigned / readers')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: person.title }))
  await userEvent.click(screen.getByRole('button', { name: 'Edit record' }))
  const dialog = screen.getByRole('dialog', { name: 'Edit person' })
  expect(within(dialog).getByLabelText('Visibility')).toHaveValue('record')
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Save record' }),
  )
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'foundation-save',
        record: expect.objectContaining({
          id: person.id,
          revision: person.revision,
          access: 'record',
        }),
      }),
    ),
  )
})

it('uses the selected workflow stage vocabulary and submits a linked record', async () => {
  const { api, reload } = setup('Workflows', [person, org])
  await userEvent.click(
    screen.getByRole('button', { name: 'Add relationship' }),
  )
  const dialog = screen.getByRole('dialog', { name: 'Add relationship' })
  await userEvent.type(
    within(dialog).getByLabelText('Title *'),
    'PILOT TEST Partnership',
  )
  await userEvent.selectOptions(
    within(dialog).getByLabelText('Person'),
    person.id,
  )
  await userEvent.selectOptions(
    within(dialog).getByLabelText('Workflow *'),
    'college',
  )
  expect(
    within(dialog).getByRole('option', { name: 'Agreement review' }),
  ).toBeInTheDocument()
  expect(
    within(dialog).queryByRole('option', { name: 'Registered' }),
  ).not.toBeInTheDocument()
  await userEvent.selectOptions(
    within(dialog).getByLabelText('Stage *'),
    'Discussion',
  )
  await userEvent.type(
    within(dialog).getByLabelText('Next action *'),
    'Review institution reply',
  )
  fireEvent.change(within(dialog).getByLabelText('Next action due *'), {
    target: { value: '2026-11-01T09:00' },
  })
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Save record' }),
  )
  await waitFor(() => expect(reload).toHaveBeenCalledOnce())
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'foundation-save',
      record: expect.objectContaining({
        kind: 'engagement',
        data: expect.objectContaining({
          personId: person.id,
          workflow: 'college',
          stage: 'Discussion',
        }),
      }),
    }),
  )
})

it('does not expose applicant actions to a non-HR contributor', () => {
  setup(
    'Workflows',
    [
      {
        ...person,
        id: 'application-1',
        kind: 'application',
        title: 'PRIVATE applicant',
        data: { workflow: 'sales', stage: 'Applied' },
      },
    ],
    { ...member, role: 'contributor' },
  )
  expect(
    screen.queryByRole('button', { name: 'Add application' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByText('PRIVATE applicant')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Sales applicants' }),
  ).not.toBeInTheDocument()
})

it('creates a new draft when editing an approved resource and preserves the approved version', async () => {
  const resource = {
    ...person,
    id: 'resource-1',
    kind: 'resource',
    title: 'PILOT TEST Outreach',
    data: {
      resourceType: 'template',
      status: 'Approved',
      audience: 'team',
      body: 'Approved text',
      familyId: 'family-1',
      version: 2,
      approvedBy: member.id,
      approvedAt: '2026-10-24T12:00:00Z',
    },
  }
  const { api } = setup('Library', [resource])
  await userEvent.click(screen.getByRole('button', { name: 'View resource' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Create next version' }),
  )
  const dialog = screen.getByRole('dialog', {
    name: 'Create next resource version',
  })
  expect(within(dialog).getByLabelText('Status *')).toHaveValue('Draft')
  await userEvent.type(
    within(dialog).getByLabelText('Review next action *'),
    'Review updated wording',
  )
  fireEvent.change(within(dialog).getByLabelText('Review due *'), {
    target: { value: '2026-11-01T09:00' },
  })
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Save new draft version' }),
  )
  await waitFor(() => expect(api).toHaveBeenCalledOnce())
  const sent = api.mock.calls[0][0].record
  expect(sent.id).toBeUndefined()
  expect(sent.revision).toBeUndefined()
  expect(sent.data).toMatchObject({
    familyId: 'family-1',
    version: 3,
    status: 'Draft',
  })
  expect(sent.data.approvedBy).toBeUndefined()
  expect(resource.data.status).toBe('Approved')
})

it('allows only explicit queue decisions and blocks applying a conflict', async () => {
  const { api } = setup('Import review', [
    {
      ...person,
      id: 'intake-1',
      kind: 'intake',
      revision: 7,
      title: 'PILOT TEST Source row',
      data: {
        status: 'conflict',
        sourceName: 'Pilot Form version 1',
        sourceId: 'source-row-1',
        workflow: 'class',
        reason: 'Conflicting email',
      },
    },
  ])
  expect(api).not.toHaveBeenCalled()
  await userEvent.click(
    screen.getByRole('button', { name: 'PILOT TEST Source row' }),
  )
  const dialog = screen.getByRole('dialog', { name: 'Review source row' })
  expect(
    within(dialog).getByRole('button', { name: 'Apply reviewed row' }),
  ).toBeDisabled()
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Exclude row' }),
  )
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Add a review reason',
  )
  expect(api).not.toHaveBeenCalled()
  await userEvent.type(
    within(dialog).getByLabelText('Review reason *'),
    'Excluded pending source correction',
  )
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Exclude row' }),
  )
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'intake-review',
        id: 'intake-1',
        revision: 7,
        decision: 'exclude',
        reason: 'Excluded pending source correction',
      }),
    ),
  )
})

it('keeps CSV columns distinct and parses multiline quoted values without guessing identity', () => {
  const rows = parseIntakeCSV(
    '\uFEFFName,Email,Email,Source ID\r\n"PILOT TEST, Person",old@example.invalid,new@example.invalid,row-1\r\n"PILOT TEST\nSecond",second@example.invalid,,row-2',
  )
  expect(rows[0]).toEqual(['Name', 'Email', 'Email', 'Source ID'])
  expect(rows[1]).toEqual([
    'PILOT TEST, Person',
    'old@example.invalid',
    'new@example.invalid',
    'row-1',
  ])
  expect(rows[2][0]).toBe('PILOT TEST\nSecond')
  expect(() => parseIntakeCSV('Name,Email\n"unfinished,email')).toThrow(
    'unfinished quoted value',
  )
  expect(() => parseIntakeCSV('Name,Email\nOne')).toThrow(
    'different column counts',
  )
  expect(() =>
    parseIntakeCSV(
      'Name\n' +
        Array.from({ length: 101 }, (_, i) => `PILOT TEST ${i}`).join('\n'),
    ),
  ).toThrow('100 rows')
  expect(mappedDueDate('2026-11-01T09:00:00-05:00')).toBe(
    '2026-11-01T14:00:00.000Z',
  )
  expect(() => mappedDueDate('11/01/2026 9:00 AM')).toThrow(
    'explicit timezone offset',
  )
  expect(() => mappedDueDate('2026-11-01T09:00:00')).toThrow(
    'explicit timezone offset',
  )
})

it('traps dialog keyboard focus, closes on Escape and restores the trigger', async () => {
  setup('Directory')
  const trigger = screen.getByRole('button', { name: 'Add person' })
  await userEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name: 'Add person' })
  expect(
    within(dialog).getByRole('button', { name: 'Close dialog' }),
  ).toHaveFocus()
  await userEvent.tab({ shift: true })
  expect(
    within(dialog).getByRole('button', { name: 'Save record' }),
  ).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('keeps import actions manager-only and never makes an automatic request', () => {
  const { api } = setup('Import review', [], { ...member, role: 'contributor' })
  expect(
    screen.queryByRole('button', { name: 'Map CSV batch' }),
  ).not.toBeInTheDocument()
  expect(api).not.toHaveBeenCalled()
})

it('requires an explicit matching-person selection for duplicate intake rows', async () => {
  const duplicate = {
    ...person,
    id: 'intake-duplicate',
    kind: 'intake',
    title: 'PILOT TEST Duplicate inquiry',
    data: {
      status: 'duplicate',
      email: person.data.email,
      sourceName: 'PILOT TEST Form',
      sourceId: 'row-2',
      workflow: 'class',
      candidatePersonIds: [person.id],
    },
  }
  const { api } = setup('Import review', [
    person,
    {
      ...person,
      id: 'person-unrelated',
      title: 'PILOT TEST Unrelated',
      data: { email: 'unrelated@example.invalid' },
    },
    duplicate,
  ])
  await userEvent.click(screen.getByRole('button', { name: duplicate.title }))
  const dialog = screen.getByRole('dialog', { name: 'Review source row' })
  expect(
    within(dialog).getByRole('button', { name: 'Apply reviewed row' }),
  ).toBeDisabled()
  expect(
    within(dialog).queryByRole('option', { name: /PILOT TEST Unrelated/ }),
  ).not.toBeInTheDocument()
  await userEvent.selectOptions(
    within(dialog).getByLabelText('Existing person'),
    person.id,
  )
  await userEvent.type(
    within(dialog).getByLabelText('Review reason *'),
    'Verified same person and source email',
  )
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Link person and apply row' }),
  )
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'intake-review',
        personId: person.id,
        decision: 'apply',
      }),
    ),
  )
})

it('queues only explicitly mapped source columns and never applies rows during upload', async () => {
  const { api } = setup('Import review')
  await userEvent.click(screen.getByRole('button', { name: 'Map CSV batch' }))
  const dialog = screen.getByRole('dialog', { name: 'Map a CSV batch' })
  const file = new File(
    [
      'Name,Email,Email,Source ID\nPilot,old@example.invalid,new@example.invalid,row-1',
    ],
    'pilot.csv',
    { type: 'text/csv' },
  )
  Object.defineProperty(file, 'text', {
    value: async () =>
      'Name,Email,Email,Source ID\nPilot,old@example.invalid,new@example.invalid,row-1',
  })
  await userEvent.upload(within(dialog).getByLabelText('CSV file *'), file)
  await userEvent.type(
    within(dialog).getByLabelText('Source name / version *'),
    'PILOT TEST Intake v2',
  )
  fireEvent.change(within(dialog).getByLabelText('Default due date *'), {
    target: { value: '2026-11-01T09:00' },
  })
  expect(within(dialog).getByLabelText('Email *')).toHaveValue('')
  await userEvent.selectOptions(
    within(dialog).getByLabelText('Stable source row ID *'),
    '3',
  )
  await userEvent.selectOptions(
    within(dialog).getByLabelText('Person name *'),
    '0',
  )
  await userEvent.selectOptions(within(dialog).getByLabelText('Email *'), '2')
  expect(
    Array.from(
      dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        'input,select',
      ),
    )
      .filter((input) => !input.checkValidity())
      .map((input) => input.closest('label')?.textContent),
  ).toEqual([])
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Queue 1 rows for review' }),
  )
  await waitFor(() => expect(api).toHaveBeenCalledOnce())
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'intake-preview',
      sourceName: 'PILOT TEST Intake v2',
      rows: [
        expect.objectContaining({
          sourceId: 'row-1',
          name: 'Pilot',
          email: 'new@example.invalid',
          contactPermission: 'Unknown',
        }),
      ],
    }),
  )
  expect(
    api.mock.calls.some(
      ([body]) =>
        body.action === 'intake-review' || body.action === 'foundation-save',
    ),
  ).toBe(false)
})

it('assigns only approved training and requires a staff learner', async () => {
  const approved = {
    ...person,
    id: 'training-1',
    kind: 'resource',
    title: 'PILOT TEST Approved training',
    data: { resourceType: 'training', status: 'Approved', version: 1 },
  }
  const { api } = setup('Library', [
    approved,
    {
      ...approved,
      id: 'draft-1',
      title: 'PILOT TEST Draft training',
      data: { ...approved.data, status: 'Draft' },
    },
    {
      ...approved,
      id: 'template-1',
      title: 'PILOT TEST Template',
      data: { ...approved.data, resourceType: 'template' },
    },
  ])
  await userEvent.click(screen.getByRole('button', { name: 'Assign training' }))
  const dialog = screen.getByRole('dialog', { name: 'Add learning assignment' })
  expect(
    within(dialog).getByRole('option', { name: approved.title }),
  ).toBeInTheDocument()
  expect(
    within(dialog).queryByRole('option', { name: 'PILOT TEST Draft training' }),
  ).not.toBeInTheDocument()
  expect(
    within(dialog).queryByRole('option', { name: 'PILOT TEST Template' }),
  ).not.toBeInTheDocument()
  await userEvent.type(
    within(dialog).getByLabelText('Title *'),
    'PILOT TEST Sales onboarding',
  )
  await userEvent.selectOptions(
    within(dialog).getByLabelText('Approved training resource'),
    approved.id,
  )
  await userEvent.selectOptions(
    within(dialog).getByLabelText('Assigned staff *'),
    member.id,
  )
  await userEvent.type(
    within(dialog).getByLabelText('Next action *'),
    'Complete worksheet',
  )
  fireEvent.change(within(dialog).getByLabelText('Next action due *'), {
    target: { value: '2026-11-01T09:00' },
  })
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Save record' }),
  )
  await waitFor(() => expect(api).toHaveBeenCalledOnce())
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'foundation-save',
      record: expect.objectContaining({
        kind: 'learning',
        data: expect.objectContaining({
          assigneeId: member.id,
          resourceId: approved.id,
          progress: 'Not started',
        }),
      }),
    }),
  )
})
