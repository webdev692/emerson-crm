import { discoveryResult, normalize, stages } from './rules'

// Browser-safe vocabulary only. No CRM persistence, account or transport imports.
export const studioCategories = [
  {
    id: 'websites-digital-development',
    label: 'Websites & Digital Development',
  },
  {
    id: 'sales-client-coordination',
    label: 'Sales Support & Client Coordination',
  },
  {
    id: 'human-resources-people-operations',
    label: 'Human Resources & People Operations',
  },
  {
    id: 'operations-project-management',
    label: 'Business Operations & Project Management',
  },
  { id: 'business-systems-automation', label: 'Business Systems & Automation' },
  {
    id: 'financial-records-organization',
    label: 'Financial Records & Business Organization',
  },
  {
    id: 'marketing-content-research',
    label: 'Marketing, Content & Business Research',
  },
  {
    id: 'technical-quality-security',
    label: 'Technical Review, Quality & Security',
  },
  { id: 'other', label: 'Other — help me describe the work' },
] as const

export type StudioInquiry = {
  businessName: string
  contactName: string
  email: string
  location: string
  category: string
  description: string
  outcome: string
  timeline: string
  budget: string
  currentSystems: string
  preferredContact: 'email' | 'none'
  privacyAcknowledged: boolean
}
export const syntheticInquiry: StudioInquiry = {
  businessName: 'Harbor Lantern Services',
  contactName: 'Casey Vale',
  email: 'casey@harbor-lantern.invalid',
  location: 'Fictional South Carolina business',
  category: 'websites-digital-development',
  description:
    'SYNTHETIC: Improve a small service website and organize an appointment-request workflow using fictional materials.',
  outcome:
    'SYNTHETIC: Clear mobile service pages and a documented appointment workflow for review, without sending messages or accepting bookings.',
  timeline: 'Discuss a suitable sequence during scoping; no deadline promised.',
  budget: '',
  currentSystems: 'Fictional static website and sample scheduling worksheet.',
  preferredContact: 'none',
  privacyAcknowledged: true,
}
export const inquiryFieldLimits = {
  businessName: 120,
  contactName: 120,
  email: 254,
  location: 160,
  category: 80,
  description: 1500,
  outcome: 1000,
  timeline: 240,
  budget: 160,
  currentSystems: 400,
} as const
export type InquiryErrors = Partial<
  Record<keyof StudioInquiry | 'form', string>
>
export type ValidationResult =
  { ok: true; value: StudioInquiry } | { ok: false; errors: InquiryErrors }
const inquiryKeys = [
  ...Object.keys(inquiryFieldLimits),
  'preferredContact',
  'privacyAcknowledged',
]
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const sensitivePattern =
  /-----BEGIN|\b(?:password|api[ _-]?key|access[ _-]?token|secret)\s*[:=]\s*\S+|\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]?){13,19}\b/i

export function validateStudioInquiry(input: unknown): ValidationResult {
  const errors: InquiryErrors = {}
  if (
    !object(input) ||
    Object.keys(input).length !== inquiryKeys.length ||
    inquiryKeys.some((key) => !Object.hasOwn(input, key))
  ) {
    return {
      ok: false,
      errors: {
        form: 'Use only the twelve preliminary inquiry fields. Attachments and additional fields are not accepted.',
      },
    }
  }
  const clean: Record<string, string | boolean> = {}
  for (const [key, limit] of Object.entries(inquiryFieldLimits)) {
    const value = input[key]
    if (
      typeof value !== 'string' ||
      value.length > limit ||
      (!['budget', 'currentSystems'].includes(key) && !value.trim())
    ) {
      errors[key as keyof StudioInquiry] =
        `Enter a value within the ${limit}-character limit.`
      continue
    }
    const controls = [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 &&
        ![9, 10, 13].includes(character.charCodeAt(0)),
    )
    if (/[<>]/.test(value) || controls || sensitivePattern.test(value)) {
      errors[key as keyof StudioInquiry] =
        'Use fictional plain text only. Remove code, credentials, financial identifiers and other sensitive details.'
      continue
    }
    clean[key] = value.trim()
  }
  if (clean.businessName !== syntheticInquiry.businessName)
    errors.businessName =
      'Use the provided fictional business for this isolated demonstration.'
  if (clean.contactName !== syntheticInquiry.contactName)
    errors.contactName =
      'Use the provided fictional contact for this isolated demonstration.'
  if (
    typeof clean.email !== 'string' ||
    normalize(clean.email) !== syntheticInquiry.email
  )
    errors.email =
      'Use the provided fictional .invalid email address; real addresses are not accepted.'
  if (
    typeof clean.location === 'string' &&
    !/fictional|synthetic/i.test(clean.location)
  )
    errors.location = 'Label this location fictional or synthetic.'
  if (!studioCategories.some((category) => category.id === clean.category))
    errors.category = 'Select a listed category or Other.'
  if (input.preferredContact !== 'email' && input.preferredContact !== 'none')
    errors.preferredContact =
      'Select a demonstrated contact preference; no message will be sent.'
  if (input.privacyAcknowledged !== true)
    errors.privacyAcknowledged =
      'Acknowledge the synthetic-only, no-sensitive-information notice.'
  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    value: {
      ...clean,
      email: syntheticInquiry.email,
      preferredContact: input.preferredContact,
      privacyAcknowledged: true,
    } as StudioInquiry,
  }
}

