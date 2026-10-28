import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { EducationClearancePanel } from './education-clearance'
import { FoundationWorkspace } from './foundation-workspace'
import {
  educationCriteria,
  emptyEducationClearance,
  emptyEducationEvidence,
  type EducationSnapshot,
} from '../lib/education'

const applicationId = '82000000-0000-4000-8000-000000000001'
function status(): EducationSnapshot {
  return {
    applicationId,
    applicationRevision: 3,
    personRevision: 2,
    sourceFingerprint: 'a'.repeat(64),
    sourceVersion: 'synthetic-source-v1',
    decisionVersion: 0,
    current: null,
    holds: [],
    outbox: [],
  }
}
it('shows the retained portal version as a baseline without inventing earlier CRM reviews', async () => {
  const snapshot = { ...status(), receiverVersionFloor: 9, decisionVersion: 9 }
  const api = vi.fn().mockResolvedValue(snapshot)
  render(<EducationClearancePanel applicationId={applicationId} api={api} />)
  expect(
    await screen.findByText(/Existing portal version baseline 9/),
  ).toHaveTextContent('no earlier CRM decisions are implied')
  expect(screen.getByText(/Not reviewed/)).toBeVisible()
  expect(
    screen.getByRole('checkbox', { name: 'HR approved' }),
  ).not.toBeChecked()
  expect(api).toHaveBeenCalledTimes(1)
  expect(api).toHaveBeenCalledWith({
    action: 'education-status',
    applicationId,
  })
})
it('requires deliberate requirement review and sends current optimistic revisions', async () => {
  const snapshot = status()
  snapshot.current = {
    id: 'old-decision',
    decision: 'cleared',
    withdrawn: false,
    reviewerId: 'earlier-reviewer',
    issuedAt: '2026-10-24T12:00:00.000Z',
    reason: 'Earlier review',
    clearance: {
      identity_verified: true,
      onboarding_complete: true,
      agreements_complete: true,
      hr_approved: true,
    },
    evidence: {
      identity_verified: 'Old source',
      onboarding_complete: 'Old source',
      agreements_complete: 'Old source',
      hr_approved: 'Old source',
    },
  }
  snapshot.decisionVersion = 1
  const api = vi.fn().mockResolvedValue(snapshot)
  render(<EducationClearancePanel applicationId={applicationId} api={api} />)
  await screen.findByRole('button', { name: 'Record HR decision' })
  for (const [, label] of educationCriteria) {
    expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked()
    expect(screen.getByLabelText(`${label} evidence reference`)).toHaveValue('')
    await userEvent.click(screen.getByRole('checkbox', { name: label }))
    await userEvent.type(
      screen.getByLabelText(`${label} evidence reference`),
      'Synthetic current source',
    )
  }
  await userEvent.selectOptions(screen.getByLabelText('Decision'), 'cleared')
  await userEvent.type(
    screen.getByLabelText('Review reason'),
    'Current fictional evidence reviewed',
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Record HR decision' }),
  )
  expect(api).toHaveBeenCalledWith({
    action: 'education-review',
    applicationId,
    expected: {
      applicationRevision: 3,
      personRevision: 2,
      sourceFingerprint: 'a'.repeat(64),
      decisionVersion: 1,
    },
    clearance: {
      identity_verified: true,
      onboarding_complete: true,
      agreements_complete: true,
      hr_approved: true,
    },
    evidence: Object.fromEntries(
      educationCriteria.map(([key]) => [key, 'Synthetic current source']),
    ),
    decision: 'cleared',
    withdrawn: false,
    restoreWithdrawal: false,
    reason: 'Current fictional evidence reviewed',
  })
  await screen.findByRole('status')
  expect(
    screen.getByRole('checkbox', { name: 'Identity verified' }),
  ).not.toBeChecked()
})

