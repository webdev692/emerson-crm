// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  capture,
  ENDPOINT,
  sha256,
  signedRequest,
  signedResponse,
  verifyRequest,
  verifyResponse,
} from '../../netlify/functions/lib/website-intake-protocol.mts'
import { websiteIntakeAvailable } from '../../netlify/functions/lib/website-intake.mts'
import { createIntakeHandler } from '../test/website-intake/handler.ts'
const secret = randomBytes(32).toString('base64url')
const origin = 'https://synthetic--emerson-crm.netlify.app'
export const fictionalCapture = () => ({
  eventId: randomUUID(),
  synthetic: true as const,
  name: 'PILOT TEST Inquiry',
  email: 'pilot-one@intake.invalid',
  workflow: 'service' as const,
  resourceId: 'PILOT-SERVICE',
})
describe('synthetic intake contract', () => {
  it('exposes capture error statuses only to the validated preview Origin', async () => {
    let result = 'collision'
    const handler = createIntakeHandler(
      { enabled: 'synthetic-preview', origin, secret },
      {
        capture: () => Promise.resolve(result),
        exchange: () => Promise.resolve({}),
      },
    )
    const request = (body: unknown, source = origin, route = 'capture') =>
      new Request(`${ENDPOINT}/${route}`, {
        method: 'POST',
        headers: { origin: source, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    for (const [body, status] of [
      [{ ...fictionalCapture(), email: 'real@example.com' }, 400],
      [fictionalCapture(), 409],
    ] as const) {
      const response = await handler(request(body))
      expect(response.status).toBe(status)
      expect(response.headers.get('access-control-allow-origin')).toBe(origin)
      expect(response.headers.get('vary')).toBe('Origin')
    }
    result = 'rate_limited'
    const limited = await handler(request(fictionalCapture()))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('access-control-allow-origin')).toBe(origin)
    const foreign = await handler(
      request(fictionalCapture(), 'https://foreign.invalid'),
    )
    expect(foreign.status).toBe(403)
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull()
    for (const route of ['pull', 'ack']) {
      const denied = await handler(request({}, origin, route))
      expect(denied.status).toBe(401)
      expect(denied.headers.get('access-control-allow-origin')).toBeNull()
      expect(denied.headers.get('x-intake-signature')).toBeNull()
    }
  })
  it('keeps the CRM and captured producer protocol identical', async () => {
    const crm = await readFile(
      new URL(
        '../../netlify/functions/lib/website-intake-protocol.mts',
        import.meta.url,
      ),
      'utf8',
    )
    const source = await readFile(
      new URL('../test/website-intake/protocol.ts', import.meta.url),
      'utf8',
    )
    expect(source.replace(/\r\n/g, '\n')).toBe(crm.replace(/\r\n/g, '\n'))
  })
  it('normalizes only exact public/function-name routes and signs the fixed public destination', async () => {
    let exchanges = 0
    const handler = createIntakeHandler(
      { enabled: 'synthetic-preview', origin, secret },
      {
        capture: async () => {
          throw Error('No capture expected')
        },
        exchange: async () => {
          exchanges++
          return { events: [] }
        },
      },
    )
    const paths = [
      ENDPOINT.replace('/functions/v1', ''),
      'http://functions:9000/website-intake-synthetic',
      'http://edge-runtime:9000/website-intake-synthetic',
    ]
    for (const path of paths) {
      const canonical = await signedRequest('pull', { limit: 20 }, secret)
      const runtime = new Request(path + '/pull', {
        method: 'POST',
        headers: canonical.headers,
        body: await canonical.clone().text(),
      })
      const response = await handler(runtime)
      expect(response.status).toBe(200)
      expect(await verifyResponse(canonical, response, secret)).toEqual({
        events: [],
      })
    }
    expect(exchanges).toBe(3)
    for (const url of [
      ENDPOINT + '/pull?extra=1',
      ENDPOINT + '/pull/extra',
      'http://functions:9000/unrelated/pull',
      'https://attacker.invalid/website-intake-synthetic/pull',
    ]) {
      const canonical = await signedRequest('pull', { limit: 20 }, secret)
      const response = await handler(
        new Request(url, {
          method: 'POST',
          headers: canonical.headers,
          body: await canonical.text(),
        }),
      )
      expect(response.status).toBeGreaterThanOrEqual(400)
    }
    expect(exchanges).toBe(3)
  })
  it('strictly rejects real email, HR workflows, hidden fields and ordinary names', () => {
    for (const change of [
      { email: 'someone@example.com' },
      { workflow: 'program' },
      { resumeUrl: 'https://example.invalid' },
      { name: 'Ordinary Name' },
      { synthetic: false },
    ])
      expect(() => capture({ ...fictionalCapture(), ...change })).toThrow()
  })
  it('binds requests to exact method, project, route, body and fresh timestamp', async () => {
    const req = await signedRequest('pull', { limit: 20 }, secret)
    const body = await req.clone().text()
    expect(await verifyRequest(req, body, secret)).toBe(
      req.headers.get('x-intake-nonce'),
    )
    await expect(verifyRequest(req, body + ' ', secret)).rejects.toThrow()
    await expect(
      verifyRequest(
        new Request(
          req.url.replace('gqlyofoazfkumirhbnmc', 'otherproject'),
          req,
        ),
        body,
        secret,
      ),
    ).rejects.toThrow()
    await expect(
      verifyRequest(req, body, secret, Math.floor(Date.now() / 1000) + 121),
    ).rejects.toThrow()
    await expect(
      verifyRequest(req, body, randomBytes(32).toString('base64url')),
    ).rejects.toThrow()
  })
  it('binds signed responses to the originating request nonce and body', async () => {
    const req = await signedRequest('pull', { limit: 20 }, secret)
    const res = await signedResponse(req, { events: [] }, secret)
    expect(await verifyResponse(req, res.clone(), secret)).toEqual({
      events: [],
    })
    await expect(
      verifyResponse(
        await signedRequest('pull', { limit: 20 }, secret),
        res.clone(),
        secret,
      ),
    ).rejects.toThrow()
    await expect(
      verifyResponse(
        req,
        new Response('{"events":[1]}', { headers: res.headers }),
        secret,
      ),
    ).rejects.toThrow()
  })
  it('fails closed outside the exact unpublished preview and clears no gates by default', () => {
    const values: Record<string, string> = {
      CRM_WEBSITE_INTAKE_MODE: 'synthetic-preview',
      CRM_WEBSITE_INTAKE_PREVIEW_ORIGIN: origin,
      CRM_WEBSITE_INTAKE_HMAC_KEY: secret,
    }
    const env = (name: string) => values[name]
    expect(
      websiteIntakeAvailable(new Request(origin), env, {
        context: 'branch-deploy',
        published: false,
      }),
    ).toBe(true)
    expect(
      websiteIntakeAvailable(new Request(origin), env, {
        context: 'production',
        published: true,
      }),
    ).toBe(false)
    expect(
      websiteIntakeAvailable(
        new Request('https://emerson-crm.netlify.app'),
        env,
        { context: 'branch-deploy', published: false },
      ),
    ).toBe(false)
    expect(
      websiteIntakeAvailable(new Request(origin), () => undefined, {
        context: 'branch-deploy',
        published: false,
      }),
    ).toBe(false)
  })
  it('rejects non-preview origins, oversize requests and invalid captures before storage', async () => {
    let writes = 0
    const handler = createIntakeHandler(
      { enabled: 'synthetic-preview', origin, secret },
      {
        capture: async () => {
          writes++
          return 'inserted'
        },
        exchange: async () => ({}),
      },
    )
    const request = (body: unknown, source = origin) =>
      new Request(`${ENDPOINT}/capture`, {
        method: 'POST',
        headers: { origin: source, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect(
      (
        await handler(
          request(fictionalCapture(), 'https://emerson-crm.netlify.app'),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await handler(
          request({ ...fictionalCapture(), email: 'real@example.com' }),
        )
      ).status,
    ).toBe(400)
    expect((await handler(request({ message: 'x'.repeat(5000) }))).status).toBe(
      413,
    )
    expect(writes).toBe(0)
    const payload = fictionalCapture()
    const stored = await handler(request(payload))
    expect(stored.status).toBe(201)
    expect(await stored.json()).toEqual({
      receipt: payload.eventId,
      synthetic: true,
    })
    expect(await sha256(JSON.stringify(capture(payload)))).toMatch(
      /^[a-f0-9]{64}$/,
    )
  })
})
