import {
  bodyText,
  capture,
  check,
  hash,
  intakeRoute,
  object,
  sha256,
  signedResponse,
  uuid,
  verifyRequest,
} from './protocol.ts'

export interface IntakeStore {
  capture(
    eventId: string,
    payload: unknown,
    payloadHash: string,
  ): Promise<string>
  exchange(
    nonce: string,
    operation: 'pull' | 'ack',
    events: unknown[],
  ): Promise<unknown>
}
export type IntakeConfig = { enabled: string; origin: string; secret: string }
export function previewOrigin(value: string) {
  const sites = '(?:emerson-crm|emerson-empire|agency-landing-page)'
  const pattern = new RegExp(
    '^https://[a-z0-9-]+--' + sites + '\\.netlify\\.app$',
  )
  return pattern.test(value)
}
// This module has no mail dependency or notification callback. Only its injected
// store can perform I/O; deployment binds that store solely to its own new RPCs.
export function createIntakeHandler(config: IntakeConfig, store: IntakeStore) {
  return async (req: Request) => {
    try {
      check(
        config.enabled === 'synthetic-preview' && previewOrigin(config.origin),
        'Synthetic intake unavailable',
        503,
      )
      check(
        req.method === 'POST' || req.method === 'OPTIONS',
        'Method not allowed',
        405,
      )
      const route = intakeRoute(req.url)
      if (route.operation === 'capture') {
        check(
          req.headers.get('origin') === config.origin,
          'Preview origin required',
          403,
        )
        const cors = {
          'access-control-allow-origin': config.origin,
          vary: 'Origin',
          'cache-control': 'no-store',
        }
        if (req.method === 'OPTIONS') {
          return new Response(null, {
            status: 204,
            headers: {
              ...cors,
              'access-control-allow-methods': 'POST',
              'access-control-allow-headers': 'content-type',
            },
          })
        }
        const payload = capture(JSON.parse(await bodyText(req, 4096)))
        const result = await store.capture(
          payload.eventId,
          payload,
          await sha256(JSON.stringify(payload)),
        )
        check(
          result !== 'collision',
          'Event key already belongs to different content',
          409,
        )
        check(
          result !== 'rate_limited',
          'Synthetic intake rate limit reached',
          429,
        )
        check(
          result === 'inserted' || result === 'duplicate',
          'Synthetic intake unavailable',
          503,
        )
        return Response.json(
          { receipt: payload.eventId, synthetic: true },
          { status: result === 'inserted' ? 201 : 200, headers: cors },
        )
      }
      check(req.method === 'POST', 'Method not allowed', 405)
      const text = await bodyText(req, 4096)
      const nonce = await verifyRequest(req, text, config.secret)
      const data: unknown = JSON.parse(text)
      const operation = route.operation
      object(data, operation === 'pull' ? ['limit'] : ['events'])
      const items: unknown[] = []
      if (operation === 'pull') {
        check(data.limit === 20, 'Bounded pull required')
      } else {
        check(
          Array.isArray(data.events) && data.events.length <= 20,
          'Bounded acknowledgment required',
        )
        for (const item of data.events) {
          object(item, ['eventId', 'payloadHash'])
          check(
            uuid(item.eventId) && hash(item.payloadHash),
            'Invalid acknowledgment',
          )
          items.push(item)
        }
      }
      const result = await store.exchange(nonce, operation, items)
      check(
        result && typeof result === 'object' && !('error' in result),
        'Intake exchange rejected',
        409,
      )
      return signedResponse(req, result, config.secret)
    } catch (error) {
      let status = 503
      if (
        error &&
        typeof error === 'object' &&
        'status' in error &&
        typeof error.status === 'number'
      ) {
        status = error.status
      }
      let message = 'Synthetic intake unavailable'
      if (status !== 503) message = 'Synthetic intake request rejected'
      // No source contents, keys or database errors in client responses/logs.
      return Response.json(
        {
          error: message,
        },
        { status, headers: { 'cache-control': 'no-store' } },
      )
    }
  }
}
