// @vitest-environment node
import { expect, it, vi } from 'vitest'
import type { UserValidateEvent } from '@netlify/functions'

// Discover function sources recursively, including helpers and legacy filename hooks.
// No service, account, mailer or database is invoked by this contract test.
vi.mock('../../db/index', () => ({ database: vi.fn() }))
const functions = import.meta.glob<{ default?: unknown }>(
  '/netlify/functions/**/*.{mts,ts,mjs,js}',
  { eager: true },
)

it('leaves registration enforcement to native Invite only, without legacy validation hooks', () => {
  expect(Object.keys(functions).some((path) => path.endsWith('/crm.mts'))).toBe(
    true,
  )
  expect(
    Object.keys(functions).some((path) =>
      /identity-validate(?:-background)?\.[^.]+$/.test(path),
    ),
  ).toBe(false)
  for (const module of Object.values(functions)) {
    if (module.default !== undefined && module.default !== null) {
      expect(module.default).not.toHaveProperty('userValidate')
    }
  }
})

it.each([undefined, ''])(
  'does not veto an administrator invitation before invitedAt is set (%s)',
  async (invitedAt) => {
    // GoTrue Invite -> signupNewUser -> ValidateEvent -> sendInvite -> invited_at.
    // This is a lifecycle fixture from official source, not a captured production payload.
    const deny = vi.fn()
    const event: UserValidateEvent = {
      user: { id: '00000000-0000-4000-8000-000000000001', invitedAt },
      deny,
    }
    for (const module of Object.values(functions)) {
      const handler = module.default as {
        userValidate?: (event: UserValidateEvent) => unknown
      }
      await handler?.userValidate?.(event)
    }
    expect(deny).not.toHaveBeenCalled()
  },
)
