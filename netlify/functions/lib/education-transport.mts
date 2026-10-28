import { request } from 'node:http'
import {
  SYNTHETIC_HANDOFF,
  assertSyntheticGate,
  assertTransportTimestamp,
  checkedNow,
  exactObject,
  isCanonicalUtc,
  isDecisionVersion,
  isProtocolUuid,
  parseRawEducationDecision,
  protocolCheck,
} from './education-handoff.mts'
import type { SignedEducationAttempt } from './education-handoff.mts'

export interface EducationReceipt {
  success: true
  environment: typeof SYNTHETIC_HANDOFF.environment
  event_id: string
  result: 'accepted' | 'duplicate'
  received_at: string
  current_status: 'ready' | 'held' | 'withdrawn'
  decision_version: number
}
export interface ReceiptExpectation {
  eventId: string
  minimumDecisionVersion?: number
}
export interface SendEducationOptions {
  gate: unknown
  now?: number
  timeoutMs?: number
}

export function parseEducationReceipt(
  value: unknown,
  expected: ReceiptExpectation,
): EducationReceipt {
  const receipt = exactObject(
    value,
    [
      'success',
      'environment',
      'event_id',
      'result',
      'received_at',
      'current_status',
      'decision_version',
    ],
    'education receipt',
  )
  protocolCheck(
    receipt.success === true &&
      receipt.environment === SYNTHETIC_HANDOFF.environment,
    'Invalid education receipt constants',
  )
  protocolCheck(
    isProtocolUuid(expected.eventId) &&
      receipt.event_id === expected.eventId &&
      (receipt.result === 'accepted' || receipt.result === 'duplicate') &&
      isCanonicalUtc(receipt.received_at) &&
      ['ready', 'held', 'withdrawn'].includes(String(receipt.current_status)) &&
      isDecisionVersion(receipt.decision_version) &&
      isDecisionVersion(expected.minimumDecisionVersion ?? 1) &&
      receipt.decision_version >= (expected.minimumDecisionVersion ?? 1),
    'Invalid or stale education receipt',
  )
  return {
    success: true,
    environment: SYNTHETIC_HANDOFF.environment,
    event_id: expected.eventId,
    result: receipt.result as EducationReceipt['result'],
    received_at: receipt.received_at as string,
    current_status:
      receipt.current_status as EducationReceipt['current_status'],
    decision_version: receipt.decision_version as number,
  }
}

// Explicit local-only transport. It reads no environment, operational key or
// session, follows no redirect and cannot forward browser/proxy headers.
export async function sendSyntheticEducationAttempt(
  attempt: SignedEducationAttempt,
  options: SendEducationOptions,
): Promise<EducationReceipt> {
  assertSyntheticGate(options.gate)
  const now = checkedNow(options.now)
  exactObject(
    attempt,
    ['method', 'path', 'target', 'headers', 'rawBody'],
    'attempt',
  )
  protocolCheck(
    attempt.method === 'POST' &&
      attempt.path === SYNTHETIC_HANDOFF.path &&
      attempt.target === SYNTHETIC_HANDOFF.target,
    'Invalid handoff target',
  )
  const body = parseRawEducationDecision(attempt.rawBody, {
    now,
    allowExactRetry: true,
  })
  const headers = exactObject(
    attempt.headers,
    [
      'Content-Type',
      'Content-Length',
      'Host',
      'X-EPDG-Handoff-Key-Id',
      'X-EPDG-Handoff-Timestamp',
      'X-EPDG-Handoff-Nonce',
      'X-EPDG-Handoff-Signature',
    ],
    'transport headers',
  )
  const stamp = headers['X-EPDG-Handoff-Timestamp']
  protocolCheck(
    typeof stamp === 'string' && /^(0|[1-9][0-9]*)$/.test(stamp),
    'Invalid transport timestamp',
  )
  assertTransportTimestamp(Number(stamp), now)
  protocolCheck(
    headers['Content-Type'] === 'application/json' &&
      headers['Content-Length'] ===
        String(Buffer.byteLength(attempt.rawBody)) &&
      headers.Host === '127.0.0.1:58000' &&
      headers['X-EPDG-Handoff-Key-Id'] === SYNTHETIC_HANDOFF.keyId &&
      isProtocolUuid(headers['X-EPDG-Handoff-Nonce']) &&
      typeof headers['X-EPDG-Handoff-Signature'] === 'string' &&
      /^[0-9a-f]{64}$/.test(headers['X-EPDG-Handoff-Signature']),
    'Invalid transport headers',
  )
  const timeoutMs = options.timeoutMs ?? 5000
  protocolCheck(
    Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 10000,
    'Invalid transport timeout',
  )

  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port: 58000,
        method: 'POST',
        path: SYNTHETIC_HANDOFF.path,
        headers: attempt.headers,
        agent: false,
      },
      (response) => {
        if (
          response.statusCode !== 200 ||
          !/^application\/json(?:\s*;|$)/i.test(
            String(response.headers['content-type'] || ''),
          )
        ) {
          response.destroy()
          reject(new Error('Education receiver rejected the attempt'))
          return
        }
        let bytes = 0
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > SYNTHETIC_HANDOFF.bodyLimitBytes) {
            response.destroy()
            reject(new Error('Education receipt is too large'))
            return
          }
          chunks.push(Buffer.from(chunk))
        })
        response.once('error', () =>
          reject(new Error('Education receipt failed')),
        )
        response.once('aborted', () =>
          reject(new Error('Education receipt aborted')),
        )
        response.once('end', () => {
          try {
            const receipt = parseEducationReceipt(
              JSON.parse(Buffer.concat(chunks).toString('utf8')),
              {
                eventId: body.event_id,
                minimumDecisionVersion: body.decision_version,
              },
            )
            if (receipt.decision_version === body.decision_version) {
              const expectedStatus =
                body.withdrawn || body.decision === 'revoked'
                  ? 'withdrawn'
                  : body.decision === 'cleared'
                    ? 'ready'
                    : 'held'
              protocolCheck(
                receipt.current_status === expectedStatus,
                'Education receipt contradicts its decision',
              )
            } else
              protocolCheck(
                receipt.result === 'duplicate',
                'Accepted receipt has an unexpected decision version',
              )
            resolve(receipt)
          } catch {
            reject(new Error('Invalid education receipt'))
          }
        })
      },
    )
    req.once('error', () => reject(new Error('Education transport failed')))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('Education transport timed out'))
    })
    req.end(attempt.rawBody, 'utf8')
  })
}
