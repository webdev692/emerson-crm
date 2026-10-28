// @vitest-environment node
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FIXTURE_IDS,
  SYNTHETIC_HANDOFF,
  parseEducationDecision,
  parseRawEducationDecision,
  serializeDecision,
  signSyntheticEducationAttempt,
} from '../../netlify/functions/lib/education-handoff.mts'
import {
  parseEducationReceipt,
  sendSyntheticEducationAttempt,
} from '../../netlify/functions/lib/education-transport.mts'
import type {
  EducationDecisionBody,
  SignEducationAttemptInput,
} from '../../netlify/functions/lib/education-handoff.mts'
import type { EducationReceipt } from '../../netlify/functions/lib/education-transport.mts'

const http = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('node:http', () => ({ request: http.request }))

const now = Date.parse('2026-10-24T18:00:00.000Z')
const gate = { enabled: '1', environment: 'synthetic-local' } as const
const keyBase64url = randomBytes(32).toString('base64url')

function decision(): EducationDecisionBody {
  return {
    version: 1,
    source: SYNTHETIC_HANDOFF.source,
    environment: SYNTHETIC_HANDOFF.environment,
    event_id: randomUUID(),
    person_id: FIXTURE_IDS.personId,
    application_id: FIXTURE_IDS.applicationId,
    program_id: FIXTURE_IDS.crmProgramId,
    decision_id: randomUUID(),
    decision_version: 1,
    decision: 'cleared',
    issued_at: new Date(now).toISOString(),
    policy_version: SYNTHETIC_HANDOFF.policyVersion,
    reviewer_id: FIXTURE_IDS.reviewerId,
    clearance: {
      identity_verified: true,
      onboarding_complete: true,
      agreements_complete: true,
      hr_approved: true,
    },
    withdrawn: false,
  }
}
function signingInput(
  body = decision(),
  overrides: Partial<SignEducationAttemptInput> = {},
): SignEducationAttemptInput {
  return {
    rawBody: serializeDecision(body, { now }),
    timestamp: Math.floor(now / 1000),
    nonce: randomUUID(),
    keyBase64url,
    target: SYNTHETIC_HANDOFF.target,
    gate,
    now,
    ...overrides,
  }
}
function receipt(body: EducationDecisionBody): EducationReceipt {
  return {
    success: true,
    environment: 'synthetic-local',
    event_id: body.event_id,
    result: 'accepted',
    received_at: new Date(now).toISOString(),
    current_status: 'ready',
    decision_version: body.decision_version,
  }
}

beforeEach(() => http.request.mockReset())

