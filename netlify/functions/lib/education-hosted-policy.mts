import { and, desc, eq, sql } from 'drizzle-orm'
import {
  educationHostedIdentity,
  educationHostedObservations,
} from '../../../db/schema'
import { FIXTURE_IDS } from './education-handoff.mts'
import {
  hostedReviewerAllowed,
  parseHostedEducationProfile,
  serializeHostedDecision,
} from './education-hosted.mts'
import type { HostedEducationProfile } from './education-hosted.mts'
import type {
  EducationMember,
  EducationPolicy,
  EducationTransaction,
} from './education-policy.mts'

const unavailable = (): never => {
  throw Object.assign(
    new Error('Hosted synthetic education identity is unavailable'),
    { status: 503 },
  )
}
const checked = (condition: unknown) => {
  if (!condition) unavailable()
}

// This check runs under the same transaction/advisory lock as source and HR
// authorization. The marker is inserted only by a reviewed operator migration.
export async function checkHostedEducationDatabase(
  tx: EducationTransaction,
  profile: HostedEducationProfile,
): Promise<void> {
  const database = await tx.execute(
    sql`SELECT current_database() AS database_name`,
  )
  checked(
    database.rows.length === 1 &&
      database.rows[0].database_name === profile.databaseName,
  )
  const [marker] = await tx
    .select()
    .from(educationHostedIdentity)
    .where(eq(educationHostedIdentity.id, profile.databaseIdentity))
  checked(
    marker &&
      marker.siteId === profile.siteId &&
      marker.databaseName === profile.databaseName &&
      marker.crmOrigin === profile.crmOrigin &&
      marker.backendOrigin === profile.backendOrigin &&
      marker.applicationId === FIXTURE_IDS.applicationId &&
      marker.personId === FIXTURE_IDS.personId &&
      marker.programId === FIXTURE_IDS.crmProgramId &&
      marker.sourceKey === profile.fixtureSourceKey &&
      marker.syntheticOnly === true &&
      Array.isArray(marker.reviewerIds) &&
      JSON.stringify([...marker.reviewerIds].sort()) ===
        JSON.stringify(profile.reviewers.map((r) => r.memberId).sort()),
  )
  const readiness = await tx.execute(sql`SELECT
    (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='crm_education_hosted_identity') AS rls,
    (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='crm_education_hosted_observations') AS observation_rls,
    (SELECT count(*)::integer FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='crm_education_hosted_identity' AND NOT t.tgisinternal
        AND t.tgenabled='O' AND t.tgtype=31 AND t.tgname='crm_education_hosted_identity_guard'
        AND t.tgfoid=to_regprocedure('public.crm_education_hosted_identity_guard()')) AS guards,
    (SELECT count(*)::integer FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='crm_education_hosted_observations' AND NOT t.tgisinternal
        AND t.tgenabled='O' AND t.tgtype=31 AND t.tgname='crm_education_hosted_observation_guard'
        AND t.tgfoid=to_regprocedure('public.crm_education_hosted_observation_guard()')) AS observation_guards,
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('crm_education_hosted_identity_guard','crm_education_hosted_observation_guard') AND p.prosecdef) AS definer,
    EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public'
      AND table_name IN ('crm_education_hosted_identity','crm_education_hosted_observations') AND grantee IN ('PUBLIC','anon','authenticated')) OR
    EXISTS(SELECT 1 FROM information_schema.role_column_grants WHERE table_schema='public'
      AND table_name IN ('crm_education_hosted_identity','crm_education_hosted_observations') AND grantee IN ('PUBLIC','anon','authenticated')) OR
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      LEFT JOIN pg_roles r ON r.oid=acl.grantee WHERE n.nspname='public'
        AND p.proname IN ('crm_education_hosted_identity_guard','crm_education_hosted_observation_guard')
        AND (acl.grantee=0 OR r.rolname IN ('anon','authenticated'))) AS browser_grants`)
  const row = readiness.rows[0]
  checked(
    row?.rls === true &&
      row.observation_rls === true &&
      row.guards === 1 &&
      row.observation_guards === 1 &&
      row.definer === false &&
      row.browser_grants === false,
  )
}

export function createHostedEducationPolicy(
  input: HostedEducationProfile,
  verifyReviewer: (member: EducationMember) => Promise<boolean>,
): EducationPolicy {
  const profile = parseHostedEducationProfile(input)
  return Object.freeze({
    environment: 'synthetic-hosted',
    target: profile.backendOrigin + '/internal/crm/onboarding-handoffs',
    checkpointSource: 'verified-hosted-epdg',
    fixtureSourceKey: profile.fixtureSourceKey,
    beforeTransaction: (tx: EducationTransaction) =>
      checkHostedEducationDatabase(tx, profile),
    reviewerAllowed: (member: EducationMember | undefined) =>
      hostedReviewerAllowed(profile, member),
    verifyReviewer,
    receiverCheckpoint: async (
      tx: EducationTransaction,
      applicationId: string,
    ) =>
      (
        await tx
          .select()
          .from(educationHostedObservations)
          .where(
            and(
              eq(educationHostedObservations.applicationId, applicationId),
              eq(
                educationHostedObservations.identityId,
                profile.databaseIdentity,
              ),
            ),
          )
          .orderBy(desc(educationHostedObservations.observedAt))
          .limit(1)
      )[0],
    serializeDecision: serializeHostedDecision,
  })
}
