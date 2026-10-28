import { createHash, createHmac } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import profileJson from './education-hosted-profile.json'
import {
  FIXTURE_IDS,
  SYNTHETIC_HANDOFF,
  assertTransportTimestamp,
  checkedNow,
  exactObject,
  isProtocolUuid,
  parseEducationDecision,
  protocolCheck,
} from './education-handoff.mts'
import { parseEducationReceipt } from './education-transport.mts'
import type {
  DecisionValidationOptions,
  EducationDecisionBody,
} from './education-handoff.mts'
import type { EducationMember } from './education-policy.mts'

export const HOSTED_EDUCATION = Object.freeze({
  environment: 'synthetic-hosted',
  keyId: 'synthetic-hosted-v1',
  path: '/internal/crm/onboarding-handoffs',
  signingDomain: 'EPDG-CRM-HOSTED-PRACTICE-V1',
  siteId: 'c83673f3-4449-4ede-b336-33bb3d816de8',
  bodyLimitBytes: 8192,
} as const)
export interface HostedEducationProfile {
  readonly version: 1
  readonly enabled: true
  readonly environment: 'synthetic-hosted'
  readonly siteId: typeof HOSTED_EDUCATION.siteId
  readonly crmOrigin: string
  readonly backendOrigin: string
  readonly databaseName: string
  readonly databaseIdentity: string
  readonly fixtureSourceKey: string
  readonly reviewers: readonly {
    readonly memberIdSha256: string
    readonly identitySha256: string
  }[]
}
export type HostedDecisionBody = Omit<EducationDecisionBody, 'environment'> & {
  environment: 'synthetic-hosted'
}
export type HostedEducationReceipt = Omit<
  ReturnType<typeof parseEducationReceipt>,
  'environment'