describe('minimal synthetic decision protocol', () => {
  it('serializes a fixed allowlist without source evidence or personnel details', () => {
    const body = decision()
    const reversed = Object.fromEntries(Object.entries(body).reverse())
    const rawBody = serializeDecision(reversed, { now })
    expect(rawBody).toBe(JSON.stringify(body))
    expect(parseRawEducationDecision(rawBody, { now })).toEqual(body)
    expect(Object.keys(JSON.parse(rawBody))).toEqual(Object.keys(body))
    expect(rawBody).not.toMatch(/email|resume|notes|sourceVersion|credentials/)
  })

  it.each(['email', 'name', 'resumeUrl', 'sourceVersion', 'onboardingStatus'])(
    'rejects extra private or authority fields (%s)',
    (field) => {
      expect(() =>
        serializeDecision({ ...decision(), [field]: 'not exported' }, { now }),
      ).toThrow('Unexpected decision fields')
    },
  )

  it('rejects inherited, accessor, symbol and missing properties', () => {
    const body = decision()
    const inherited = Object.assign(Object.create({ extra: true }), body)
    expect(() => serializeDecision(inherited, { now })).toThrow(
      'Invalid decision',
    )
    const accessor = { ...body }
    Object.defineProperty(accessor, 'reviewer_id', {
      enumerable: true,
      get: () => FIXTURE_IDS.reviewerId,
    })
    expect(() => serializeDecision(accessor, { now })).toThrow(
      'Unexpected decision fields',
    )
    expect(() =>
      serializeDecision({ ...body, [Symbol('hidden')]: true }, { now }),
    ).toThrow('Unexpected decision fields')
    const { clearance: unused, ...missing } = body
    expect(unused).toBeDefined()
    expect(() => serializeDecision(missing, { now })).toThrow(
      'Unexpected decision fields',
    )
  })

  it.each(['person_id', 'application_id', 'program_id'] as const)(
    'rejects a nonfixture mapping (%s)',
    (field) => {
      expect(() =>
        serializeDecision({ ...decision(), [field]: randomUUID() }, { now }),
      ).toThrow('Only the fixed synthetic mapping')
    },
  )

  it('accepts another authenticated reviewer UUID without impersonating the original reviewer', () => {
    const body = {
      ...decision(),
      reviewer_id: randomUUID(),
      decision: 'revoked' as const,
    }
    expect(parseEducationDecision(body, { now }).reviewer_id).toBe(
      body.reviewer_id,
    )
  })

  it.each(['event_id', 'decision_id', 'reviewer_id'] as const)(
    'rejects invalid UUIDs (%s)',
    (field) => {
      expect(() =>
        serializeDecision({ ...decision(), [field]: 'not-a-uuid' }, { now }),
      ).toThrow(`Invalid ${field}`)
    },
  )

  it.each([0, -1, 1.5, 1000001, Number.NaN, Number.POSITIVE_INFINITY, '1'])(
    'rejects unsafe decision version %s',
    (decision_version) => {
      expect(() =>
        serializeDecision({ ...decision(), decision_version }, { now }),
      ).toThrow('Invalid decision version')
    },
  )

  it.each([
    ['version', 2],
    ['source', 'emerson-crm'],
    ['environment', 'production'],
    ['policy_version', 'real-onboarding-v1'],
    ['decision', 'Active'],
    ['withdrawn', 'false'],
  ])('rejects invalid constant or authority %s', (field, value) => {
    expect(() =>
      serializeDecision({ ...decision(), [field]: value }, { now }),
    ).toThrow()
  })

  it.each([
    'identity_verified',
    'onboarding_complete',
    'agreements_complete',
    'hr_approved',
  ] as const)('cleared requires a true boolean %s', (field) => {
    const body = decision()
    expect(() =>
      serializeDecision(
        { ...body, clearance: { ...body.clearance, [field]: false } },
        { now },
      ),
    ).toThrow('Cleared requires current complete clearance')
    expect(() =>
      serializeDecision(
        { ...body, clearance: { ...body.clearance, [field]: 'true' } },
        { now },
      ),
    ).toThrow('Invalid clearance boolean')
    const { [field]: removed, ...missing } = body.clearance
    expect(removed).toBe(true)
    expect(() =>
      serializeDecision({ ...body, clearance: missing }, { now }),
    ).toThrow('Unexpected clearance fields')
  })

  it('keeps holds/revocations distinct from clearance and rejects withdrawn approval', () => {
    const body = decision()
    expect(() =>
      serializeDecision({ ...body, withdrawn: true }, { now }),
    ).toThrow('Cleared requires current complete clearance')
    for (const value of ['held', 'revoked'] as const)
      expect(
        parseEducationDecision(
          { ...body, decision: value, withdrawn: true },
          { now },
        ).decision,
      ).toBe(value)
    expect(() =>
      serializeDecision(
        { ...body, clearance: { ...body.clearance, stage: 'Active' } },
        { now },
      ),
    ).toThrow('Unexpected clearance fields')
  })

  it('requires canonical and fresh issue time; exact retries allow old bodies only', () => {
    const body = decision()
    for (const issued_at of [
      'not-a-date',
      '2026-10-24T18:00:00Z',
      '2026-10-24T14:00:00.000-04:00',
    ])
      expect(() => serializeDecision({ ...body, issued_at }, { now })).toThrow(
        'Invalid decision timestamp',
      )
    const old = { ...body, issued_at: new Date(now - 300001).toISOString() }
    expect(() => serializeDecision(old, { now })).toThrow('permitted window')
    expect(serializeDecision(old, { now, allowExactRetry: true })).toContain(
      old.issued_at,
    )
    const future = { ...body, issued_at: new Date(now + 30001).toISOString() }
    expect(() =>
      serializeDecision(future, { now, allowExactRetry: true }),
    ).toThrow('permitted window')
    expect(() => serializeDecision(body, { now: Number.NaN })).toThrow(
      'Invalid clock',
    )
  })

  it('rejects ambiguous JSON and byte limits before signing', () => {
    const raw = serializeDecision(decision(), { now })
    expect(() => parseRawEducationDecision(` ${raw}`, { now })).toThrow(
      'not canonical',
    )
    expect(() =>
      parseRawEducationDecision(
        raw.replace('"version":1', '"version":1,"version":1'),
        { now },
      ),
    ).toThrow('not canonical')
    expect(() => parseRawEducationDecision('{', { now })).toThrow(
      'Invalid decision JSON',
    )
    expect(() => parseRawEducationDecision(' '.repeat(8193), { now })).toThrow(
      'too large',
    )
  })
})

