import { randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import {
  canonicalInquiry,
  initialDemoRecord,
  rehearsalNotice,
  reviewOutcomes,
  reviewOutcomeMappings,
  syntheticInquiry,
  validateStudioInquiry,
  type DemoInquiryRecord,
  type DemoPersona,
  type DemoState,
  type InquiryErrors,
} from '../../../src/lib/project-studio-rehearsal'
import { normalize } from '../../../src/lib/rules'
import { bodyText } from './website-intake-protocol.mts'

// Imported only by the private loopback launcher/tests. There is no Function
// entry, production route, DB factory, Identity lookup or outbound transport.
export type StudioRehearsalConfig = {
  origin: string
  mode: string
  environment: Record<string, string | undefined>
  now?: () => number
}
const API = '/api/project-studio-demo'
const COOKIE = 'emerson_studio_demo'
const SESSION_MS = 30 * 60 * 1000
const BODY_LIMIT = 12000
const MAX_SESSIONS = 64
const REQUESTS_PER_MINUTE = 80
const providerVariables = ['NETLIFY', 'CONTEXT', 'DEPLOY_ID', 'SITE_ID']
const personas: Record<
  DemoPersona,
  { role: string; active: boolean; review: boolean; assigned: boolean }
> = {
  guest: { role: 'guest', active: true, review: false, assigned: false },
  client: { role: 'client', active: true, review: false, assigned: true },
  sales: { role: 'manager', active: true, review: true, assigned: true },
  reviewer: { role: 'manager', active: true, review: true, assigned: true },
  viewer: { role: 'viewer', active: true, review: false, assigned: true },
  outsider: {
    role: 'contributor',
    active: true,
    review: false,
    assigned: false,
  },
  inactive: { role: 'manager', active: false, review: false, assigned: false },
}
type Session = {
  token: string
  csrf: string
  persona: DemoPersona
  expires: number
}
type StoredInquiry = {
  record: DemoInquiryRecord
  digest: string
  client: 'client' | 'unassigned'
}
class DemoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: InquiryErrors,
  ) {
    super(message)
  }
}
function deny(status: number, code: string, message: string): never {
  throw new DemoError(status, code, message)
}
const exactKeys = (
  input: unknown,
  keys: string[],
): input is Record<string, unknown> =>
  input !== null &&
  typeof input === 'object' &&
  !Array.isArray(input) &&
  Object.keys(input).length === keys.length &&
  keys.every((key) => Object.hasOwn(input, key))
const csrfEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const safeReason = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length >= 10 &&
  value.length <= 1000 &&
  ![...value].some((character) => character.charCodeAt(0) < 32) &&
  !/[<>]|-----BEGIN|\b(?:password|api[ _-]?key|access[ _-]?token|secret)\s*[:=]\s*\S+/i.test(
    value,
  )

export async function disabledProductionStudioAdapter(
  input: unknown,
): Promise<never> {
  void input
  throw new DemoError(
    403,
    'production-disabled',
    'Production Project Studio integration is disabled. No external operation is available.',
  )
}