it('clears stale review details after rejection and requires a fresh status load', async () => {
  const api = vi
    .fn()
    .mockResolvedValueOnce(status())
    .mockRejectedValueOnce(Error('Source changed. Refresh and review.'))
  render(<EducationClearancePanel applicationId={applicationId} api={api} />)
  await screen.findByRole('button', { name: 'Record HR decision' })
  await userEvent.type(
    screen.getByLabelText('Review reason'),
    'Hold until verified',
  )
  for (const [, label] of educationCriteria)
    await userEvent.type(
      screen.getByLabelText(`${label} evidence reference`),
      'Unverified',
    )
  await userEvent.click(
    screen.getByRole('button', { name: 'Record HR decision' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('Source changed')
  expect(
    screen.queryByRole('button', { name: 'Record HR decision' }),
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Refresh clearance' }),
  ).toBeEnabled()
})

it('keeps withdrawal explicit and treats the portal receipt as separate from HR review', async () => {
  const snapshot = status()
  snapshot.current = {
    id: 'held-decision',
    decision: 'held',
    withdrawn: true,
    reviewerId: 'reviewer',
    issuedAt: '2026-10-24T12:00:00.000Z',
    reason: 'Applicant withdrew',
    clearance: emptyEducationClearance(),
    evidence: emptyEducationEvidence(),
  }
  snapshot.outbox = [
    {
      eventId: 'event',
      decisionVersion: 1,
      decision: 'held',
      status: 'pending',
      attempts: 0,
      bodyHash: 'b'.repeat(64),
    },
  ]
  const api = vi.fn().mockResolvedValue(snapshot)
  render(<EducationClearancePanel applicationId={applicationId} api={api} />)
  expect(
    await screen.findByRole('checkbox', { name: 'Applicant has withdrawn' }),
  ).toBeChecked()
  expect(
    screen.getByRole('checkbox', { name: /Explicitly reinstate/ }),
  ).not.toBeChecked()
  await userEvent.click(
    screen.getByRole('button', {
      name: 'Send current handoff to synthetic portal',
    }),
  )
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith({
      action: 'education-dispatch',
      applicationId,
    }),
  )
  expect(screen.getByText(/does not create a learner account/)).toBeVisible()
})

it('does not expose the rehearsal panel unless enabled for an authorized HR writer', async () => {
  const member = {
    id: 'synthetic-owner',
    role: 'owner',
    name: 'Synthetic owner',
    active: true,
  }
  const records = [
    {
      id: applicationId,
      kind: 'application',
      title: 'SYNTHETIC applicant',
      ownerId: member.id,
      revision: 1,
      access: 'hr',
      data: {
        educationFixture: true,
        workflow: 'program',
        stage: 'Active',
        onboardingStatus: 'Complete',
      },
    },
  ]
  const api = vi.fn().mockResolvedValue(status())
  const props = {
    section: 'Workflows' as const,
    member,
    records,
    staff: [member],
    api,
    reload: vi.fn(),
  }
  const view = render(<FoundationWorkspace {...props} />)
  await userEvent.click(
    screen.getByRole('button', { name: 'SYNTHETIC applicant' }),
  )
  expect(
    within(screen.getByRole('dialog')).queryByRole('region', {
      name: 'HR clearance and education handoff',
    }),
  ).not.toBeInTheDocument()
  view.unmount()
  render(
    <FoundationWorkspace
      {...props}
      syntheticEducation
      member={{ ...member, role: 'viewer', hr: true }}
    />,
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'SYNTHETIC applicant' }),
  )
  expect(
    screen.queryByRole('region', {
      name: 'HR clearance and education handoff',
    }),
  ).not.toBeInTheDocument()
  expect(api).not.toHaveBeenCalled()
})

it('offers the synthetic handoff only on its fixed explicit fixture, never another application', async () => {
  const member = {
    id: 'synthetic-reviewer',
    role: 'manager',
    hr: true,
    name: 'SYNTHETIC reviewer',
    active: true,
  }
  const app = {
    id: applicationId,
    kind: 'application',
    title: 'SYNTHETIC applicant',
    ownerId: member.id,
    revision: 1,
    access: 'hr',
    data: { educationFixture: true, workflow: 'program', stage: 'Active' },
  }
  const api = vi.fn().mockResolvedValue(status())
  const props = {
    section: 'Workflows' as const,
    member,
    records: [app],
    staff: [member],
    api,
    reload: vi.fn(),
    syntheticEducation: true,
  }
  const view = render(<FoundationWorkspace {...props} />)
  await userEvent.click(
    screen.getByRole('button', { name: 'SYNTHETIC applicant' }),
  )
  expect(
    await screen.findByRole('region', {
      name: 'HR clearance and education handoff',
    }),
  ).toBeVisible()
  expect(api).toHaveBeenCalledWith({
    action: 'education-status',
    applicationId,
  })
  view.unmount()
  api.mockClear()
  render(
    <FoundationWorkspace
      {...props}
      records={[
        {
          ...app,
          id: '82000000-0000-4000-8000-000000000002',
          title: 'Another applicant',
        },
      ]}
    />,
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Another applicant' }),
  )
  expect(
    screen.queryByRole('region', {
      name: 'HR clearance and education handoff',
    }),
  ).not.toBeInTheDocument()
  expect(api).not.toHaveBeenCalled()
})
