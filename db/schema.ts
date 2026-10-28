import type { RecordData, JsonObject } from '../src/lib/crm-types'
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
export const members = pgTable('crm_members', {
  id: uuid().primaryKey(),
  email: text().notNull(),
  name: text().notNull(),
  role: text().notNull(),
  active: boolean().notNull().default(true),
  commercial: boolean().notNull().default(false),
  hr: boolean().notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})
// Typed record kinds share a revisioned envelope; relationships are real foreign keys.
export const records = pgTable(
  'crm_records',
  {
    id: uuid().defaultRandom().primaryKey(),
    kind: text().notNull(),
    title: text().notNull(),
    access: text().notNull().default('record'),
    ownerId: uuid('owner_id').references(() => members.id),
    parentId: uuid('parent_id').references((): AnyPgColumn => records.id),
    organizationId: uuid('organization_id').references(
      (): AnyPgColumn => records.id,
    ),
    sourceKey: text('source_key'),
    data: jsonb().$type<RecordData>().notNull().default({}),
    revision: integer().notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex('crm_source_key_unique').on(t.kind, t.sourceKey)],
)
export const audit = pgTable('crm_audit', {
  id: uuid().defaultRandom().primaryKey(),
  recordId: uuid('record_id'),
  actorId: uuid('actor_id').notNull(),
  action: text().notNull(),
  before: jsonb(),
  after: jsonb(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})
export const settings = pgTable('crm_settings', {
  key: text().primaryKey(),
  data: jsonb().$type<JsonObject>().notNull(),
})

// Local synthetic education review stream. No account, enrollment or permission
// grant is represented by these append-only decisions.
export type EducationClearance = {
  identity_verified: boolean
  onboarding_complete: boolean
  agreements_complete: boolean
  hr_approved: boolean
}
export type EducationEvidence = Record<keyof EducationClearance, string>
export type EducationCriterionReviews = Record<
  keyof EducationClearance,
  {
    value: boolean
    reviewerId: string
    reviewedAt: string
    evidence: string
  }
>
export const educationDecisions = pgTable(
  'crm_education_decisions',
  {
    id: uuid().defaultRandom().primaryKey(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => records.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => records.id),
    programId: uuid('program_id')
      .notNull()
      .references(() => records.id),
    applicationRevision: integer('application_revision').notNull(),
    personRevision: integer('person_revision').notNull(),
    sourceKey: text('source_key').notNull(),
    sourceFingerprint: text('source_fingerprint').notNull(),
    sourceVersion: text('source_version').notNull(),
    decisionVersion: integer('decision_version').notNull(),
    decision: text().notNull(),
    withdrawn: boolean().notNull(),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => members.id),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    reason: text().notNull(),
    clearance: jsonb().$type<EducationClearance>().notNull(),
    evidence: jsonb().$type<EducationEvidence>().notNull(),
    criterionReviews: jsonb('criterion_reviews')
      .$type<EducationCriterionReviews>()
      .notNull(),
  },
  (t) => [
    uniqueIndex('crm_education_decision_version_unique').on(
      t.applicationId,
      t.decisionVersion,
    ),
  ],
)
export const educationOutbox = pgTable(
  'crm_education_outbox',
  {
    id: uuid().defaultRandom().primaryKey(),
    eventId: uuid('event_id').notNull(),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => educationDecisions.id),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => records.id),
    decisionVersion: integer('decision_version').notNull(),
    decision: text().notNull(),
    rawBody: text('raw_body').notNull(),
    bodyHash: text('body_hash').notNull(),
    status: text().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    receipt: jsonb().$type<JsonObject>(),
  },
  (t) => [
    uniqueIndex('crm_education_event_unique').on(t.eventId),
    uniqueIndex('crm_education_outbox_decision_unique').on(t.decisionId),
  ],
)

// Operator-seeded resume metadata is private to the synthetic HR workflow. It is
// not historical CRM decision evidence and has no browser/API writer.
export const educationReceiverCheckpoints = pgTable(
  'crm_education_receiver_checkpoints',
  {
    applicationId: uuid('application_id')
      .primaryKey()
      .references(() => records.id),
    receiverVersion: integer('receiver_version').notNull(),
    target: text().notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    stateHash: text('state_hash').notNull(),
    source: text().notNull(),
  },
)

// Operator migration metadata only. No browser/API writer exists; this is not a
// staff grant or an applicant record. It pins the hosted bridge's fictional scope.
export const educationHostedIdentity = pgTable(
  'crm_education_hosted_identity',
  {
    id: uuid().primaryKey(),
    siteId: uuid('site_id').notNull(),
    databaseName: text('database_name').notNull(),
    crmOrigin: text('crm_origin').notNull(),
    backendOrigin: text('backend_origin').notNull(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => records.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => records.id),
    programId: uuid('program_id')
      .notNull()
      .references(() => records.id),
    sourceKey: text('source_key').notNull(),
    reviewerIds: jsonb('reviewer_ids').$type<string[]>().notNull(),
    syntheticOnly: boolean('synthetic_only').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
)

// Append-only operator observations permit a delayed first hosted review to use
// freshly verified receiver state. There is no application/API writer.
export const educationHostedObservations = pgTable(
  'crm_education_hosted_observations',
  {
    id: uuid().defaultRandom().primaryKey(),
    identityId: uuid('identity_id')
      .notNull()
      .references(() => educationHostedIdentity.id),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => records.id),
    receiverVersion: integer('receiver_version').notNull(),
    target: text().notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    stateHash: text('state_hash').notNull(),
    source: text().notNull(),
    evidenceSource: text('evidence_source').notNull(),
  },
)