describe('explicit synthetic signing', () => {
  it('matches independent HMAC of decoded key and exact raw bytes, without retaining the key', () => {
    const input = signingInput()
    const signed = signSyntheticEducationAttempt(input)
    const digest = createHash('sha256')
      .update(input.rawBody, 'utf8')
      .digest('hex')
    const independent = `EPDG-CRM-HANDOFF-V1\nPOST\n/internal/crm/onboarding-handoffs\n${input.timestamp}\n${input.nonce}\n${digest}`
    expect(signed.headers['X-EPDG-Handoff-Signature']).toBe(
      createHmac('sha256', Buffer.from(keyBase64url, 'base64url'))
        .update(independent)
        .digest('hex'),
    )
    expect(signed.headers['X-EPDG-Handoff-Signature']).not.toBe(
      createHmac('sha256', keyBase64url).update(independent).digest('hex'),
    )
    expect(signed.rawBody).toBe(input.rawBody)
    expect(signed.headers['Content-Length']).toBe(
      String(Buffer.byteLength(input.rawBody)),
    )
    expect(JSON.stringify(signed)).not.toContain(keyBase64url)
    expect(Object.isFrozen(signed)).toBe(true)
    expect(Object.isFrozen(signed.headers)).toBe(true)
  })

  it.each([
    undefined,
    {},
    { enabled: '0', environment: 'synthetic-local' },
    { enabled: '1', environment: 'production' },
    { ...gate, extra: true },
  ])('defaults closed for invalid or disabled gates %j', (value) =>
    expect(() =>
      signSyntheticEducationAttempt(signingInput(undefined, { gate: value })),
    ).toThrow(),
  )

  it.each([
    'https://127.0.0.1:58000/internal/crm/onboarding-handoffs',
    'http://localhost:58000/internal/crm/onboarding-handoffs',
    'http://127.0.0.1:58001/internal/crm/onboarding-handoffs',
    'http://127.0.0.1:58000/internal/crm/onboarding-handoffs?x=1',
    'https://emerson-crm.netlify.app/internal/crm/onboarding-handoffs',
  ])('rejects alternate target %s', (target) => {
    expect(() =>
      signSyntheticEducationAttempt(signingInput(undefined, { target })),
    ).toThrow('Invalid handoff target')
  })

  it('rejects malformed key encoding, noncanonical padding and nonce', () => {
    for (const key of ['', 'a'.repeat(42), `${keyBase64url}=`, 'a'.repeat(43)])
      expect(() =>
        signSyntheticEducationAttempt(
          signingInput(undefined, { keyBase64url: key }),
        ),
      ).toThrow('Invalid handoff key encoding')
    expect(() =>
      signSyntheticEducationAttempt(signingInput(undefined, { nonce: 'x' })),
    ).toThrow('Invalid transport nonce')
  })

  it('requires fresh transport even for an old exact retry and binds fresh nonce', () => {
    const old = {
      ...decision(),
      issued_at: new Date(now - 86400000).toISOString(),
    }
    const rawBody = serializeDecision(old, { now, allowExactRetry: true })
    const first = signSyntheticEducationAttempt(
      signingInput(undefined, { rawBody, allowExactRetry: true }),
    )
    const retry = signSyntheticEducationAttempt(
      signingInput(undefined, { rawBody, allowExactRetry: true }),
    )
    expect(first.rawBody).toBe(retry.rawBody)
    expect(first.headers['X-EPDG-Handoff-Signature']).not.toBe(
      retry.headers['X-EPDG-Handoff-Signature'],
    )
    expect(() =>
      signSyntheticEducationAttempt(signingInput(undefined, { rawBody })),
    ).toThrow('Decision timestamp')
    expect(() =>
      signSyntheticEducationAttempt(
        signingInput(undefined, {
          now: now + 1,
          timestamp: now / 1000 - 300,
        }),
      ),
    ).toThrow(/transport timestamp/i)
    for (const timestamp of [
      now / 1000 - 301,
      now / 1000 + 31,
      1.5,
      Number.NaN,
    ])
      expect(() =>
        signSyntheticEducationAttempt(
          signingInput(undefined, {
            rawBody,
            allowExactRetry: true,
            timestamp,
          }),
        ),
      ).toThrow(/transport timestamp/i)
  })
})

