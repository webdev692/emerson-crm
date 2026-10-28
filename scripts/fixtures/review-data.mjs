const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const owner = {
  id: id(1),
  name: 'PILOT TEST Owner',
  email: 'owner@example.invalid',
  role: 'owner',
  active: true,
  hr: true,
  commercial: false,
}
const next = {
  nextAction: 'Review synthetic source',
  nextDue: '2026-10-27T15:00:00.000Z',
}
const record = (n, kind, title, data = {}, extra = {}) => ({
  id: id(n),
  kind,
  title,
  ownerId: owner.id,
  parentId: null,
  organizationId: null,
  access: 'team',
  revision: 1,
  createdAt: '2026-10-24T15:00:00.000Z',
  updatedAt: '2026-10-24T15:00:00.000Z',
  data,
  ...extra,
})
const records = [
  record(10, 'contact', 'PILOT TEST Avery', {
    name: 'PILOT TEST Avery',
    email: 'avery@example.invalid',
    contactPermission: 'Unknown',
  }),
  record(11, 'organization', 'PILOT TEST Community Center', {
    website: 'https://community.example.invalid',
  }),
  record(12, 'organization', 'PILOT TEST College', {
    website: 'https://college.example.invalid',
  }),
  record(
    13,
    'affiliation',
    'PILOT TEST Community affiliation',
    { personId: id(10), relationship: 'Community partner' },
    { organizationId: id(11) },
  ),
  record(
    14,
    'affiliation',
    'PILOT TEST College affiliation',
    { personId: id(10), relationship: 'College contact' },
    { organizationId: id(12) },
  ),
  record(20, 'engagement', 'PILOT TEST Class interest', {
    personId: id(10),
    workflow: 'class',
    stage: 'New',
    ...next,
  }),
  record(21, 'engagement', 'PILOT TEST Partner conversation', {
    personId: id(10),
    workflow: 'partner',
    stage: 'Discussion',
    ...next,
  }),
  record(
    22,
    'application',
    'PILOT TEST Sales application',
    {
      personId: id(10),
      workflow: 'sales',
      stage: 'Screening',
      ...next,
      notes: 'Synthetic restricted application.',
    },
    { access: 'hr' },
  ),
  record(30, 'resource', 'PILOT TEST Welcome template', {
    resourceType: 'template',
    familyId: 'synthetic-welcome',
    version: 1,
    status: 'Draft',
    audience: 'team',
    body: 'Hello {{firstName}}, thank you for your interest. A team member will follow up.',
    sourceUrl: 'https://example.invalid/template',
  }),
  record(31, 'resource', 'PILOT TEST CRM orientation', {
    resourceType: 'training',
    familyId: 'synthetic-orientation',
    version: 1,
    status: 'Approved',
    audience: 'team',
    sourceUrl: 'https://example.invalid/orientation',
    assetUrl: 'https://example.invalid/orientation',
    approvedBy: owner.id,
    approvedAt: '2026-10-24T15:00:00.000Z',
    approvalReason: 'Synthetic visual review only.',
  }),
  record(
    40,
    'intake',
    'PILOT TEST Incoming class interest',
    {
      sourceName: 'synthetic-local-review',
      sourceId: 'row-1',
      workflow: 'class',
      status: 'ready',
      name: 'PILOT TEST Incoming',
      email: 'incoming@example.invalid',
      contactPermission: 'Unknown',
      ...next,
    },
    { access: 'record' },
  ),
]

export { owner, records }
export const reviewPayload = {
  member: owner,
  staff: [owner],
  records,
  settings: [],
}
