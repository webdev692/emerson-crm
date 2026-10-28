// JSON payload values remain extensible; known workflow fields carry their real shapes.
// These types describe stored/transported data, not authorization or input validation.
export type JsonValue =
  string | number | boolean | null | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue | undefined
}
export interface RecordData extends JsonObject {
  acceptedAt?: string
  acceptedBy?: string
  acknowledgmentDue?: string
  activityType?: string
  agreedDates?: string
  appliedAt?: string
  appliedBy?: string
  approvalReason?: string
  approvalStatus?: string
  approvedBy?: string
  assetUrl?: string
  assigneeId?: string
  audience?: string
  autoConfirmationEvidence?: string
  body?: string
  buyerStatements?: string
  capacityEvidence?: string
  capacityReviewer?: string
  capacityStatus?: string
  category?: string
  clientRequirements?: string
  clock?: string
  closeReason?: string
  closedAt?: string
  company?: string
  contactId?: string
  contactPermission?: string
  contactPreference?: string
  contactRoute?: string
  currency?: string
  decision?: string
  deliverables?: string
  deliveryLead?: string
  description?: string
  disclaimer?: string
  discoveryAt?: string
  documentationDue?: string
  documents?: string
  effectiveDate?: string
  email?: string
  evidence?: string
  exclusions?: string
  facts?: string
  familyId?: string
  fitRationale?: string
  heldAt?: string
  holdReason?: string
  identity?: string
  role?: string
  jobTitle?: string
  lastContact?: string
  location?: string
  method?: string
  missingInformation?: string
  name?: string
  nextAction?: string
  nextDue?: string
  nextStep?: string
  notes?: string
  occurredAt?: string
  offerId?: string
  organization?: string
  organizationType?: string
  outstandingInformation?: string
  ownershipReason?: string
  permissionEvidence?: string
  personId?: string
  phone?: string
  pricingModel?: string
  progress?: string
  proposalId?: string
  rationale?: string
  reason?: string
  recommendation?: string
  reference?: string
  relationship?: string
  researchId?: string
  researchedBy?: string
  resourceId?: string
  resourceType?: string
  result?: string
  resumeUrl?: string
  reviewFlag?: string
  scope?: string
  service?: string
  sessionDate?: string
  sourceCategory?: string
  sourceEvidence?: string
  sourceId?: string
  sourceName?: string
  sourceUrl?: string
  sourcedBy?: string
  stage?: string
  stageEvidence?: string
  stageReason?: string
  status?: string
  terms?: string
  timezone?: string
  usBased?: string
  validUntil?: string
  waiver?: string
  website?: string
  workflow?: string
  worksheetUrl?: string
  writtenAcceptance?: string
  applicantId?: string
  program?: string
  cohort?: string
  onboardingStatus?: string
  registrationStatus?: string
  className?: string
  sourceVersion?: string
  sourceFingerprint?: string
  sourceFingerprintVersion?: number
  sourceChanged?: boolean
  sourceChangeReason?: string
  sourceChangedAt?: string
  incomingFingerprint?: string
  incomingSourceVersion?: string
  sourceRow?: string
  completedBy?: string
  completedAt?: string
  reviewedBy?: string
  reviewedAt?: string
  reviewReason?: string
  caseId?: string
  version?: string | number
  resourceVersion?: string | number
  targetRevision?: number
  foundationVersion?: number
  price?: string | number | null
  suppressed?: boolean
  contactEvent?: boolean
  holdsPause?: boolean
  criteria?: string[]
  readers?: string[] | string
  candidatePersonIds?: string[]
  duplicateCandidates?: string[]
  identities?: string[]
  issues?: string[]
  workingDays?: number[]
  holidays?: string[]
  client?: JsonObject
  capacityConfirmation?: JsonObject
  commercialSnapshot?: RecordData
}
export interface RecordEnvelope {
  id?: string
  kind: string
  title?: string
  access?: string
  ownerId?: string | null
  parentId?: string | null
  organizationId?: string | null
  sourceKey?: string | null
  revision?: number
  data: RecordData
}
export type FoundationRequest =
  | { action: 'foundation-save'; record: RecordEnvelope }
  | {
      action: 'intake-preview'
      sourceName: string
      workflow: string
      rows: RecordData[]
    }
  | {
      action: 'intake-review'
      id: string
      revision: number
      decision: string
      reason: string
      personId?: string
    }
