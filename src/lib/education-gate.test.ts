// @vitest-environment node
import { expect, it } from 'vitest'
import { syntheticEducationAvailable } from '../../netlify/functions/lib/education-gate.mts'

const local = {
  CRM_SYNTHETIC_EDUCATION_ENABLED: '1',
  CRM_EDUCATION_ENVIRONMENT: 'synthetic-local',
}
function available(url: string, values: Record<string, string> = local) {
  return syntheticEducationAvailable(new Request(url), (key) => values[key])
}
it('requires explicit local configuration and the exact loopback host', () => {
  expect(available('http://127.0.0.1:4192/api/crm')).toBe(true)
  expect(available('http://127.0.0.1/api/crm', {})).toBe(false)
  for (const url of [
    'https://emerson-crm.netlify.app/api/crm',
    'https://preview.netlify.app/api/crm',
    'https://127.0.0.1/api/crm',
    'http://localhost:4192/api/crm',
    'http://127.0.0.2:4192/api/crm',
    'http://example.invalid/api/crm',
  ])
    expect(available(url)).toBe(false)
  for (const key of ['SITE_ID', 'DEPLOY_ID', 'CONTEXT', 'NETLIFY'])
    expect(
      available('http://127.0.0.1/api/crm', { ...local, [key]: 'set' }),
    ).toBe(false)
  expect(
    available('http://127.0.0.1/api/crm', {
      ...local,
      CRM_SYNTHETIC_EDUCATION_ENABLED: 'true',
    }),
  ).toBe(false)
})
