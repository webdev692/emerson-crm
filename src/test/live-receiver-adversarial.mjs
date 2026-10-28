'use strict'

// Verify-only helper for the explicitly authorized local live CRM rehearsal.
// Importing this file does nothing. It creates no server, migration, seed,
// account, session or valid decision. The caller keeps its key inside its own
// trusted signing closure; this module never reads configuration or a key.
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import http from 'node:http'

const target = 'http://127.0.0.1:58000/internal/crm/onboarding-handoffs'
const path = '/internal/crm/onboarding-handoffs'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const digest = (value) => createHash('sha256').update(value).digest('hex')
const wireFields = [
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
]

function fixtureBody(rawBody) {
  assert.equal(
    typeof rawBody,
    'string',
    'Actual immutable CRM outbox bytes required',
  )
  assert.ok(
    Buffer.byteLength(rawBody, 'utf8') <= 8192,
    'Bounded synthetic body required',
  )
  const value = JSON.parse(rawBody)
  assert.deepEqual(
    Object.keys(value),
    wireFields,
    'Only canonical minimal CRM outbox fields allowed',
  )
  assert.equal(value.version, 1)
  assert.equal(value.source, 'emerson-crm-synthetic')
  assert.equal(value.environment, 'synthetic-local')
  assert.equal(value.policy_version, 'synthetic-onboarding-v1')
  assert.equal(value.person_id, '81000000-0000-4000-8000-000000000001')
  assert.equal(value.application_id, '82000000-0000-4000-8000-000000000001')
  assert.equal(value.program_id, '83000000-0000-4000-8000-000000000001')
  assert.ok(
    uuid.test(value.event_id) &&
      uuid.test(value.decision_id) &&
      uuid.test(value.reviewer_id),
  )
  assert.ok(
    Number.isSafeInteger(value.decision_version) &&
      value.decision_version >= 1 &&
      value.decision_version <= 1000000,
  )
  assert.ok(['cleared', 'held', 'revoked'].includes(value.decision))
  assert.equal(typeof value.withdrawn, 'boolean')
  assert.deepEqual(Object.keys(value.clearance), [
    'identity_verified',
    'onboarding_complete',
    'agreements_complete',
    'hr_approved',
  ])
  assert.ok(
    Object.values(value.clearance).every((item) => typeof item === 'boolean'),
  )
  assert.equal(
    JSON.stringify(value),
    rawBody,
    'Preserve the exact canonical outbox bytes',
  )
  return value
}

function post(attempt, overrides = {}) {
  assert.equal(
    attempt.target,
    target,
    'Exact local synthetic receiver required',
  )
  assert.equal(attempt.method, 'POST')
  assert.equal(attempt.path, path)
  fixtureBody(attempt.rawBody)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 58000,
        path,
        method: 'POST',
        agent: false,
        headers: {
          ...attempt.headers,
          ...overrides,
          Host: '127.0.0.1:58000',
          'Content-Length': String(Buffer.byteLength(attempt.rawBody, 'utf8')),
        },
      },
      (response) => {
        let bytes = 0
        response.on('data', (chunk) => {
          bytes += chunk.length
          if (bytes > 8192) {
            response.destroy()
            reject(new Error('Bounded receiver response exceeded'))
          }
        })
        response.once('end', () => resolve(response.statusCode))
        response.once('error', () =>
          reject(new Error('Receiver response failed')),
        )
        response.once('aborted', () =>
          reject(new Error('Receiver response aborted')),
        )
      },
    )
    req.setTimeout(5000, () => {
      req.destroy()
      reject(new Error('Local receiver request timed out'))
    })
    req.once('error', () => reject(new Error('Local receiver request failed')))
    req.end(attempt.rawBody, 'utf8')
  })
}

/**
 * rawBody and usedNonce must come from one actual accepted CRM outbox dispatch.
 * receiverSnapshot returns only stable, ordered, nonsecret counts/hashes for
 * events, nonces, latest status and protected/immutable learning/account state.
 * No receipt bodies, cookies, passwords or key material may enter that snapshot.
 * signAttempt(rawBody, nonce) must use the real CRM signer with exact-retry
 * validation and a fresh current timestamp. Its operational key remains inside
 * the caller's trusted process; it is not passed to or returned by this helper.
 */
async function verifyAdversarialReceiver({
  rawBody,
  usedNonce,
  signAttempt,
  receiverSnapshot,
}) {
  const event = fixtureBody(rawBody)
  assert.ok(
    uuid.test(usedNonce),
    'Previously accepted transport nonce required',
  )
  assert.equal(typeof signAttempt, 'function')
  assert.equal(typeof receiverSnapshot, 'function')
  const before = digest(JSON.stringify(await receiverSnapshot()))
  const checks = []
  async function check(
    name,
    expectedStatus,
    body = rawBody,
    overrides = {},
    nonce = randomUUID(),
  ) {
    const attempt = await signAttempt(body, nonce)
    assert.equal(
      attempt.rawBody,
      body,
      'Signer must retain exact requested bytes',
    )
    const status = await post(attempt, overrides)
    assert.equal(status, expectedStatus, name)
    assert.equal(
      digest(JSON.stringify(await receiverSnapshot())),
      before,
      'Negative check changed receiver/protected state',
    )
    checks.push({ name, status, receiverStatePreserved: true })
  }

  await check('incorrect HMAC rejects before state mutation', 401, rawBody, {
    'X-EPDG-Handoff-Signature': '0'.repeat(64),
  })
  await check('malformed HMAC rejects before state mutation', 401, rawBody, {
    'X-EPDG-Handoff-Signature': 'malformed',
  })
  await check(
    'previous nonce is rejected even with fresh signed transport',
    409,
    rawBody,
    {},
    usedNonce,
  )

  const collision = JSON.stringify({ ...event, decision_id: randomUUID() })
  await check(
    'existing event identity cannot acquire a different body',
    409,
    collision,
  )
  const stale = JSON.stringify({
    ...event,
    event_id: randomUUID(),
    decision_id: randomUUID(),
    issued_at: new Date().toISOString(),
  })
  await check(
    'fresh transport cannot append a previously used decision revision',
    409,
    stale,
  )
  await check(
    'browser origin cannot reach the authenticated consumer',
    403,
    rawBody,
    { Origin: 'http://127.0.0.1:58080' },
  )
  await check(
    'forwarded request cannot reach the authenticated consumer',
    403,
    rawBody,
    { Forwarded: 'for=127.0.0.1' },
  )

  return {
    scope:
      'negative real-receiver checks derived from an actual CRM outbox event',
    passed: checks.length,
    checks,
    originalEventId: event.event_id,
    originalBodyHash: digest(rawBody),
    receiverStatePreserved: true,
    newValidDecisionWrites: 0,
    keyReadOrExportedByHelper: false,
    operatingReceiverMigrationsSeedsRestartsByHelper: 0,
  }
}

export { verifyAdversarialReceiver }
