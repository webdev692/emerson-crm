import { eq, sql } from 'drizzle-orm'
import { members } from '../../../db/schema'
import type { database } from '../../../db/index'
import { handleFoundation } from './foundation.mts'
import {
  check,
  ENDPOINT,
  SOURCE,
  events,
  object,
  signedRequest,
  verifyResponse,
} from './website-intake-protocol.mts'

type Member = typeof members.$inferSelect
type ReadEnvironment = (name: string) => string | undefined
type Deployment = { context: string; published: boolean }
export function websiteIntakeAvailable(
  req: Request,
  env: ReadEnvironment,
  deployment?: Deployment,
) {
  const origin = env('CRM_WEBSITE_INTAKE_PREVIEW_ORIGIN') || ''
  return (
    env('CRM_WEBSITE_INTAKE_MODE') === 'synthetic-preview' &&
    /^https:\/\/[a-z0-9-]+--emerson-crm\.netlify\.app$/.test(origin) &&
    new URL(req.url).origin === origin &&
    !!deployment &&
    ['branch-deploy', 'deploy-preview'].includes(deployment.context) &&
    deployment.published === false &&
    /^[A-Za-z0-9_-]{43}$/.test(env('CRM_WEBSITE_INTAKE_HMAC_KEY') || '')
  )
}

export async function pullWebsiteIntake(
  db: ReturnType<typeof database>,
  actor: Member,
  secret: string,
  transport: typeof fetch = fetch,
) {
  const currentActor = () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7031926)`)
      const [member] = await tx
        .select()
        .from(members)
        .where(eq(members.id, actor.id))
      check(
        member?.active &&
          member.email.toLowerCase() === actor.email.toLowerCase() &&
          ['owner', 'manager'].includes(member.role),
        'Current owner or manager access required',
        403,
      )
      return member
    })
  await currentActor()
  const exchange = async (op: 'pull' | 'ack', body: unknown) => {
    const req = await signedRequest(op, body, secret)
    const response = await transport(req, {
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    })
    return verifyResponse(req, response, secret)
  }
  const batch = await events(await exchange('pull', { limit: 20 }))
  const workflows = [...new Set(batch.map((event) => event.payload.workflow))]
  for (const workflow of workflows) {
    const selected = batch.filter(
      (event) => event.payload.workflow === workflow,
    )
    const result = await handleFoundation(db, actor, {
      action: 'intake-preview',
      sourceName: SOURCE,
      workflow,
      rows: selected.map((event) => ({
        sourceId: event.eventId,
        sourceVersion: `synthetic-v1:${event.payloadHash}`,
        sourceRow: event.payload.resourceId,
        sourceUrl: `${ENDPOINT}/capture`,
        name: event.payload.name,
        email: event.payload.email,
        organization: 'PILOT TEST Organization',
        contactPermission: 'Unknown',
        nextAction: 'Review synthetic website inquiry',
        nextDue: new Date(Date.now() + 7 * 86400000).toISOString(),
      })),
    })
    check(
      'rows' in result &&
        Array.isArray(result.rows) &&
        result.rows.length === selected.length &&
        result.rows.every((row) =>
          selected.some(
            (event) =>
              row.data.sourceId === event.eventId &&
              row.data.sourceVersion === `synthetic-v1:${event.payloadHash}` &&
              row.data.email === event.payload.email &&
              ['test', 'excluded'].includes(row.data.status || ''),
          ),
        ),
      'Synthetic queue commit could not be verified',
      409,
    )
  }
  // Never acknowledge until all queue transactions have committed. If this
  // transfer fails now, immutable source IDs make the next pull an exact retry.
  await currentActor()
  if (!batch.length) return { queued: 0, acknowledged: 0, synthetic: true }
  try {
    const ack = await exchange('ack', {
      events: batch.map(({ eventId, payloadHash }) => ({
        eventId,
        payloadHash,
      })),
    })
    object(ack, ['acknowledged'])
    check(ack.acknowledged === batch.length, 'Acknowledgment mismatch', 502)
    return { queued: batch.length, acknowledged: batch.length, synthetic: true }
  } catch {
    // Report the committed state truthfully; retries must reuse the source IDs.
    return {
      queued: batch.length,
      acknowledged: 0,
      synthetic: true,
      retryRequired: true,
    }
  }
}
