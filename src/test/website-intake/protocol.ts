// Portable Web Crypto contract. Mirrored in the Supabase mail-free function.
export const PROJECT = 'gqlyofoazfkumirhbnmc'
export const AUDIENCE = 'emerson-crm:website-intake:synthetic:v1'
const FUNCTION_PATH = '/functions/v1/website-intake-synthetic'
export const ENDPOINT = `https://${PROJECT}.supabase.co${FUNCTION_PATH}`
// Kong may strip /functions/v1 before the Edge runtime calls the handler. Only
// these exact routes and bounded runtime hosts map to the compiled public URL.
// Forwarded host/proto headers never participate in authorization or signing.
export function intakeRoute(value: string) {
  const url = new URL(value)
  check(
    !url.search && !url.hash && !url.username && !url.password,
    'Unknown intake route',
    404,
  )
  check(['http:', 'https:'].includes(url.protocol), 'Unknown intake route', 404)
  for (const operation of ['capture', 'pull', 'ack'] as const) {
    if (url.pathname === `${FUNCTION_PATH}/${operation}`) {
      check(
        url.origin === `https://${PROJECT}.supabase.co`,
        'Wrong intake destination',
        401,
      )
      return { operation, canonicalUrl: `${ENDPOINT}/${operation}` }
    }
    if (url.pathname === `/website-intake-synthetic/${operation}`) {
      check(
        [
          `${PROJECT}.supabase.co`,
          'functions',
          'edge-runtime',
          'localhost',
          '127.0.0.1',
          '0.0.0.0',
        ].includes(url.hostname),
        'Wrong intake runtime',
        401,
      )
      return { operation, canonicalUrl: `${ENDPOINT}/${operation}` }
    }
  }
  check(false, 'Unknown intake route', 404)
}
export const SOURCE = 'Website synthetic capture v1'
export const MAX_BODY = 32768
export const workflows = [
  'service',
  'class',
  'partner',
  'college',
  'investor',
] as const
export type Capture = {
  eventId: string
  synthetic: true
  name: string
  email: string
  workflow: (typeof workflows)[number]
  resourceId: string
}
export type Event = { eventId: string; payloadHash: string; payload: Capture }
export function check(
  value: unknown,
  message: string,
  status = 400,
): asserts value {
  if (!value) throw Object.assign(new Error(message), { status })
}
export const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    v,
  )
