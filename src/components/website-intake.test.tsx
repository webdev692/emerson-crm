import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { FoundationWorkspace } from './foundation-workspace'

it('shows synthetic fetch only for configured owner/manager previews and reports safe retry', async () => {
  const api = vi
    .fn()
    .mockResolvedValue({ queued: 1, acknowledged: 0, retryRequired: true })
  const props = {
    section: 'Import review' as const,
    records: [],
    member: { id: 'synthetic-owner', role: 'owner' },
    staff: [],
    api,
    reload: vi.fn(),
  }
  const view = render(<FoundationWorkspace {...props} />)
  expect(
    screen.queryByRole('button', { name: 'Fetch synthetic website inquiries' }),
  ).not.toBeInTheDocument()
  view.rerender(<FoundationWorkspace {...props} syntheticWebsiteIntake />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Fetch synthetic website inquiries' }),
  )
  expect(api).toHaveBeenCalledWith({ action: 'website-intake-pull' })
  await waitFor(() =>
    expect(
      screen.getByText(/Retry the fetch to finish acknowledgment safely/),
    ).toBeVisible(),
  )
  expect(screen.getByText(/No contacts or applicants created/)).toBeVisible()
  view.rerender(
    <FoundationWorkspace
      {...props}
      member={{ id: 'synthetic-contributor', role: 'contributor' }}
      syntheticWebsiteIntake
    />,
  )
  expect(
    screen.queryByRole('button', { name: 'Fetch synthetic website inquiries' }),
  ).not.toBeInTheDocument()
})
