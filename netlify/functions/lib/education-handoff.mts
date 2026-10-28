import { createHash, createHmac } from 'node:crypto'

// This protocol is deliberately limited to the operator-preseeded local fixture.
// The caller must authenticate and reload current HR/clearance state in its DB
// transaction. A well-formed wire object does not prove authorization.
export const SYNTHETIC_HANDOFF = Object.freeze({
  target: 'http://127.0.0.1:58000/internal/crm/onboarding-handoffs',
  path: '/internal/crm/onboarding-handoffs',
  source: 'emerson-crm-synthetic',
  environment: 'synthetic-local',
  policyVersion: 'synthetic-onboarding-v1',
  keyId: 'synthetic-local-v1',
  bodyLimitBytes: 8192,
} as const)

export const FIXTURE_IDS = Object.freeze({
  reviewerId: '80000000-0000-4000-8000-000000000001',
  personId: '81000000-0000-4000-8000-000000000001',
  applicationId: '82000000-0000-4000-8000-000000000001',
  crmProgramId: '83000000-0000-4000-8000-000000000001',
  mappingId: '84000000-0000-4000-8000-000000000001',
  localProgramId: '85000000-0000-4000-8000-000000000001',
  enrollmentId: '86000000-0000-4000-8000-000000000001',
  lessonId: '87000000-0000-4000-8000-000000000001',
} as const)

export type EducationDecision = 'cleared' | 'held' | 'revoked'
export interface Clearance {
  identity_verified: boolean
  onboarding_complete: boolean
  agreements_complete: boolean
  hr_approved: boolean
}
export interface EducationDecisionBody {
  version: 1
  source: typeof SYNTHETIC_HANDOFF.source
  environment: typeof SYNTHETIC_HANDOFF.environment
  event_id: string
  person_id: string
  application_id: string
  program_id: string
  decision_id: string
  decision_version: number
  decision: EducationDecision
  issued_at: string
  policy_version: typeof SYNTHETIC_HANDOFF.policyVersion
  reviewer_id: string
  clearance: Clearance
  withdrawn: boolean
}
export interface SyntheticGate {
  enabled: '1'
  environment: typeof SYNTHETIC_HANDOFF.environment
}
export interface DecisionValidationOptions {
  now?: number
  // Only use for the exact immutable body retrieved from a durable outbox.
  // This permits an old issued_at, never a future event or stale transport.
  allowExactRetry?: boolean
}
export interface SignedEducationAttempt {
  readonly method: 'POST'
  readonly path: typeof SYNTHETIC_HANDOFF.path
  readonly target: typeof SYNTHETIC_HANDOFF.target
  readonly headers: Readonly<Record<string, string>>
  readonly rawBody: string
}
export interface SignEducationAttemptInput extends DecisionValidationOptions {
  rawBody: string
  timestamp: number
  nonce: string
  keyBase64url: string
  target: string
  gate: unknown
}

const bodyFields = [
  'version',
  'source',
  'environment',
  'event_id',
  'person_id',
  'application_id',
  'program_id',
  'decision_id',
  'decision_version',
  'decision',
  'issued_at',
  'policy_version',
  'reviewer_id',
  'clearance',
  'withdrawn',
] as const
const clearanceFields = [
  'identity_verified',
  'onboarding_complete',
  'agreements_complete',
  'hr_approved',
] as const
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function protocolCheck(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message)
}

export function exactObject(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  protocolCheck(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `Invalid ${label}`,
  )
  protocolCheck(
    [Object.prototype, null].includes(Object.getPrototypeOf(value)),
    `Invalid ${label}`,
  )
  const descriptors = Object.getOwnPropertyDescriptors(value)
  protocolCheck(
    Reflect.ownKeys(value).length === fields.length &&
      fields.every(
        (field) =>
          Object.hasOwn(descriptors, field) &&
          Object.hasOwn(descriptors[field], 'value') &&
          descriptors[field].enumerable,
      ),
    `Unexpected ${label} fields`,
  )
  return value as Record<string, unknown>
}

export const isProtocolUuid = (value: unknown): value is string =>
  typeof value === 'string' && uuid.test(value)
export const isDecisionVersion = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 1000000
export const isCanonicalUtc = (value: unknown): value is string =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value

export function checkedNow(value = Date.now()): number {
  protocolCheck(Number.isSafeInteger(value) && value >= 0, 'Invalid clock')
  return value
}

export function assertSyntheticGate(
  gate: unknown,
): asserts gate is SyntheticGate {
  const value = exactObject(gate, ['enabled', 'environment'], 'synthetic gate')
  protocolCheck(
    value.enabled === '1' &&
      value.environment === SYNTHETIC_HANDOFF.environment,
    'Synthetic handoff is disabled',
  )
}