type FakeResponse = PassThrough & {
  statusCode: number
  headers: Record<string, string>
}
function fakeReceiver(
  status: number,
  rawResponse: string,
  contentType = 'application/json',
) {
  const request = new EventEmitter() as EventEmitter & {
    end: ReturnType<typeof vi.fn>
    setTimeout: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }
  request.setTimeout = vi.fn(() => request)
  request.destroy = vi.fn()
  request.end = vi.fn()
  let response: FakeResponse
  http.request.mockImplementation(
    (_options, callback: (response: FakeResponse) => void) => {
      response = new PassThrough() as FakeResponse
      response.statusCode = status
      response.headers = { 'content-type': contentType }
      request.end.mockImplementation(() => {
        queueMicrotask(() => {
          callback(response)
          response.end(rawResponse)
        })
      })
      return request
    },
  )
  return request
}

describe('fixed local transport and receipt verification', () => {
  it('sends exact raw bytes with raw node:http and only contract headers', async () => {
    const body = decision()
    const signed = signSyntheticEducationAttempt(signingInput(body))
    const req = fakeReceiver(200, JSON.stringify(receipt(body)))
    expect(await sendSyntheticEducationAttempt(signed, { gate, now })).toEqual(
      receipt(body),
    )
    expect(http.request).toHaveBeenCalledOnce()
    expect(http.request.mock.calls[0][0]).toEqual({
      hostname: '127.0.0.1',
      port: 58000,
      method: 'POST',
      path: SYNTHETIC_HANDOFF.path,
      headers: signed.headers,
      agent: false,
    })
    expect(req.end).toHaveBeenCalledWith(signed.rawBody, 'utf8')
    expect(Object.keys(signed.headers)).not.toContain('Authorization')
    expect(Object.keys(signed.headers)).not.toContain('Sec-Fetch-Mode')
  })

  it('returns the current revoked/held state on an older cleared duplicate', async () => {
    const body = decision()
    const current = {
      ...receipt(body),
      result: 'duplicate' as const,
      current_status: 'held' as const,
      decision_version: 2,
    }
    fakeReceiver(200, JSON.stringify(current))
    const result = await sendSyntheticEducationAttempt(
      signSyntheticEducationAttempt(signingInput(body)),
      { gate, now },
    )
    expect(result).toEqual(current)
    expect(result.current_status).not.toBe('ready')
  })

  it('preserves receiver semantics: revoked is withdrawn even without the separate withdrawal flag', async () => {
    const body = {
      ...decision(),
      decision: 'revoked' as const,
      withdrawn: false,
    }
    const current = { ...receipt(body), current_status: 'withdrawn' as const }
    fakeReceiver(200, JSON.stringify(current))
    expect(
      await sendSyntheticEducationAttempt(
        signSyntheticEducationAttempt(signingInput(body)),
        { gate, now },
      ),
    ).toEqual(current)
  })

  it('rejects disabled gates and tampered target/headers before any request', async () => {
    const signed = signSyntheticEducationAttempt(signingInput())
    await expect(
      sendSyntheticEducationAttempt(signed, { gate: undefined, now }),
    ).rejects.toThrow()
    await expect(
      sendSyntheticEducationAttempt(
        {
          ...signed,
          target: 'https://example.invalid/' as typeof signed.target,
        },
        { gate, now },
      ),
    ).rejects.toThrow('Invalid handoff target')
    for (const header of [
      'Origin',
      'Cookie',
      'Authorization',
      'X-EPDG-Request',
      'Sec-Fetch-Mode',
      'Forwarded',
      'X-Forwarded-For',
    ])
      await expect(
        sendSyntheticEducationAttempt(
          { ...signed, headers: { ...signed.headers, [header]: 'denied' } },
          { gate, now },
        ),
      ).rejects.toThrow('Unexpected transport headers')
    expect(http.request).not.toHaveBeenCalled()
  })

  it.each([301, 302, 307, 308, 401, 409, 503])(
    'rejects status %s without following a redirect',
    async (status) => {
      const body = decision()
      fakeReceiver(status, JSON.stringify(receipt(body)))
      await expect(
        sendSyntheticEducationAttempt(
          signSyntheticEducationAttempt(signingInput(body)),
          { gate, now },
        ),
      ).rejects.toThrow('receiver rejected')
      expect(http.request).toHaveBeenCalledOnce()
    },
  )

  it('rejects malformed, oversized, contradictory and stale receipts', async () => {
    const body = decision()
    const values = [
      '{',
      'x'.repeat(8193),
      JSON.stringify({
        ...receipt(body),
        email: 'never-returned@fixture.invalid',
      }),
      JSON.stringify({ ...receipt(body), event_id: randomUUID() }),
      JSON.stringify({ ...receipt(body), decision_version: 0 }),
      JSON.stringify({ ...receipt(body), decision_version: 2 }),
      JSON.stringify({ ...receipt(body), current_status: 'held' }),
      JSON.stringify({ ...receipt(body), received_at: '2026-10-24T18:00:00Z' }),
    ]
    for (const value of values) {
      fakeReceiver(200, value)
      await expect(
        sendSyntheticEducationAttempt(
          signSyntheticEducationAttempt(signingInput(body)),
          { gate, now },
        ),
      ).rejects.toThrow()
    }
    fakeReceiver(200, JSON.stringify(receipt(body)), 'text/html')
    await expect(
      sendSyntheticEducationAttempt(
        signSyntheticEducationAttempt(signingInput(body)),
        { gate, now },
      ),
    ).rejects.toThrow('receiver rejected')
  })

  it('rejects transport errors, aborted responses and timeouts without leaking error data', async () => {
    const signed = signSyntheticEducationAttempt(signingInput())
    const req = fakeReceiver(200, '{}')
    http.request.mockImplementation(() => req)
    req.end.mockImplementation(() =>
      queueMicrotask(() => req.emit('error', new Error(keyBase64url))),
    )
    await expect(
      sendSyntheticEducationAttempt(signed, { gate, now }),
    ).rejects.toThrow('Education transport failed')
    req.end.mockImplementation(() =>
      queueMicrotask(() => req.setTimeout.mock.calls.at(-1)?.[1]()),
    )
    await expect(
      sendSyntheticEducationAttempt(signed, { gate, now }),
    ).rejects.toThrow('Education transport timed out')
    expect(req.destroy).toHaveBeenCalled()
    http.request.mockImplementation(
      (_options, callback: (response: FakeResponse) => void) => {
        req.end.mockImplementation(() =>
          queueMicrotask(() => {
            const response = new PassThrough() as FakeResponse
            response.statusCode = 200
            response.headers = { 'content-type': 'application/json' }
            callback(response)
            response.emit('aborted')
          }),
        )
        return req
      },
    )
    await expect(
      sendSyntheticEducationAttempt(signed, { gate, now }),
    ).rejects.toThrow('Education receipt aborted')
  })

  it('validates receipt revision independently without inferring cleared from duplicates', () => {
    const body = decision()
    const current = {
      ...receipt(body),
      result: 'duplicate',
      current_status: 'withdrawn',
      decision_version: 3,
    }
    expect(
      parseEducationReceipt(current, {
        eventId: body.event_id,
        minimumDecisionVersion: 2,
      }).current_status,
    ).toBe('withdrawn')
    expect(() =>
      parseEducationReceipt(receipt(body), {
        eventId: body.event_id,
        minimumDecisionVersion: 2,
      }),
    ).toThrow('stale education receipt')
  })
})