export function createStudioRehearsal(config: StudioRehearsalConfig) {
  const now = config.now || Date.now
  const sessions = new Map<string, Session>()
  const inquiries = new Map<string, StoredInquiry>()
  // A fictional, deliberately unassigned fixture tests record isolation. It is
  // never listed for any demonstration persona and cannot be submitted/merged.
  inquiries.set('SYN-PS5-UNASSIGNED', {
    record: initialDemoRecord(
      'SYN-PS5-UNASSIGNED',
      {
        ...syntheticInquiry,
        description:
          'SYNTHETIC unassigned review fixture; protected from the assigned demonstration group.',
      },
      new Date(now()).toISOString(),
      false,
    ),
    digest: 'unassigned-synthetic-fixture',
    client: 'unassigned',
  })
  let rateMinute = -1
  let requestCount = 0
  const configured = () => {
    if (
      config.mode !== 'synthetic-local' ||
      !config.environment ||
      providerVariables.some((name) => Object.hasOwn(config.environment, name))
    )
      return false
    try {
      const origin = new URL(config.origin)
      return (
        /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(config.origin) &&
        origin.origin === config.origin &&
        Number(origin.port) >= 1024 &&
        Number(origin.port) <= 65535
      )
    } catch {
      return false
    }
  }
  const response = (value: unknown, status = 200, session?: Session) => {
    const headers = new Headers({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    })
    if (session)
      headers.set(
        'set-cookie',
        `${COOKIE}=${session.token}; Path=${API}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`,
      )
    return new Response(JSON.stringify(value), { status, headers })
  }
  const createSession = (persona: DemoPersona) => {
    for (const [key, session] of sessions)
      if (session.expires <= now()) sessions.delete(key)
    if (sessions.size >= MAX_SESSIONS)
      deny(
        429,
        'session-limit',
        'Restart the isolated demonstration before opening more sessions.',
      )
    const session: Session = {
      token: randomBytes(32).toString('base64url'),
      csrf: randomBytes(32).toString('base64url'),
      persona,
      expires: now() + SESSION_MS,
    }
    sessions.set(session.token, session)
    return session
  }
  const sessionFrom = (request: Request) => {
    const cookie = request.headers.get('cookie') || ''
    if (cookie.length > 4096) return undefined
    const matches = cookie
      .split(';')
      .map((value) => value.trim())
      .filter((value) => value.startsWith(`${COOKIE}=`))
    if (matches.length !== 1) return undefined
    const token = matches[0].slice(COOKIE.length + 1)
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined
    const session = sessions.get(token)
    if (!session || session.expires <= now()) {
      sessions.delete(token)
      return undefined
    }
    return session
  }
  const canRead = (session: Session, stored: StoredInquiry) => {
    const persona = personas[session.persona]
    return persona.active && persona.assigned && stored.client === 'client'
  }
  const safeRecord = (
    session: Session,
    stored: StoredInquiry,
  ): DemoInquiryRecord => {
    const record = structuredClone(stored.record)
    if (session.persona === 'client') delete record.review
    return record
  }
  const state = (session: Session): DemoState => {
    const persona = personas[session.persona]
    return {
      synthetic: true,
      session: {
        persona: session.persona,
        role: persona.role,
        active: persona.active,
      },
      csrfToken: session.csrf,
      inquiries: [...inquiries.values()]
        .filter((record) => canRead(session, record))
        .map((record) => safeRecord(session, record)),
      notice: rehearsalNotice,
    }
  }

  return async (request: Request): Promise<Response> => {
    try {
      if (!configured())
        deny(
          503,
          'demo-disabled',
          'The isolated Project Studio demonstration is disabled in this runtime.',
        )
      const url = new URL(request.url)
      if (
        url.origin !== config.origin ||
        url.username ||
        url.password ||
        url.hash ||
        ![API, `${API}/session`, `${API}/production`].includes(url.pathname)
      )
        deny(404, 'not-found', 'Demonstration route unavailable.')
      const host = request.headers.get('host')
      if (host && host !== new URL(config.origin).host)
        deny(
          403,
          'origin-denied',
          'Use the configured local demonstration origin.',
        )
      // Forwarded host/protocol headers are never used to construct authority.
      if (
        request.headers.has('forwarded') ||
        request.headers.has('x-forwarded-host') ||
        request.headers.has('x-forwarded-proto')
      )
        deny(
          403,
          'origin-denied',
          'Forwarded demonstration requests are not accepted.',
        )
      const origin = request.headers.get('origin')
      const fetchSite = request.headers.get('sec-fetch-site')
      if (
        (origin && origin !== config.origin) ||
        fetchSite === 'cross-site' ||
        fetchSite === 'same-site'
      )
        deny(
          403,
          'origin-denied',
          'Use the configured local demonstration origin.',
        )
      if (request.method !== 'GET' && request.method !== 'POST')
        deny(
          405,
          'method-denied',
          'This demonstration accepts only GET and POST.',
        )
      if (url.pathname === `${API}/production`)
        await disabledProductionStudioAdapter(undefined)
      const minute = Math.floor(now() / 60000)
      if (minute !== rateMinute) {
        rateMinute = minute
        requestCount = 0
      }
      if (++requestCount > REQUESTS_PER_MINUTE)
        deny(
          429,
          'rate-limited',
          'The demonstration request limit was reached. Try again later.',
        )
      let session = sessionFrom(request)
      if (request.method === 'GET') {
        if (
          url.pathname !== API ||
          [...url.searchParams.keys()].some((key) => key !== 'id') ||
          url.searchParams.getAll('id').length > 1
        )
          deny(404, 'not-found', 'Demonstration route unavailable.')
        if (url.searchParams.has('id')) {
          if (!session)
            deny(
              401,
              'session-required',
              'Start a synthetic demonstration session first.',
            )
          if (!personas[session.persona].active)
            deny(
              403,
              'inactive-session',
              'This simulated membership is inactive.',
            )
          const record = inquiries.get(url.searchParams.get('id') || '')
          if (!record || !canRead(session, record))
            deny(
              404,
              'record-unavailable',
              'The requested synthetic record is unavailable.',
            )
          return response({
            synthetic: true,
            inquiry: safeRecord(session, record),
          })
        }
        if (!session) session = createSession('guest')
        // Inactive personas can see only their own disabled status and switch
        // the rehearsal persona; no protected record is returned.
        return response(state(session), 200, session)
      }
      if (origin !== config.origin || url.search)
        deny(
          403,
          'origin-denied',
          'A same-origin demonstration request is required.',
        )
      if (!session)
        deny(
          401,
          'session-required',
          'Start a synthetic demonstration session first.',
        )
      const csrf = request.headers.get('x-csrf-token') || ''
      if (!/^[A-Za-z0-9_-]{43}$/.test(csrf) || !csrfEqual(csrf, session.csrf))
        deny(
          403,
          'csrf-denied',
          'Refresh the demonstration session before trying again.',
        )
      let body: unknown
      try {
        body = JSON.parse(await bodyText(request, BODY_LIMIT))
      } catch (error) {
        const status =
          typeof error === 'object' &&
          error &&
          'status' in error &&
          error.status === 413
            ? 413
            : 400
        deny(
          status,
          'invalid-request',
          'Use a bounded JSON demonstration request without attachments.',
        )
      }
      if (url.pathname === `${API}/session`) {
        if (
          !exactKeys(body, ['persona']) ||
          typeof body.persona !== 'string' ||
          !Object.hasOwn(personas, body.persona)
        )
          deny(
            400,
            'invalid-persona',
            'Select one of the predefined synthetic personas.',
          )
        const previous = session.token
        session = createSession(body.persona as DemoPersona)
        sessions.delete(previous)
        return response(state(session), 200, session)
      }
      const persona = personas[session.persona]
      if (!persona.active)
        deny(403, 'inactive-session', 'This simulated membership is inactive.')
      if (
        exactKeys(body, ['action', 'submissionId', 'inquiry']) &&
        body.action === 'submit'
      ) {
        if (session.persona !== 'client')
          deny(
            403,
            'role-denied',
            'Only the synthetic client persona can simulate an inquiry.',
          )
        if (
          typeof body.submissionId !== 'string' ||
          !/^SYN-PS5-00[1-8]$/.test(body.submissionId)
        )
          deny(
            400,
            'invalid-id',
            'Use one of the bounded synthetic inquiry identifiers.',
          )
        const checked = validateStudioInquiry(body.inquiry)
        if (!checked.ok)
          throw new DemoError(
            400,
            'invalid-inquiry',
            'Correct the fictional inquiry fields. Nothing was recorded.',
            checked.errors,
          )
        const digest = createHash('sha256')
          .update(canonicalInquiry(checked.value))
          .digest('hex')
        const existing = inquiries.get(body.submissionId)
        if (existing) {
          if (existing.digest !== digest)
            deny(
              409,
              'id-conflict',
              'This synthetic submission identifier already has different content. Review it before continuing.',
            )
          return response({
            ...state(session),
            receipt: existing.record.receipt,
            duplicate: true,
            inquiry: safeRecord(session, existing),
          })
        }
        const potentialDuplicate = [...inquiries.values()].some(
          (item) =>
            item.client === 'client' &&
            normalize(item.record.inquiry.email) ===
              normalize(checked.value.email),
        )
        const record = initialDemoRecord(
          body.submissionId,
          checked.value,
          new Date(now()).toISOString(),
          potentialDuplicate,
        )
        const stored: StoredInquiry = { record, digest, client: 'client' }
        inquiries.set(record.id, stored)
        return response(
          {
            ...state(session),
            receipt: record.receipt,
            duplicate: false,
            inquiry: safeRecord(session, stored),
          },
          201,
        )
      }
      if (
        exactKeys(body, [
          'action',
          'inquiryId',
          'revision',
          'outcome',
          'reason',
        ]) &&
        body.action === 'review'
      ) {
        if (!persona.review || !persona.assigned)
          deny(
            403,
            'role-denied',
            'An assigned synthetic review persona is required.',
          )
        const stored =
          typeof body.inquiryId === 'string'
            ? inquiries.get(body.inquiryId)
            : undefined
        if (!stored || !canRead(session, stored))
          deny(
            404,
            'record-unavailable',
            'The requested synthetic record is unavailable.',
          )
        if (
          !Number.isInteger(body.revision) ||
          body.revision !== stored.record.revision
        )
          deny(
            409,
            'revision-conflict',
            'The synthetic inquiry changed. Refresh before reviewing it.',
          )
        if (
          !reviewOutcomes.some((value) => value === body.outcome) ||
          !safeReason(body.reason)
        )
          deny(
            400,
            'invalid-review',
            'Choose an allowed review outcome and a bounded fictional reason.',
          )
        const outcome = body.outcome as (typeof reviewOutcomes)[number]
        stored.record = {
          ...stored.record,
          revision: stored.record.revision + 1,
          reviewOutcome: outcome,
          reviewMapping: reviewOutcomeMappings[outcome].crmMapping,
          updatedAt: new Date(now()).toISOString(),
          review: {
            reason: body.reason.trim(),
            reviewer: `Simulated ${session.persona}`,
            reviewedAt: new Date(now()).toISOString(),
          },
        }
        return response({
          ...state(session),
          inquiry: safeRecord(session, stored),
        })
      }
      deny(
        400,
        'invalid-action',
        'Use a supported demonstration action without additional fields.',
      )
    } catch (error) {
      if (error instanceof DemoError)
        return response(
          {
            error: {
              code: error.code,
              message: error.message,
              ...(error.fields ? { fields: error.fields } : {}),
            },
          },
          error.status,
        )
      return response(
        {
          error: {
            code: 'demo-error',
            message:
              'The demonstration could not complete this request. No external service was contacted.',
          },
        },
        500,
      )
    }
  }
}
