import type { RecordData } from './crm-types'

// Shared UI/API vocabulary. These labels never grant server permissions.
export const foundationKinds = [
  'organization',
  'contact',
  'affiliation',
  'engagement',
  'application',
  'resource',
  'learning',
  'intake',
] as const
export const affiliations = [
  'Customer',
  'Class participant',
  'Community partner',
  'College contact',
  'Investor',
  'Program applicant',
  'Sales applicant',
  'Sales team',
  'Other',
] as const
export const workflows = {
  service: [
    'New',
    'Contacted',
    'Needs discovery',
    'Ready for opportunity',
    'Closed',
  ],
  class: ['New', 'Contacted', 'Registered', 'Attended', 'Completed', 'Closed'],
  partner: [
    'New',
    'Contacted',
    'Discussion',
    'Agreement review',
    'Active',
    'Closed',
  ],
  college: [
    'New',
    'Contacted',
    'Discussion',
    'Agreement review',
    'Active',
    'Closed',
  ],
  investor: ['New', 'Contacted', 'Discussion', 'Review', 'Committed', 'Closed'],
  program: [
    'Applied',
    'Screening',
    'Interview',
    'Decision',
    'Onboarding',
    'Active',
    'Closed',
  ],
  sales: [
    'Applied',
    'Screening',
    'Interview',
    'Decision',
    'Onboarding',
    'Training',
    'Active',
    'Closed',
  ],
} as const
export type FoundationWorkflow = keyof typeof workflows
export const workflowLabels: Record<FoundationWorkflow, string> = {
  service: 'Service inquiries',
  class: 'Classes',
  partner: 'Community partners',
  college: 'Colleges',
  investor: 'Investors',
  program: 'Program applicants',
  sales: 'Sales applicants',
}
export const resourceStatuses = [
  'Draft',
  'Needs review',
  'Approved',
  'Archived',
] as const
export const learningProgress = [
  'Not started',
  'In progress',
  'Submitted',
  'Completed',
] as const
export const contactPermissions = [
  'Unknown',
  'Service follow-up only',
  'Marketing permitted',
  'Do not contact',
] as const
export const accessLevels = ['record', 'team', 'hr'] as const
export const intakeStates = [
  'ready',
  'duplicate',
  'conflict',
  'invalid',
  'test',
  'applied',
  'excluded',
] as const
export const hasHrAccess = (member: { role: string; hr?: boolean }) =>
  member.role === 'owner' || member.hr === true
export const isHrWorkflow = (workflow: unknown) =>
  workflow === 'program' || workflow === 'sales'
export interface FoundationRecord {
  id: string
  kind: string
  title: string
  access?: string
  ownerId: string | null
  parentId: string | null
  organizationId: string | null
  sourceKey?: string | null
  revision: number
  data: RecordData
  createdAt?: string | Date
  updatedAt?: string | Date
}
export interface FoundationMember {
  id: string
  name: string
  email?: string
  role: string
  active: boolean
  hr?: boolean
  commercial?: boolean
}
