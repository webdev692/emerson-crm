// Browser vocabulary only. The server reloads identity, membership and source
// evidence before every decision; none of these types grant clearance.
export const educationCriteria = [
  ['identity_verified', 'Identity verified'],
  ['onboarding_complete', 'Onboarding complete'],
  ['agreements_complete', 'Agreements complete'],
  ['hr_approved', 'HR approved'],
] as const
export type EducationCriterion = (typeof educationCriteria)[number][0]
export type EducationClearance = Record<EducationCriterion, boolean>
export type EducationEvidence = Record<EducationCriterion, string>
export type EducationDecision = 'cleared' | 'held' | 'revoked'
export interface EducationSnapshot {
  applicationId: string
  applicationRevision: number
  personRevision: number
  sourceFingerprint: string
  sourceVersion: string
  decisionVersion: number
  receiverVersionFloor?: number
  holds: string[]
  current: null | {
    id: string
    decision: EducationDecision
    withdrawn: boolean
    reviewerId: string
    issuedAt: string
    reason: string
    clearance: EducationClearance
    evidence: EducationEvidence
  }
  outbox: {
    eventId: string
    decisionVersion: number
    decision: EducationDecision
    status: string
    attempts: number
    bodyHash: string
    currentStatus?: string
  }[]
}
export const emptyEducationClearance = (): EducationClearance => ({
  identity_verified: false,
  onboarding_complete: false,
  agreements_complete: false,
  hr_approved: false,
})
export const emptyEducationEvidence = (): EducationEvidence => ({
  identity_verified: '',
  onboarding_complete: '',
  agreements_complete: '',
  hr_approved: '',
})
export const educationHoldLabel = (hold: string) =>
  (
    ({
      synthetic_application_unverified:
        'The fictional application needs verification.',
      synthetic_identity_unverified:
        'The fictional applicant identity needs verification.',
      synthetic_program_unverified:
        'The education program mapping needs verification.',
      application_person_changed: 'The linked person changed.',
      application_program_changed: 'The linked program changed.',
      identity_review_hold: 'Identity review is on hold.',
      application_source_hold: 'Application source evidence is on hold.',
      source_binding_unverified:
        'The application is not linked to a verified import receipt.',
      source_review_hold: 'Imported source evidence needs review.',
      resolved_source_changed:
        'New source content differs from the retained import receipt.',
      source_version_unverified: 'The source version is unverified.',
      application_source_version_changed:
        'The application and source versions differ.',
      current_withdrawal: 'The applicant has withdrawn.',
      application_revision_changed:
        'The application changed after the last review.',
      person_revision_changed: 'The person changed after the last review.',
      source_revision_changed: 'The source changed after the last review.',
      reviewer_authority_changed:
        'The previous reviewer no longer has active HR authority.',
      clearance_evidence_unverified:
        'The previous clearance evidence needs a fresh review.',
    }) as Record<string, string>
  )[hold] || 'Current evidence requires HR review.'
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const decision = (value: unknown): value is EducationDecision =>
  value === 'cleared' || value === 'held' || value === 'revoked'
const revision = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0
export function isEducationSnapshot(
  value: unknown,
): value is EducationSnapshot {
  if (!object(value)) return false
  const current = value.current
  const clearance = object(current) ? current.clearance : null
  const evidence = object(current) ? current.evidence : null
  return (
    typeof value.applicationId === 'string' &&
    revision(value.applicationRevision) &&
    revision(value.personRevision) &&
    typeof value.sourceFingerprint === 'string' &&
    typeof value.sourceVersion === 'string' &&
    revision(value.decisionVersion) &&
    (value.receiverVersionFloor === undefined ||
      revision(value.receiverVersionFloor)) &&
    Array.isArray(value.holds) &&
    value.holds.every((hold) => typeof hold === 'string') &&
    (current === null ||
      (object(current) &&
        typeof current.id === 'string' &&
        decision(current.decision) &&
        typeof current.withdrawn === 'boolean' &&
        typeof current.reviewerId === 'string' &&
        typeof current.issuedAt === 'string' &&
        typeof current.reason === 'string' &&
        object(clearance) &&
        object(evidence) &&
        educationCriteria.every(
          ([key]) =>
            typeof clearance[key] === 'boolean' &&
            typeof evidence[key] === 'string',
        ))) &&
    Array.isArray(value.outbox) &&
    value.outbox.every(
      (entry) =>
        object(entry) &&
        typeof entry.eventId === 'string' &&
        revision(entry.decisionVersion) &&
        decision(entry.decision) &&
        typeof entry.status === 'string' &&
        revision(entry.attempts) &&
        typeof entry.bodyHash === 'string' &&
        (entry.currentStatus === undefined ||
          typeof entry.currentStatus === 'string'),
    )
  )
}