export const reviewOutcomes = [
  'new',
  'clarification',
  'feasibility',
  'suitable',
  'outside-scope',
  'hold',
  'declined',
] as const
export type ReviewOutcome = (typeof reviewOutcomes)[number]
export const reviewOutcomeMappings: Record<
  ReviewOutcome,
  { label: string; crmMapping: string }
> = {
  new: {
    label: 'New inquiry',
    crmMapping:
      'Service case New; a separately reviewed opportunity begins at S1 New Inquiry.',
  },
  clarification: {
    label: 'Needs clarification',
    crmMapping:
      'Service case Needs discovery and a next action; no automatic sales-stage change.',
  },
  feasibility: {
    label: 'Feasibility review',
    crmMapping:
      'Service case Needs discovery; qualification uses the existing five-criterion discovery assessment.',
  },
  suitable: {
    label: 'Suitable for proposal review',
    crmMapping:
      'Service case Ready for opportunity; S5/S6 require the actual recorded qualification and capacity gates.',
  },
  'outside-scope': {
    label: 'Outside current scope',
    crmMapping:
      'Review whether X1 Closed: Not a Fit applies to an existing opportunity; this observation does not close it.',
  },
  hold: {
    label: 'On hold',
    crmMapping:
      'Map the actual reason to H1 Regulated (TEA), H2 Needs Lyric Review or H3 Capacity after authorized review.',
  },
  declined: {
    label: 'Declined or closed',
    crmMapping:
      'Review service-case closure or X2 Closed: Declined with a reason; no automatic canonical-stage change.',
  },
}
export type DemoPersona =
  'guest' | 'client' | 'sales' | 'reviewer' | 'viewer' | 'outsider' | 'inactive'
export type DemoInquiryRecord = {
  id: string
  revision: number
  inquiry: StudioInquiry
  stage: 'S1'
  stageLabel: string
  reviewOutcome: ReviewOutcome
  reviewMapping: string
  receipt: string
  createdAt: string
  updatedAt: string
  potentialDuplicate: boolean
  review?: { reason: string; reviewer: string; reviewedAt: string }
}
export type DemoState = {
  synthetic: true
  session: { persona: DemoPersona; role: string; active: boolean }
  csrfToken: string
  inquiries: DemoInquiryRecord[]
  notice: string
}
export const rehearsalNotice =
  'Isolated synthetic demonstration. No real inquiry, CRM record, message, contract, payment, staffing assignment or client acceptance is created. State is held only in server memory and is discarded when the process stops.'

export function canonicalInquiry(value: StudioInquiry) {
  return JSON.stringify(
    Object.fromEntries(
      inquiryKeys.map((key) => [key, value[key as keyof StudioInquiry]]),
    ),
  )
}
export function assessSyntheticDiscovery(criteria: string[]) {
  return {
    result: discoveryResult(criteria),
    simulated: true as const,
    stageChanged: false as const,
  }
}
export function initialDemoRecord(
  id: string,
  inquiry: StudioInquiry,
  now: string,
  potentialDuplicate: boolean,
): DemoInquiryRecord {
  return {
    id,
    revision: 1,
    inquiry,
    stage: 'S1',
    stageLabel: stages.S1,
    reviewOutcome: 'new',
    reviewMapping: reviewOutcomeMappings.new.crmMapping,
    receipt: `DEMO-RECEIPT-${id}`,
    createdAt: now,
    updatedAt: now,
    potentialDuplicate,
  }
}

