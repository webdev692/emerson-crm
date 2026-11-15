import { afterEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectStudioRehearsal } from '../../scripts/fixtures/project-studio-review'
import {
  initialDemoRecord,
  rehearsalNotice,
  reviewOutcomeMappings,
  syntheticInquiry,
  type DemoPersona,
  type DemoState,
  type ReviewOutcome,
} from '../lib/project-studio-rehearsal'

afterEach(() => vi.unstubAllGlobals())

function setup(persona: DemoPersona = 'client', populated = false) {
  let state: DemoState = {
    synthetic: true,
    session: {
      persona,
      role: persona === 'viewer' ? 'viewer' : 'client',
      active: true,
    },
    csrfToken: 'synthetic-csrf-token',
    inquiries: populated
      ? [
          initialDemoRecord(
            'SYN-PS5-001',
            syntheticInquiry,
            '2026-11-15T12:00:00Z',
            false,
          ),
        ]
      : [],
    notice: rehearsalNotice,
  }
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toMatch(/^\/api\/project-studio-demo(?:\/session)?$/)
    expect(init?.credentials).toBe('same-origin')
    expect(init?.cache).toBe('no-store')
    if (!init?.method) return Response.json(state)
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('x-csrf-token')).toBe(state.csrfToken)
    const body = JSON.parse(String(init.body))
    if (url.endsWith('/session')) {
      state = {
        ...state,
        session: { persona: body.persona, role: 'contributor', active: true },
        csrfToken: 'new-synthetic-csrf-token',
      }
      return Response.json(state)
    }
    if (body.action === 'submit') {
      const duplicate = state.inquiries.length > 0
      if (!duplicate)
        state = {
          ...state,
          inquiries: [
            initialDemoRecord(
              body.submissionId,
              body.inquiry,
              '2026-11-15T12:00:00Z',
              false,
            ),
          ],
        }
      return Response.json({
        ...state,
        receipt: state.inquiries[0].receipt,
        duplicate,
        inquiry: state.inquiries[0],
      })
    }
    const record = state.inquiries[0]
    expect(body.revision).toBe(record.revision)
    state = {
      ...state,
      inquiries: [
        {
          ...record,
          revision: record.revision + 1,
          reviewOutcome: body.outcome,
          reviewMapping:
            reviewOutcomeMappings[body.outcome as ReviewOutcome].crmMapping,
          review: {
            reason: body.reason,
            reviewer: 'Simulated reviewer',
            reviewedAt: '2026-11-15T12:05:00Z',
          },
        },
      ],
    }
    return Response.json(state)
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<ProjectStudioRehearsal />)
  return { fetchMock, user: userEvent.setup() }
}

it('focuses the error summary without stealing focus while a field is corrected', async () => {
  const { user, fetchMock } = setup()
  const submit = await screen.findByRole('button', {
    name: 'Simulate inquiry submission',
  })
  await waitFor(() => expect(submit).toBeEnabled())
  await user.click(submit)
  const summary = screen.getByRole('alert')
  expect(summary).toHaveFocus()
  await user.click(
    within(summary).getByRole('link', {
      name: /^Business or organization name:/,
    }),
  )
  const name = screen.getByLabelText('Business or organization name', {
    exact: true,
  })
  expect(name).toHaveFocus()
  await user.type(name, 'Harbor')
  expect(name).toHaveFocus()
  expect(name).toHaveValue('Harbor')
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true)
})

it('requires explicit synthetic acknowledgment, submits locally and announces the duplicate receipt', async () => {
  const { user, fetchMock } = setup()
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Simulate inquiry submission' }),
    ).toBeEnabled(),
  )
  await user.click(
    screen.getByRole('button', { name: 'Fill fictional example' }),
  )
  const acknowledgment = screen.getByRole('checkbox', {
    name: /I am using fictional information/,
  })
  expect(acknowledgment).not.toBeChecked()
  expect(
    screen.getByRole('option', { name: 'Other — help me describe the work' }),
  ).toBeInTheDocument()
  expect(document.querySelector('input[type=file]')).toBeNull()
  await user.click(acknowledgment)
  await user.click(
    screen.getByRole('button', { name: 'Simulate inquiry submission' }),
  )
  await screen.findByText(/Simulation complete\. The fictional inquiry/)
  await user.click(
    screen.getByRole('button', { name: 'Retry the same inquiry' }),
  )
  await screen.findByText(/Duplicate retry recognized/)
  const submits = fetchMock.mock.calls.filter(
    ([, init]) =>
      init?.body && JSON.parse(String(init.body)).action === 'submit',
  )
  expect(submits).toHaveLength(2)
  expect(submits[0][1]?.body).toBe(submits[1][1]?.body)
  expect(
    screen.getAllByRole('button', { name: /Harbor Lantern Services/ }),
  ).toHaveLength(1)
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
})

it('keeps read-only decisions unavailable and uses the new server session token for an assigned review', async () => {
  const { user, fetchMock } = setup('viewer', true)
  await screen.findByRole('button', { name: /Harbor Lantern Services/ })
  expect(
    screen.queryByRole('button', { name: 'Save simulated review' }),
  ).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Simulate inquiry submission' }),
  ).toBeDisabled()
  await user.click(
    screen.getByRole('button', { name: 'Fill fictional example' }),
  )
  await user.selectOptions(
    screen.getByLabelText('Simulated account', { exact: true }),
    'reviewer',
  )
  const save = await screen.findByRole('button', {
    name: 'Save simulated review',
  })
  expect(
    screen.getByLabelText('Business or organization name', { exact: true }),
  ).toHaveValue('')
  await user.click(save)
  expect(
    screen.getByText(
      'Add a short fictional reason for this review observation.',
    ),
  ).toHaveFocus()
  await user.type(
    screen.getByLabelText('Review reason and next step'),
    'SYNTHETIC: Confirm scope and capacity before any proposal.',
  )
  await user.click(save)
  await screen.findByText(
    /Synthetic review saved\. The illustrative stage remains S1; no CRM opportunity was created/,
  )
  const review = fetchMock.mock.calls.find(
    ([, init]) =>
      init?.body && JSON.parse(String(init.body)).action === 'review',
  )
  expect(review).toBeDefined()
  expect(JSON.parse(String(review?.[1]?.body))).toEqual({
    action: 'review',
    inquiryId: 'SYN-PS5-001',
    revision: 1,
    outcome: 'feasibility',
    reason: 'SYNTHETIC: Confirm scope and capacity before any proposal.',
  })
  expect(screen.getByText('S1 · New Inquiry')).toBeInTheDocument()
  expect(document.querySelectorAll('.ps5-flow details')).toHaveLength(12)
})

it('shows unavailable-server errors without presenting a receipt or enabling submission', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: 'disabled',
            message:
              'This rehearsal is disabled outside the isolated local server.',
          },
        },
        { status: 503 },
      ),
    ),
  )
  render(<ProjectStudioRehearsal />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This rehearsal is disabled outside the isolated local server.',
  )
  expect(
    screen.getByRole('button', { name: 'Simulate inquiry submission' }),
  ).toBeDisabled()
  expect(screen.queryByText('Local reference:')).toBeNull()
})