export function parseEducationDecision(
  value: unknown,
  options: DecisionValidationOptions = {},
): EducationDecisionBody {
  const now = checkedNow(options.now)
  const body = exactObject(value, bodyFields, 'decision')
  protocolCheck(
    body.version === 1 &&
      body.source === SYNTHETIC_HANDOFF.source &&
      body.environment === SYNTHETIC_HANDOFF.environment &&
      body.policy_version === SYNTHETIC_HANDOFF.policyVersion,
    'Invalid synthetic decision constants',
  )
  for (const field of [
    'event_id',
    'person_id',
    'application_id',
    'program_id',
    'decision_id',
    'reviewer_id',
  ])
    protocolCheck(isProtocolUuid(body[field]), `Invalid ${field}`)
  protocolCheck(
    body.person_id === FIXTURE_IDS.personId &&
      body.application_id === FIXTURE_IDS.applicationId &&
      body.program_id === FIXTURE_IDS.crmProgramId,
    'Only the fixed synthetic mapping may be exported',
  )
  protocolCheck(
    isDecisionVersion(body.decision_version),
    'Invalid decision version',
  )
  protocolCheck(
    body.decision === 'cleared' ||
      body.decision === 'held' ||
      body.decision === 'revoked',
    'Invalid decision',
  )
  protocolCheck(isCanonicalUtc(body.issued_at), 'Invalid decision timestamp')
  const age = now - Date.parse(body.issued_at)
  protocolCheck(
    age >= -30000 && (options.allowExactRetry === true || age <= 300000),
    'Decision timestamp is outside the permitted window',
  )
  const clearance = exactObject(body.clearance, clearanceFields, 'clearance')
  for (const field of clearanceFields)
    protocolCheck(
      typeof clearance[field] === 'boolean',
      'Invalid clearance boolean',
    )
  protocolCheck(
    typeof body.withdrawn === 'boolean',
    'Invalid withdrawal boolean',
  )
  protocolCheck(
    body.decision !== 'cleared' ||
      (clearanceFields.every((field) => clearance[field] === true) &&
        body.withdrawn === false),
    'Cleared requires current complete clearance without withdrawal',
  )
  return {
    version: 1,
    source: SYNTHETIC_HANDOFF.source,
    environment: SYNTHETIC_HANDOFF.environment,
    event_id: body.event_id as string,
    person_id: body.person_id as string,
    application_id: body.application_id as string,
    program_id: body.program_id as string,
    decision_id: body.decision_id as string,
    decision_version: body.decision_version,
    decision: body.decision,
    issued_at: body.issued_at,
    policy_version: SYNTHETIC_HANDOFF.policyVersion,
    reviewer_id: body.reviewer_id as string,
    clearance: {
      identity_verified: clearance.identity_verified as boolean,
      onboarding_complete: clearance.onboarding_complete as boolean,
      agreements_complete: clearance.agreements_complete as boolean,
      hr_approved: clearance.hr_approved as boolean,
    },
    withdrawn: body.withdrawn,
  }
}

export function serializeDecision(
  value: unknown,
  options: DecisionValidationOptions = {},
): string {
  const rawBody = JSON.stringify(parseEducationDecision(value, options))
  protocolCheck(
    Buffer.byteLength(rawBody, 'utf8') <= SYNTHETIC_HANDOFF.bodyLimitBytes,
    'Decision body is too large',
  )
  return rawBody
}

export function parseRawEducationDecision(
  rawBody: unknown,
  options: DecisionValidationOptions = {},
): EducationDecisionBody {
  protocolCheck(typeof rawBody === 'string', 'Invalid raw decision body')
  protocolCheck(
    Buffer.byteLength(rawBody, 'utf8') <= SYNTHETIC_HANDOFF.bodyLimitBytes,
    'Decision body is too large',
  )
  let value: unknown
  try {
    value = JSON.parse(rawBody)
  } catch {
    throw new Error('Invalid decision JSON')
  }
  const body = parseEducationDecision(value, options)
  // A single serializer prevents duplicate keys, alternate encodings and accidental
  // retry reserialization from changing the durable event's exact signed bytes.
  protocolCheck(
    JSON.stringify(body) === rawBody,
    'Decision body is not canonical',
  )
  return body
}

export function assertTransportTimestamp(timestamp: unknown, now: number) {
  protocolCheck(
    Number.isSafeInteger(timestamp) && Number(timestamp) >= 0,
    'Invalid transport timestamp',
  )
  const age = checkedNow(now) / 1000 - Number(timestamp)
  protocolCheck(
    age >= -30 && age <= 300,
    'Transport timestamp is outside the permitted window',
  )
}

export function signSyntheticEducationAttempt(
  input: SignEducationAttemptInput,
): SignedEducationAttempt {
  assertSyntheticGate(input.gate)
  protocolCheck(
    input.target === SYNTHETIC_HANDOFF.target,
    'Invalid handoff target',
  )
  const now = checkedNow(input.now)
  assertTransportTimestamp(input.timestamp, now)
  protocolCheck(isProtocolUuid(input.nonce), 'Invalid transport nonce')
  parseRawEducationDecision(input.rawBody, {
    now,
    allowExactRetry: input.allowExactRetry,
  })
  protocolCheck(
    typeof input.keyBase64url === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(input.keyBase64url),
    'Invalid handoff key encoding',
  )
  const key = Buffer.from(input.keyBase64url, 'base64url')
  try {
    protocolCheck(
      key.length === 32 && key.toString('base64url') === input.keyBase64url,
      'Invalid handoff key encoding',
    )
    const bodyHash = createHash('sha256')
      .update(input.rawBody, 'utf8')
      .digest('hex')
    const signingInput = [
      'EPDG-CRM-HANDOFF-V1',
      'POST',
      SYNTHETIC_HANDOFF.path,
      String(input.timestamp),
      input.nonce,
      bodyHash,
    ].join('\n')
    const signature = createHmac('sha256', key)
      .update(signingInput, 'utf8')
      .digest('hex')
    return Object.freeze({
      method: 'POST',
      path: SYNTHETIC_HANDOFF.path,
      target: SYNTHETIC_HANDOFF.target,
      headers: Object.freeze({
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(input.rawBody, 'utf8')),
        Host: '127.0.0.1:58000',
        'X-EPDG-Handoff-Key-Id': SYNTHETIC_HANDOFF.keyId,
        'X-EPDG-Handoff-Timestamp': String(input.timestamp),
        'X-EPDG-Handoff-Nonce': input.nonce,
        'X-EPDG-Handoff-Signature': signature,
      }),
      rawBody: input.rawBody,
    })
  } finally {
    key.fill(0)
  }
}