export const pilotSteps = [
  {
    id: 'inquiry',
    title: '1. Preliminary inquiry',
    summary:
      'Casey describes the fictional website and appointment-workflow need.',
    crmMapping: 'Intake review → service case New; no automatic opportunity.',
    evidence:
      'Synthetic inquiry SYN-PS5-001; no attachment or real contact destination.',
  },
  {
    id: 'category',
    title: '2. Project category',
    summary:
      'Website development is primary; client coordination is a related need.',
    crmMapping: 'Descriptive category metadata, not a new approved offer.',
    evidence:
      'Eight informational areas plus Other; individual scope review remains required.',
  },
  {
    id: 'triage',
    title: '3. Intake review',
    summary:
      'An assigned simulated sales reviewer checks completeness and duplicate warnings.',
    crmMapping:
      'Service case Needs discovery; the illustrative stage remains S1 and no CRM opportunity is created.',
    evidence:
      'Revision-checked review with server-associated simulated reviewer.',
  },
  {
    id: 'feasibility',
    title: '4. Feasibility assessment',
    summary:
      'A fictional technical reviewer records capability, capacity, privacy and access questions.',
    crmMapping:
      'Existing five-criterion discovery rule; uncertainty maps to H2, regulated need to H1.',
    evidence:
      'Synthetic rubric only; no staff qualification, capacity or commercial approval inferred.',
  },
  {
    id: 'discovery',
    title: '5. Discovery summary',
    summary:
      'Record the current process, desired outcome, exclusions and unanswered questions.',
    crmMapping:
      'Existing discovery record and S3/S4 evidence gates remain authoritative.',
    evidence:
      'Draft discovery template; no client conversation or acknowledgment sent.',
  },
  {
    id: 'proposal',
    title: '6. Project proposal',
    summary:
      'Prepare a versioned proposal for a website improvement and documented appointment workflow.',
    crmMapping:
      'Existing immutable proposal version + separate exact-revision approval.',
    evidence:
      'SIMULATED DRAFT V1; price, seller, signatory and legal terms unresolved.',
  },
  {
    id: 'scope',
    title: '7. Scope approval simulation',
    summary:
      'Inspect what would need to be approved before an engagement could start.',
    crmMapping:
      'S6/S7/S8 are not advanced: actual commercial approval, sending and written acceptance remain absent.',
    evidence:
      'Illustrative approval placeholder only; no executed agreement or price approval.',
  },
  {
    id: 'charter',
    title: '8. Project charter',
    summary:
      'Define scope references, responsibilities, acceptance criteria and dependencies.',
    crmMapping:
      'Future workorder linked to the exact accepted proposal, after actual capacity confirmation.',
    evidence:
      'Synthetic charter; lead, staffing, compensation and client authority remain decision items.',
  },
  {
    id: 'assignments',
    title: '9. Tasks and milestones',
    summary:
      'Show fictional role labels for content, implementation and independent review.',
    crmMapping:
      'Existing task references may support delivery planning; no real member assignment.',
    evidence:
      'Synthetic role labels only; no unpaid intern or actual staff assignment.',
  },
  {
    id: 'progress',
    title: '10. Progress updates',
    summary:
      'Inspect milestone status, a blocker, a feedback request and a proposed change.',
    crmMapping:
      'Separate delivery metadata and activity drafts, without replacing S1–S9.',
    evidence: 'No client email; no additional work or price change authorized.',
  },
  {
    id: 'quality',
    title: '11. Quality review',
    summary:
      'Check mobile layout, accessible controls, links, fictional workflow and known limitations.',
    crmMapping:
      'Delivery QA evidence is separate from the commercial sales stage.',
    evidence:
      'Illustrative checklist; no claim that a real client deliverable passed.',
  },
  {
    id: 'handoff',
    title: '12. Final handoff illustration',
    summary:
      'Review the files, documentation, client acceptance record and access-removal checklist.',
    crmMapping:
      'S9 is internal delivery acceptance, never payment or final client acceptance.',
    evidence:
      'Final client acceptance remains simulated/unexecuted; no resources or permissions transferred.',
  },
] as const
export function buildDemoBoard(inquiry?: DemoInquiryRecord) {
  return {
    synthetic: true as const,
    projectId: 'DEMO-PROJECT-001',
    inquiryId: inquiry?.id || 'SYN-PS5-001',
    responsibleRole: 'Simulated project lead — no real staff assigned',
    approvedWork: 'No real scope is approved; illustrative draft V1 only.',
    nextMilestone: 'Review fictional requirements and access boundaries',
    milestones: [
      {
        id: 'M1',
        title: 'Requirements and scope',
        status: 'Needs review',
        owner: 'Simulated sales reviewer',
        evidence: 'Draft discovery summary',
      },
      {
        id: 'M2',
        title: 'Website and workflow draft',
        status: 'Blocked',
        owner: 'Simulated technical lead',
        evidence:
          'Depends on scope, compensated staffing and client authority decisions',
      },
      {
        id: 'M3',
        title: 'Independent quality review',
        status: 'Not started',
        owner: 'Simulated quality reviewer',
        evidence: 'Acceptance checklist and versioned deliverable inventory',
      },
      {
        id: 'M4',
        title: 'Client acceptance and handoff',
        status: 'Not accepted',
        owner: 'Simulated client decision-maker',
        evidence: 'No actual client approval or access transfer',
      },
    ],
    overdue:
      'Illustrative review reminder only; no real deadline or service promise.',
    feedback:
      'Clarify the fictional service-page content and appointment-workflow boundaries.',
    reviewed:
      'Inquiry validation and synthetic duplicate check; delivery has not occurred.',
    blocked: [
      'Contracting entity and signatory',
      'Actual scope and price approval',
      'Compensated staffing and capacity',
      'Scoped access and data handling',
    ],
    handoffReady: false,
  }
}

// A feature flag cannot activate this adapter. A later implementation requires
// a separately reviewed code change, destination proof and founder approval.
export async function productionStudioAdapter(_input: unknown): Promise<never> {
  void _input
  throw new Error('Production Project Studio integration is disabled.')
}