> & { environment: 'synthetic-hosted' }
type ReadEnvironment = (name: string) => string | undefined
export interface HostedPlatformContext {
  siteId: string
  deployId: string
  deployContext: string
}
const profileFields = [
  'version',
  'enabled',
  'environment',
  'siteId',
  'crmOrigin',
  'backendOrigin',
  'databaseName',
  'databaseIdentity',
  'fixtureSourceKey',
  'reviewers',
]
const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const sha256 = /^[0-9a-f]{64}$/
// Public source commits to exact identities without publishing an account UUID
// or address. These are allowlist commitments, never authentication credentials.
export function hostedReviewerIdSha256(memberId: string): string {
  protocolCheck(
    isProtocolUuid(memberId) && memberId === memberId.toLowerCase(),
    'Invalid hosted reviewer UUID',
  )
  return createHash('sha256').update(memberId, 'utf8').digest('hex')
}
export function hostedReviewerIdentitySha256(
  memberId: string,
  address: string,
): string {
  hostedReviewerIdSha256(memberId)
  protocolCheck(
    typeof address === 'string' &&
      address === address.trim() &&
      email.test(address) &&
      !address.toLowerCase().endsWith('.invalid'),
    'Invalid hosted reviewer address',
  )
  return createHash('sha256')
    .update(`${memberId}|${address.toLowerCase()}`, 'utf8')
    .digest('hex')
}
function origin(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (
      url.origin === value &&
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.hostname.includes('.') &&
      !/^[0-9.]+$/.test(url.hostname) &&
      !/^(?:localhost|127\.|0\.|10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|\[)/i.test(
        url.hostname,
      ) &&
      !/\.(?:invalid|localhost|local|internal)$/i.test(url.hostname)
    )
  } catch {
    return false
  }
}
export function parseHostedEducationProfile(
  value: unknown,
): HostedEducationProfile {
  const profile = exactObject(value, profileFields, 'hosted profile')
  protocolCheck(
    profile.version === 1 &&
      profile.enabled === true &&
      profile.environment === HOSTED_EDUCATION.environment &&
      profile.siteId === HOSTED_EDUCATION.siteId &&
      origin(profile.crmOrigin) &&
      origin(profile.backendOrigin) &&
      profile.crmOrigin !== profile.backendOrigin &&
      typeof profile.databaseName === 'string' &&
      /^[a-z][a-z0-9_]{0,62}$/.test(profile.databaseName) &&
      isProtocolUuid(profile.databaseIdentity) &&
      typeof profile.fixtureSourceKey === 'string' &&
      /^epdg-hosted-synthetic:[A-Za-z0-9:_-]{1,120}$/.test(
        profile.fixtureSourceKey,
      ) &&
      Array.isArray(profile.reviewers) &&
      profile.reviewers.length > 0 &&
      profile.reviewers.length <= 8,
    'Hosted education profile is unconfigured',
  )
  const reviewers = profile.reviewers.map((item) => {
    const r = exactObject(
      item,
      ['memberIdSha256', 'identitySha256'],
      'hosted reviewer commitment',
    )
    protocolCheck(
      typeof r.memberIdSha256 === 'string' &&
        sha256.test(r.memberIdSha256) &&
        typeof r.identitySha256 === 'string' &&
        sha256.test(r.identitySha256),
      'Invalid hosted reviewer binding',
    )
    return Object.freeze({
      memberIdSha256: r.memberIdSha256,
      identitySha256: r.identitySha256,
    })
  })
  protocolCheck(
    new Set(reviewers.map((r) => r.memberIdSha256)).size === reviewers.length &&
      new Set(reviewers.map((r) => r.identitySha256)).size === reviewers.length,
    'Duplicate hosted reviewer binding',
  )
  return Object.freeze({
    ...profile,
    reviewers: Object.freeze(reviewers),
  }) as unknown as HostedEducationProfile
}
export function configuredHostedEducationProfile(): HostedEducationProfile | null {
  try {
    return parseHostedEducationProfile(profileJson)
  } catch {
    return null
  }
}
// Platform context plus compiled pins authorize this mode. A request header,
// runtime target variable or browser-provided profile cannot enable it.
export function hostedEducationAvailable(
  request: Request,
  read: ReadEnvironment,
  profile = configuredHostedEducationProfile(),
  platform?: HostedPlatformContext,
): profile is HostedEducationProfile {
  if (!profile || !platform) return false
  try {
    const pinned = parseHostedEducationProfile(profile)
    const url = new URL(request.url)
    return (
      url.origin === pinned.crmOrigin &&
      !url.username &&
      !url.password &&
      platform.siteId === pinned.siteId &&
      platform.deployContext === 'production' &&
      /^[0-9a-f]{24}$/.test(platform.deployId) &&
      (!read('SITE_ID') || read('SITE_ID') === pinned.siteId) &&
      (!read('CONTEXT') || read('CONTEXT') === 'production') &&
      read('CRM_HOSTED_EDUCATION_ENABLED') === '1' &&
      read('CRM_EDUCATION_ENVIRONMENT') === HOSTED_EDUCATION.environment &&
      ![
        'CRM_SYNTHETIC_EDUCATION_ENABLED',
        'EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED',
        'EPDG_SYNTHETIC_CRM_HANDOFF_KEY',
      ].some((name) => read(name))
    )
  } catch {
    return false
  }
}
export function hostedReviewerAllowed(
  profile: HostedEducationProfile,
  member: EducationMember | undefined,
): boolean {
  if (
    !member?.active ||
    member.role === 'viewer' ||
    (member.role !== 'owner' && member.hr !== true)
  )
    return false
  try {
    const memberIdSha256 = hostedReviewerIdSha256(member.id)
    const identitySha256 = hostedReviewerIdentitySha256(member.id, member.email)
    return profile.reviewers.some(
      (r) =>
        r.memberIdSha256 === memberIdSha256 &&
        r.identitySha256 === identitySha256,
    )
  } catch {
    return false
  }
}
export function hostedSigningKey(read: ReadEnvironment): string {
  const encoded = read('EPDG_HOSTED_PRACTICE_HANDOFF_KEY')
  protocolCheck(
    typeof encoded === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(encoded) &&
      Buffer.from(encoded, 'base64url').length === 32 &&
      Buffer.from(encoded, 'base64url').toString('base64url') === encoded,
    'Hosted handoff signing configuration is unavailable',
  )
  protocolCheck(
    !['EPDG_SYNTHETIC_CRM_HANDOFF_KEY', 'CRM_OWNER_ID', 'NETLIFY_DB_URL'].some(
      (name) => read(name) === encoded,
    ),
    'Hosted handoff key must be independent',
  )
  return encoded
}
export function parseHostedEducationDecision(
  value: unknown,
  options: DecisionValidationOptions = {},
): HostedDecisionBody {
  protocolCheck(
    !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).environment ===
        HOSTED_EDUCATION.environment,
    'Invalid hosted decision environment',
  )
  const parsed = parseEducationDecision(
    { ...(value as Record<string, unknown>), environment: 'synthetic-local' },
    options,
  )
  return { ...parsed, environment: HOSTED_EDUCATION.environment }
}
export function serializeHostedDecision(
  value: unknown,
  options: DecisionValidationOptions = {},
): string {
  const raw = JSON.stringify(parseHostedEducationDecision(value, options))
  protocolCheck(
    Buffer.byteLength(raw) <= HOSTED_EDUCATION.bodyLimitBytes,
    'Hosted decision is too large',
  )
  return raw
}
export function parseRawHostedDecision(
  rawBody: unknown,
  options: DecisionValidationOptions = {},
): HostedDecisionBody {
  protocolCheck(
    typeof rawBody === 'string' &&
      Buffer.byteLength(rawBody) <= HOSTED_EDUCATION.bodyLimitBytes,
    'Invalid hosted decision bytes',
  )
  let value: unknown
  try {
    value = JSON.parse(rawBody)
  } catch {
    throw new Error('Invalid hosted decision JSON')
  }
  const parsed = parseHostedEducationDecision(value, options)
  protocolCheck(
    JSON.stringify(parsed) === rawBody,
    'Hosted decision body is not canonical',
  )
  return parsed
}
export interface HostedSignedAttempt {
  readonly method: 'POST'
  readonly path: typeof HOSTED_EDUCATION.path
  readonly target: string
  readonly headers: Readonly<Record<string, string>>
  readonly rawBody: string
}
export function signHostedEducationAttempt(input: {
  profile: HostedEducationProfile
  rawBody: string
  keyBase64url: string
  timestamp: number
  nonce: string
  now?: number
  allowExactRetry?: boolean
}): HostedSignedAttempt {
  const profile = parseHostedEducationProfile(input.profile),
    now = checkedNow(input.now)
  assertTransportTimestamp(input.timestamp, now)
  protocolCheck(isProtocolUuid(input.nonce), 'Invalid hosted transport nonce')
  parseRawHostedDecision(input.rawBody, {
    now,
    allowExactRetry: input.allowExactRetry,
  })
  protocolCheck(
    /^[A-Za-z0-9_-]{43}$/.test(input.keyBase64url),
    'Invalid hosted key encoding',
  )
  const key = Buffer.from(input.keyBase64url, 'base64url')
  try {
    protocolCheck(
      key.length === 32 && key.toString('base64url') === input.keyBase64url,
      'Invalid hosted key encoding',
    )
    const digest = createHash('sha256')
      .update(input.rawBody, 'utf8')
      .digest('hex')
    const text = [
      HOSTED_EDUCATION.signingDomain,
      'POST',
      HOSTED_EDUCATION.path,
      profile.backendOrigin,
      profile.crmOrigin,
      String(input.timestamp),
      input.nonce,
      digest,
    ].join('\n')
    const target = profile.backendOrigin + HOSTED_EDUCATION.path
    return Object.freeze({
      method: 'POST',
      path: HOSTED_EDUCATION.path,
      target,
      rawBody: input.rawBody,
      headers: Object.freeze({
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(input.rawBody)),
        Host: new URL(profile.backendOrigin).hostname,
        'X-EPDG-Handoff-Key-Id': HOSTED_EDUCATION.keyId,
        'X-EPDG-Handoff-Audience': profile.backendOrigin,
        'X-EPDG-Handoff-Source': profile.crmOrigin,
        'X-EPDG-Handoff-Timestamp': String(input.timestamp),
        'X-EPDG-Handoff-Nonce': input.nonce,
        'X-EPDG-Handoff-Signature': createHmac('sha256', key)
          .update(text, 'utf8')
          .digest('hex'),
      }),
    })
  } finally {
    key.fill(0)
  }
}
export function parseHostedEducationReceipt(
  value: unknown,
  expected: { eventId: string; minimumDecisionVersion?: number },
): HostedEducationReceipt {
  protocolCheck(
    !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).environment ===
        HOSTED_EDUCATION.environment,
    'Invalid hosted receipt environment',
  )
  const parsed = parseEducationReceipt(
    { ...(value as Record<string, unknown>), environment: 'synthetic-local' },
    expected,
  )
  return { ...parsed, environment: HOSTED_EDUCATION.environment }
}
// Only the compiled HTTPS destination is used. No redirect, proxy, TLS override,
// browser credential or arbitrary header surface is accepted.
export async function sendHostedEducationAttempt(
  attempt: HostedSignedAttempt,
  options: {
    profile: HostedEducationProfile
    now?: number
    timeoutMs?: number
  },
): Promise<HostedEducationReceipt> {
  const profile = parseHostedEducationProfile(options.profile),
    now = checkedNow(options.now)
  exactObject(
    attempt,
    ['method', 'path', 'target', 'headers', 'rawBody'],
    'hosted attempt',
  )
  protocolCheck(
    attempt.method === 'POST' &&
      attempt.path === HOSTED_EDUCATION.path &&
      attempt.target === profile.backendOrigin + HOSTED_EDUCATION.path,
    'Invalid hosted handoff target',
  )
  const body = parseRawHostedDecision(attempt.rawBody, {
    now,
    allowExactRetry: true,
  })
  const h = exactObject(
    attempt.headers,
    [
      'Content-Type',
      'Content-Length',
      'Host',
      'X-EPDG-Handoff-Key-Id',
      'X-EPDG-Handoff-Audience',
      'X-EPDG-Handoff-Source',
      'X-EPDG-Handoff-Timestamp',
      'X-EPDG-Handoff-Nonce',
      'X-EPDG-Handoff-Signature',
    ],
    'hosted transport headers',
  )
  const stamp = h['X-EPDG-Handoff-Timestamp']
  protocolCheck(
    typeof stamp === 'string' && /^[1-9][0-9]{9,10}$/.test(stamp),
    'Invalid hosted timestamp',
  )
  assertTransportTimestamp(Number(stamp), now)
  protocolCheck(
    h['Content-Type'] === 'application/json' &&
      h['Content-Length'] === String(Buffer.byteLength(attempt.rawBody)) &&
      h.Host === new URL(profile.backendOrigin).hostname &&
      h['X-EPDG-Handoff-Key-Id'] === HOSTED_EDUCATION.keyId &&
      h['X-EPDG-Handoff-Audience'] === profile.backendOrigin &&
      h['X-EPDG-Handoff-Source'] === profile.crmOrigin &&
      isProtocolUuid(h['X-EPDG-Handoff-Nonce']) &&
      typeof h['X-EPDG-Handoff-Signature'] === 'string' &&
      /^[0-9a-f]{64}$/.test(h['X-EPDG-Handoff-Signature']),
    'Invalid hosted transport headers',
  )
  const timeout = options.timeoutMs ?? 5000
  protocolCheck(
    Number.isSafeInteger(timeout) && timeout >= 100 && timeout <= 10000,
    'Invalid hosted timeout',
  )
  return new Promise((resolve, reject) => {
    let finished = false
    const done = (error?: Error, receipt?: HostedEducationReceipt) => {
      if (finished) return
      finished = true
      clearTimeout(deadline)
      if (error) reject(error)
      else resolve(receipt!)
    }
    const req = httpsRequest(
      {
        hostname: new URL(profile.backendOrigin).hostname,
        port: 443,
        path: HOSTED_EDUCATION.path,
        method: 'POST',
        headers: attempt.headers,
        agent: false,
        rejectUnauthorized: true,
      },
      (res) => {
        if (
          res.statusCode !== 200 ||
          !/^application\/json(?:\s*;|$)/i.test(
            String(res.headers['content-type'] || ''),
          )
        ) {
          res.destroy()
          done(new Error('Hosted receiver rejected the attempt'))
          return
        }
        let size = 0
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > HOSTED_EDUCATION.bodyLimitBytes) {
            req.destroy()
            done(new Error('Hosted receipt is too large'))
            return
          }
          chunks.push(Buffer.from(chunk))
        })
        res.once('error', () => done(new Error('Hosted receipt failed')))
        res.once('aborted', () => done(new Error('Hosted receipt aborted')))
        res.once('end', () => {
          try {
            const receipt = parseHostedEducationReceipt(
              JSON.parse(Buffer.concat(chunks).toString('utf8')),
              {
                eventId: body.event_id,
                minimumDecisionVersion: body.decision_version,
              },
            )
            const expected =
              body.withdrawn || body.decision === 'revoked'
                ? 'withdrawn'
                : body.decision === 'cleared'
                  ? 'ready'
                  : 'held'
            protocolCheck(
              receipt.decision_version !== body.decision_version ||
                receipt.current_status === expected,
              'Hosted receipt contradicts the decision',
            )
            protocolCheck(
              receipt.decision_version === body.decision_version ||
                receipt.result === 'duplicate',
              'Hosted accepted receipt has an unexpected version',
            )
            done(undefined, receipt)
          } catch {
            done(new Error('Invalid hosted receipt'))
          }
        })
      },
    )
    const deadline = setTimeout(() => {
      req.destroy()
      done(new Error('Hosted transport timed out'))
    }, timeout)
    req.once('error', () => done(new Error('Hosted transport failed')))
    req.setTimeout(timeout, () => {
      req.destroy()
      done(new Error('Hosted transport timed out'))
    })
    req.end(attempt.rawBody, 'utf8')
  })
}

// Exporting these fixed identifiers documents the wire boundary; no source or
// receiver record may be selected by a browser-supplied identifier.
export const HOSTED_EDUCATION_FIXTURE_IDS = FIXTURE_IDS
export const LOCAL_HANDOFF_TARGET = SYNTHETIC_HANDOFF.target
