import { describe, expect, it, vi } from 'vitest'
import {
  assessSyntheticDiscovery,
  buildDemoBoard,
  canonicalInquiry,
  pilotSteps,
  productionStudioAdapter,
  reviewOutcomes,
  studioCategories,
  syntheticInquiry,
  validateStudioInquiry,
  type DemoPersona,
  type DemoState,
} from './project-studio-rehearsal'
import { stages } from './rules'
import {
  createStudioRehearsal,
  disabledProductionStudioAdapter,
} from '../../netlify/functions/lib/project-studio-rehearsal.mts'

const origin = 'http://127.0.0.1:4317'
const api = '/api/project-studio-demo'
function harness() {
  let time = Date.UTC(2026, 10, 15, 20, 0, 0)
  const handler = createStudioRehearsal({
    origin,
    mode: 'synthetic-local',
    environment: {},
    now: () => time,
  })
  let cookie = ''
  let csrf = ''
  async function call(
    path = api,
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    const headers = new Headers({
      cookie,
      ...(body === undefined
        ? {}
        : { origin, 'content-type': 'application/json', 'x-csrf-token': csrf }),
      ...extra,
    })
    const response = await handler(
      new Request(origin + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    const value = await response.json()
    if (value.csrfToken) csrf = value.csrfToken
    return { response, value }
  }
  async function persona(name: DemoPersona) {
    if (!cookie) await call()
    return call(`${api}/session`, { persona: name })
  }
  const submit = (
    submissionId = 'SYN-PS5-001',
    inquiry: unknown = syntheticInquiry,
  ) => call(api, { action: 'submit', submissionId, inquiry })
  const review = (revision = 1, outcome = 'feasibility') =>
    call(api, {
      action: 'review',
      inquiryId: 'SYN-PS5-001',
      revision,
      outcome,
      reason: 'Synthetic technical and capacity review remains pending.',
    })
  return {
    handler,
    call,
    persona,
    submit,
    review,
    advance: (ms: number) => {
      time += ms
    },
    cookie: () => cookie,
    csrf: () => csrf,
  }
}

describe('synthetic Project Studio inquiry contract', () => {
  it('offers exactly the eight informational categories plus Other and accepts the complete fictional example', () => {
    expect(studioCategories).toHaveLength(9)
    expect(studioCategories.at(-1)?.id).toBe('other')
    expect(validateStudioInquiry(syntheticInquiry)).toEqual({
      ok: true,
      value: syntheticInquiry,
    })
    expect(
      validateStudioInquiry({ ...syntheticInquiry, category: 'other' }).ok,
    ).toBe(true)
    expect(Object.keys(syntheticInquiry)).toHaveLength(12)
  })
  it('rejects missing, unknown, attachment, real-identity, oversized and sensitive inputs without echoing them', () => {
    for (const value of [
      null,
      [],
      {},
      { ...syntheticInquiry, attachments: ['secret.txt'] },
      { ...syntheticInquiry, email: 'real@example.com' },
      { ...syntheticInquiry, email: 'someone@different.invalid' },
      { ...syntheticInquiry, businessName: 'A real business' },
      { ...syntheticInquiry, contactName: 'Another individual' },
      { ...syntheticInquiry, location: 'Charleston' },
      { ...syntheticInquiry, category: 'approved-new-service' },
      { ...syntheticInquiry, description: 'x'.repeat(1501) },
      { ...syntheticInquiry, description: '<script>alert("private")</script>' },
      {
        ...syntheticInquiry,
        currentSystems: 'password=private-value-do-not-echo',
      },
      { ...syntheticInquiry, privacyAcknowledged: false },
      { ...syntheticInquiry, preferredContact: 'sms' },
    ]) {
      const result = validateStudioInquiry(value)
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain('private-value-do-not-echo')
      expect(JSON.stringify(result)).not.toContain('real@example.com')
    }
  })
  it('canonicalizes trimmed fictional fields without depending on object property order', () => {
    const reversed = Object.fromEntries(
      Object.entries(syntheticInquiry).reverse(),
    )
    const result = validateStudioInquiry({
      ...reversed,
      email: ' CASEY@HARBOR-LANTERN.INVALID ',
      contactName: ' Casey Vale ',
    })
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(canonicalInquiry(result.value)).toBe(
        canonicalInquiry(syntheticInquiry),
      )
  })
  it('reuses the existing qualification precedence and never advances a canonical stage', () => {
    expect(
      assessSyntheticDiscovery(['Met', 'Met', 'Met', 'Met', 'Met']),
    ).toEqual({ result: 'S5', simulated: true, stageChanged: false })
    expect(
      assessSyntheticDiscovery(['Not met', 'Met', 'Met', 'Not met', 'Unclear'])
        .result,
    ).toBe('H1')
    expect(
      assessSyntheticDiscovery(['Met', 'Unclear', 'Met', 'Met', 'Met']).result,
    ).toBe('H2')
    expect(assessSyntheticDiscovery([]).result).toBe('Incomplete')
    expect(stages.S9).toBe('Handed Off (Won)')
  })
  it('provides twelve inspectable pilot steps and a board that does not pretend approval, staffing or acceptance', () => {
    expect(pilotSteps).toHaveLength(12)
    expect(new Set(pilotSteps.map((step) => step.id)).size).toBe(12)
    for (const step of pilotSteps)
      for (const key of ['title', 'summary', 'crmMapping', 'evidence'] as const)
        expect(step[key].length).toBeGreaterThan(10)
    expect(pilotSteps.at(-1)?.crmMapping).toContain(
      'never payment or final client acceptance',
    )
    const board = buildDemoBoard()
    expect(board.handoffReady).toBe(false)
    expect(board.approvedWork).toContain('No real scope is approved')
    expect(board.responsibleRole).toContain('no real staff assigned')
    expect(board.milestones).toHaveLength(4)
    expect(board.blocked).toContain('Compensated staffing and capacity')
  })
})

describe('server-associated local rehearsal sessions and safe runtime boundary', () => {
  it('fails closed for missing mode/environment, non-exact loopback origins and every hosted runtime indicator', async () => {
    const configs = [
      { origin, mode: 'production', environment: {} },
      { origin, mode: '', environment: {} },
      { origin, mode: 'synthetic-local', environment: undefined },
      ...[
        'http://localhost:4317',
        'http://0.0.0.0:4317',
        'https://127.0.0.1:4317',
        'http://127.0.0.1:4317/',
        'http://127.0.0.1:80',
        'http://127.0.0.1:99999',
        'https://emerson-crm.netlify.app',
      ].map((value) => ({
        origin: value,
        mode: 'synthetic-local',
        environment: {},
      })),
      ...['NETLIFY', 'CONTEXT', 'DEPLOY_ID', 'SITE_ID'].map((key) => ({
        origin,
        mode: 'synthetic-local',
        environment: { [key]: '' },
      })),
    ]
    for (const config of configs) {
      // A missing snapshot must fail closed even when called by untyped code.
      const handler = createStudioRehearsal(
        config as Parameters<typeof createStudioRehearsal>[0],
      )
      const response = await handler(new Request(origin + api))
      expect(response.status).toBe(503)
      expect(response.headers.get('set-cookie')).toBeNull()
    }
  })
  it('issues random opaque HttpOnly Strict cookies, rotates sessions, and rejects forged identity/action authority', async () => {
    const h = harness()
    const first = await h.call()
    expect(first.response.headers.get('set-cookie')).toMatch(
      /HttpOnly; SameSite=Strict/,
    )
    expect(first.response.headers.get('cache-control')).toBe('no-store')
    expect(first.value.session.persona).toBe('guest')
    expect(first.value.inquiries).toEqual([])
    const guestCookie = h.cookie()
    const guestCsrf = h.csrf()
    await h.persona('client')
    expect(h.cookie()).not.toBe(guestCookie)
    expect(h.cookie()).not.toContain('client')
    expect(h.csrf()).not.toBe(guestCsrf)
    const stale = await h.handler(
      new Request(origin + api, {
        method: 'POST',
        headers: {
          origin,
          cookie: guestCookie,
          'x-csrf-token': guestCsrf,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          action: 'submit',
          submissionId: 'SYN-PS5-001',
          inquiry: syntheticInquiry,
        }),
      }),
    )
    expect(stale.status).toBe(401)
    expect(
      (
        await h.call(api, {
          action: 'submit',
          submissionId: 'SYN-PS5-001',
          inquiry: syntheticInquiry,
          actor: 'owner',
        })
      ).response.status,
    ).toBe(400)
    expect(
      (await h.call(`${api}/session`, { persona: 'owner', commercial: true }))
        .response.status,
    ).toBe(400)
    expect((await h.submit()).response.status).toBe(201)
  })
  it('requires exact Origin, CSRF and host, rejects forwarding, and offers no permissive CORS', async () => {
    const h = harness()
    await h.persona('client')
    const body = {
      action: 'submit',
      submissionId: 'SYN-PS5-001',
      inquiry: syntheticInquiry,
    }
    const deniedHeaders: Record<string, string>[] = [
      { origin: 'https://hostile.invalid' },
      { origin: '' },
      { 'x-csrf-token': '' },
      { 'x-csrf-token': 'a'.repeat(43) },
      { 'x-csrf-token': 'é'.repeat(43) },
      { host: 'hostile.invalid' },
      { 'x-forwarded-host': '127.0.0.1:4317' },
      { 'x-forwarded-proto': 'http' },
      { forwarded: 'host=127.0.0.1:4317' },
      { 'sec-fetch-site': 'cross-site' },
    ]
    for (const headers of deniedHeaders) {
      const result = await h.call(api, body, headers)
      expect(result.response.status).toBe(403)
      expect(result.response.headers.has('access-control-allow-origin')).toBe(
        false,
      )
    }
    expect(
      (await h.handler(new Request('http://localhost:4317' + api))).status,
    ).toBe(404)
    expect(
      (await h.handler(new Request(origin + api, { method: 'OPTIONS' })))
        .status,
    ).toBe(405)
    expect((await h.call()).value.inquiries).toEqual([])
  })
  it('rejects oversized, malformed, non-JSON and unknown-route requests before storage', async () => {
    const h = harness()
    await h.persona('client')
    for (const [body, contentType, status] of [
      ['x'.repeat(12001), 'application/json', 413],
      ['{broken', 'application/json', 400],
      [JSON.stringify(syntheticInquiry), 'multipart/form-data', 400],
    ] as const) {
      const response = await h.handler(
        new Request(origin + api, {
          method: 'POST',
          headers: {
            origin,
            cookie: h.cookie(),
            'x-csrf-token': h.csrf(),
            'content-type': contentType,
          },
          body,
        }),
      )
      expect(response.status).toBe(status)
      expect(await response.text()).not.toContain('x'.repeat(100))
    }
    expect((await h.call(api + '?unexpected=value')).response.status).toBe(404)
    expect((await h.call(api + '/unknown')).response.status).toBe(404)
    expect((await h.call()).value.inquiries).toEqual([])
  })
  it('expires sessions, caps request bursts, and keeps a newly started process empty', async () => {
    const h = harness()
    await h.persona('client')
    await h.submit()
    h.advance(31 * 60 * 1000)
    expect((await h.review()).response.status).toBe(401)
    const after = await h.call()
    expect(after.value.session.persona).toBe('guest')
    expect(after.value.inquiries).toEqual([])
    const burst = harness()
    for (let index = 0; index < 80; index++)
      expect((await burst.call()).response.status).toBe(200)
    expect((await burst.call()).response.status).toBe(429)
    burst.advance(60000)
    expect((await burst.call()).response.status).toBe(200)
    const fresh = harness()
    await fresh.persona('sales')
    expect((await fresh.call()).value.inquiries).toEqual([])
    const sessions = harness()
    for (let index = 0; index < 64; index++)
      expect((await sessions.handler(new Request(origin + api))).status).toBe(
        200,
      )
    expect((await sessions.handler(new Request(origin + api))).status).toBe(429)
  })
})

describe('synthetic intake, duplicate review and record permissions', () => {
  it('runs client submission to assigned staff review without external fetch and stamps the server persona', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Network forbidden in rehearsal'))
    try {
      const h = harness()
      await h.persona('client')
      const submitted = await h.submit()
      expect(submitted.response.status).toBe(201)
      expect(submitted.value.receipt).toBe('DEMO-RECEIPT-SYN-PS5-001')
      expect(submitted.value.inquiry.stage).toBe('S1')
      await h.persona('sales')
      const review = await h.review()
      expect(review.response.status).toBe(200)
      expect(review.value.inquiry.revision).toBe(2)
      expect(review.value.inquiry.review.reviewer).toBe('Simulated sales')
      expect(review.value.inquiry.stage).toBe('S1')
      await h.persona('client')
      expect((await h.call()).value.inquiries[0].review).toBeUndefined()
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })
  it('makes simultaneous exact retries idempotent and rejects changed content under the same ID', async () => {
    const h = harness()
    await h.persona('client')
    const results = await Promise.all([h.submit(), h.submit()])
    expect(results.map((value) => value.response.status).sort()).toEqual([
      200, 201,
    ])
    expect(new Set(results.map((value) => value.value.receipt)).size).toBe(1)
    expect((await h.call()).value.inquiries).toHaveLength(1)
    const conflict = await h.submit('SYN-PS5-001', {
      ...syntheticInquiry,
      outcome: 'Different synthetic outcome',
    })
    expect(conflict.response.status).toBe(409)
    expect((await h.call()).value.inquiries[0].revision).toBe(1)
  })
  it('flags a possible duplicate identity as a separate inquiry without silently merging it', async () => {
    const h = harness()
    await h.persona('client')
    await h.submit()
    const second = await h.submit('SYN-PS5-002', {
      ...syntheticInquiry,
      category: 'other',
    })
    expect(second.response.status).toBe(201)
    expect(second.value.inquiry.potentialDuplicate).toBe(true)
    expect(second.value.inquiry.id).toBe('SYN-PS5-002')
    expect((await h.call()).value.inquiries).toHaveLength(2)
  })
  it('protects assigned records from unsigned, outsider, inactive and viewer writes and prevents forged approval data', async () => {
    const h = harness()
    const unsigned = await h.handler(
      new Request(origin + api + '?id=SYN-PS5-001'),
    )
    expect(unsigned.status).toBe(401)
    await h.persona('client')
    await h.submit()
    expect((await h.review()).response.status).toBe(403)
    for (const persona of ['outsider', 'inactive', 'viewer'] as const) {
      await h.persona(persona)
      expect((await h.review()).response.status).toBe(403)
      const detail = await h.call(api + '?id=SYN-PS5-001')
      expect(detail.response.status).toBe(
        persona === 'viewer' ? 200 : persona === 'inactive' ? 403 : 404,
      )
      if (persona !== 'viewer')
        expect(JSON.stringify(detail.value)).not.toContain('Harbor Lantern')
    }
    await h.persona('sales')
    const unassigned = await h.call(api + '?id=SYN-PS5-UNASSIGNED')
    expect(unassigned.response.status).toBe(404)
    expect(JSON.stringify(unassigned.value)).not.toContain(
      'unassigned review fixture',
    )
    expect(
      (
        await h.call(api, {
          action: 'review',
          inquiryId: 'SYN-PS5-UNASSIGNED',
          revision: 1,
          outcome: 'suitable',
          reason: 'Attempted review of another synthetic record.',
        })
      ).response.status,
    ).toBe(404)
    const forged = await h.call(api, {
      action: 'review',
      inquiryId: 'SYN-PS5-001',
      revision: 1,
      outcome: 'suitable',
      reason: 'Synthetic assessment is ready for review.',
      approvedBy: 'Founder',
    })
    expect(forged.response.status).toBe(400)
    expect((await h.call()).value.inquiries[0].revision).toBe(1)
  })
  it('rejects stale reviews, retains the canonical S1 stage through every descriptive outcome, and rejects activation actions', async () => {
    const h = harness()
    await h.persona('client')
    await h.submit()
    await h.persona('reviewer')
    let revision = 1
    for (const outcome of reviewOutcomes) {
      const response = await h.review(revision, outcome)
      expect(response.response.status).toBe(200)
      expect(response.value.inquiry.stage).toBe('S1')
      expect(response.value.inquiry.reviewOutcome).toBe(outcome)
      revision++
    }
    expect((await h.review(1)).response.status).toBe(409)
    for (const action of [
      'approve',
      'contract',
      'send-email',
      'payment',
      'crm-write',
      'assign-staff',
      'advance-stage',
    ])
      expect((await h.call(api, { action })).response.status).toBe(400)
    const state = (await h.call()).value as DemoState
    expect(state.inquiries[0].revision).toBe(revision)
    expect(state.inquiries[0].stageLabel).toBe(stages.S1)
  })
  it('keeps the production adapter unconditionally disabled regardless of inputs and flags', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Network forbidden'))
    try {
      for (const input of [
        syntheticInquiry,
        {
          enabled: true,
          mode: 'production',
          endpoint: 'https://example.invalid',
        },
        null,
      ])
        await expect(productionStudioAdapter(input)).rejects.toThrow(
          'Production Project Studio integration is disabled.',
        )
      await expect(
        disabledProductionStudioAdapter({ enabled: true }),
      ).rejects.toThrow('Production Project Studio integration is disabled.')
      const h = harness()
      const request = new Request(origin + api + '/production', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: 'not-json-and-must-not-be-read',
      })
      const read = vi.spyOn(request.body!, 'getReader')
      expect((await h.handler(request)).status).toBe(403)
      expect(read).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })
})