export const hash = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
export function object(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  check(
    value && typeof value === 'object' && !Array.isArray(value),
    'Object required',
  )
  check(
    Object.keys(value).length === keys.length &&
      keys.every((k) => Object.hasOwn(value, k)),
    'Unexpected fields',
  )
}
export function capture(value: unknown): Capture {
  object(value, [
    'eventId',
    'synthetic',
    'name',
    'email',
    'workflow',
    'resourceId',
  ])
  check(
    uuid(value.eventId) && value.synthetic === true,
    'Synthetic event UUID required',
  )
  check(
    typeof value.name === 'string' &&
      /^PILOT TEST [A-Za-z0-9 -]{1,60}$/.test(value.name),
    'Synthetic name required',
  )
  check(
    typeof value.email === 'string' &&
      /^pilot-[a-z0-9-]{1,50}@intake\.invalid$/.test(value.email),
    'Only synthetic .invalid addresses accepted',
  )
  check(
    workflows.some((v) => v === value.workflow),
    'Only non-HR synthetic workflows accepted',
  )
  check(
    typeof value.resourceId === 'string' &&
      /^PILOT-[A-Z0-9-]{1,40}$/.test(value.resourceId),
    'Synthetic resource required',
  )
  return {
    eventId: value.eventId,
    synthetic: true,
    name: value.name,
    email: value.email,
    workflow: value.workflow as Capture['workflow'],
    resourceId: value.resourceId,
  }
}
const encode = (v: string) => new TextEncoder().encode(v)
export async function sha256(value: string) {
  return [
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', encode(value))),
  ]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
}
export async function bodyText(message: Request | Response, limit = MAX_BODY) {
  check(
    message.headers.get('content-type')?.split(';')[0] === 'application/json',
    'JSON required',
  )
  const reader = message.body?.getReader()
  check(reader, 'Body required')
  let length = 0
  const parts: Uint8Array[] = []
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      check(length <= limit, 'Body too large', 413)
      parts.push(part.value)
    }
  } catch (error) {
    await reader.cancel()
    throw error
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
function signingKey(secret: string) {
  check(/^[A-Za-z0-9_-]{43}$/.test(secret), 'Integration unavailable', 503)
  const raw = Uint8Array.from(
    atob(secret.replace(/-/g, '+').replace(/_/g, '/') + '='),
    (v) => v.charCodeAt(0),
  )
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}
const signatureBytes = (value: string) =>
  Uint8Array.from(value.match(/../g) || [], (v) => parseInt(v, 16))
async function sign(secret: string, value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.sign('HMAC', await signingKey(secret), encode(value)),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
}
async function verify(secret: string, value: string, signature: string) {
  return (
    hash(signature) &&
    crypto.subtle.verify(
      'HMAC',
      await signingKey(secret),
      signatureBytes(signature),
      encode(value),
    )
  )
}
const canonical = (
  direction: string,
  url: string,
  status: string,
  timestamp: string,
  nonce: string,
  digest: string,
) =>
  [direction, url, status, PROJECT, AUDIENCE, timestamp, nonce, digest].join(
    '\n',
  )
function envelope(headers: Headers, now: number) {
  const timestamp = headers.get('x-intake-timestamp') || ''
  const nonce = headers.get('x-intake-nonce') || ''
  check(
    /^\d{10}$/.test(timestamp) &&
      Math.abs(now - Number(timestamp)) <= 120 &&
      uuid(nonce),
    'Stale or invalid envelope',
    401,
  )
  return {
    timestamp,
    nonce,
    signature: headers.get('x-intake-signature') || '',
  }
}
export async function signedRequest(
  op: 'pull' | 'ack',
  data: unknown,
  secret: string,
  now = Math.floor(Date.now() / 1000),
) {
  const url = `${ENDPOINT}/${op}`
  const body = JSON.stringify(data)
  const timestamp = String(now),
    nonce = crypto.randomUUID()
  const signature = await sign(
    secret,
    canonical('request-v1', url, 'POST', timestamp, nonce, await sha256(body)),
  )
  return new Request(url, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-intake-timestamp': timestamp,
      'x-intake-nonce': nonce,
      'x-intake-signature': signature,
    },
  })
}
export async function verifyRequest(
  req: Request,
  body: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
) {
  const route = intakeRoute(req.url)
  check(
    req.method === 'POST' && ['pull', 'ack'].includes(route.operation),
    'Wrong intake destination',
    401,
  )
  const e = envelope(req.headers, now)
  check(
    await verify(
      secret,
      canonical(
        'request-v1',
        route.canonicalUrl,
        req.method,
        e.timestamp,
        e.nonce,
        await sha256(body),
      ),
      e.signature,
    ),
    'Invalid intake signature',
    401,
  )
  return e.nonce
}
export async function signedResponse(
  req: Request,
  data: unknown,
  secret: string,
  status = 200,
  now = Math.floor(Date.now() / 1000),
) {
  const body = JSON.stringify(data),
    timestamp = String(now),
    nonce = req.headers.get('x-intake-nonce') || ''
  const signature = await sign(
    secret,
    canonical(
      'response-v1',
      intakeRoute(req.url).canonicalUrl,
      String(status),
      timestamp,
      nonce,
      await sha256(body),
    ),
  )
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-intake-timestamp': timestamp,
      'x-intake-nonce': nonce,
      'x-intake-signature': signature,
    },
  })
}
export async function verifyResponse(
  req: Request,
  res: Response,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Promise<unknown> {
  check(!res.redirected && res.status === 200, 'Intake source unavailable', 502)
  const body = await bodyText(res)
  const e = envelope(res.headers, now)
  check(
    e.nonce === req.headers.get('x-intake-nonce') &&
      (await verify(
        secret,
        canonical(
          'response-v1',
          intakeRoute(req.url).canonicalUrl,
          String(res.status),
          e.timestamp,
          e.nonce,
          await sha256(body),
        ),
        e.signature,
      )),
    'Invalid intake response',
    502,
  )
  return JSON.parse(body)
}
export async function events(value: unknown): Promise<Event[]> {
  object(value, ['events'])
  check(
    Array.isArray(value.events) && value.events.length <= 20,
    'Invalid intake batch',
    502,
  )
  const seen = new Set<string>()
  const result: Event[] = []
  for (const raw of value.events) {
    object(raw, ['eventId', 'payloadHash', 'payload'])
    const payload = capture(raw.payload)
    check(
      raw.eventId === payload.eventId &&
        hash(raw.payloadHash) &&
        raw.payloadHash === (await sha256(JSON.stringify(payload))) &&
        !seen.has(payload.eventId),
      'Invalid intake event',
      502,
    )
    seen.add(payload.eventId)
    result.push({
      eventId: payload.eventId,
      payloadHash: raw.payloadHash,
      payload,
    })
  }
  return result
}
