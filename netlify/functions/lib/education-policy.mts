import type { database } from '../../../db/index'
import type { members } from '../../../db/schema'

export type EducationDatabase = Pick<ReturnType<typeof database>, 'transaction'>
export type EducationTransaction = Parameters<
  Parameters<EducationDatabase['transaction']>[0]
>[0]
export type EducationMember = typeof members.$inferSelect
export interface EducationReceiverCheckpoint {
  applicationId: string
  receiverVersion: number
  target: string
  observedAt: Date
  stateHash: string
  source: string
}

// Only server code constructs a policy. Browser input never selects a target,
// reviewer, environment or database. The default policy remains local-only.
export interface EducationPolicy {
  readonly environment: 'synthetic-local' | 'synthetic-hosted'
  readonly target: string
  readonly checkpointSource: 'verified-local-epdg' | 'verified-hosted-epdg'
  readonly fixtureSourceKey?: string
  beforeTransaction: (tx: EducationTransaction) => Promise<void>
  reviewerAllowed: (member: EducationMember | undefined) => boolean
  verifyReviewer?: (member: EducationMember) => Promise<boolean>
  receiverCheckpoint?: (
    tx: EducationTransaction,
    applicationId: string,
  ) => Promise<EducationReceiverCheckpoint | undefined>
  serializeDecision: (value: unknown) => string
}
