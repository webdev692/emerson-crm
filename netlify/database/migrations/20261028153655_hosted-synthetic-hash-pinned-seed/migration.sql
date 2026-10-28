-- Reviewed forward DML: exact production database and owner commitments verified
-- read-only at 2026-10-28T15:28:56Z. Compiled profile remains disabled for rollout.
-- Audit hash names those reviewed disabled-profile bytes; no decisions are seeded.
-- Invited/confirmed current Identity is reverified server-side before any decision.
-- No staff/account/role, approval, decision, outbox or receiver state is seeded.
DO $seed$
DECLARE
  approved boolean := true;
  target_and_existing_membership_verified boolean := true;
  compiled_profile_sha256 text := '117a911b086c9b185b4975476f31129ef4c4f1fdb6b0affac67840f910d553c8';
  database_identity uuid := 'd3ddee8d-047a-456d-9c3d-a7dca7234329';
  crm_origin text := 'https://emerson-crm.netlify.app';
  backend_origin text := 'https://epdg-practice-api-synthetic-hosted.up.railway.app';
  fixture_source_key text := 'epdg-hosted-synthetic:2026-10-27:d3ddee8d-047a-456d-9c3d-a7dca7234329';
  -- Commitments to an existing owner, never a public account UUID or address.
  -- Current server Identity and membership must both be verified separately.
  reviewer_id_sha256 text := 'd6ea5f48b90876b6f6ab1e50783c119dfb449b61ffebd9ea767626a65fc9c5b6';
  reviewer_identity_sha256 text := '6f4f246f62900b833ed523281ee31838a6fc58760534dcaad3540b4d51e366d1';
  existing_reviewer uuid;
  reviewer_matches integer;
  source_fingerprint text := encode(sha256(convert_to(
    '{"source":"SYNTHETIC hosted education fixture","row":"fictional-learner-b","version":"hosted-fixture-v1"}',
    'UTF8')), 'hex');
BEGIN
  PERFORM pg_advisory_xact_lock(7031926);
  IF NOT approved OR NOT target_and_existing_membership_verified
     OR current_database()<>'netlifydb'
     OR compiled_profile_sha256 IS NULL OR compiled_profile_sha256 !~ '^[0-9a-f]{64}$'
     OR database_identity IS NULL OR crm_origin IS NULL OR backend_origin IS NULL
     OR fixture_source_key IS NULL
     OR reviewer_id_sha256 IS NULL OR reviewer_id_sha256 !~ '^[0-9a-f]{64}$'
     OR reviewer_identity_sha256 IS NULL OR reviewer_identity_sha256 !~ '^[0-9a-f]{64}$'
     OR crm_origin !~ '^https://[a-z0-9.-]+$' OR backend_origin !~ '^https://[a-z0-9.-]+$'
     OR crm_origin=backend_origin
     OR fixture_source_key !~ '^epdg-hosted-synthetic:[A-Za-z0-9:_-]{1,120}$' THEN
    RAISE EXCEPTION 'Disabled template: exact verified hosted profile and database required' USING ERRCODE='55000';
  END IF;
  SELECT count(*)::integer,min(m.id::text)::uuid INTO reviewer_matches,existing_reviewer
    FROM public.crm_members m WHERE m.active AND m.role='owner'
      AND m.email=btrim(m.email) AND m.email !~* '\.invalid$'
      AND encode(sha256(convert_to(m.id::text,'UTF8')),'hex')=reviewer_id_sha256
      AND encode(sha256(convert_to(m.id::text||'|'||lower(m.email),'UTF8')),'hex')=reviewer_identity_sha256;
  IF reviewer_matches<>1 OR existing_reviewer IS NULL THEN
    RAISE EXCEPTION 'Existing current verified owner membership required; no grants are performed' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM public.crm_records WHERE id IN (
      '81000000-0000-4000-8000-000000000001'::uuid,
      '82000000-0000-4000-8000-000000000001'::uuid,
      '83000000-0000-4000-8000-000000000001'::uuid,
      '88000000-0000-4000-8000-000000000001'::uuid))
      OR EXISTS(SELECT 1 FROM public.crm_records WHERE source_key=fixture_source_key)
      OR EXISTS(SELECT 1 FROM public.crm_education_hosted_identity) THEN
    RAISE EXCEPTION 'Synthetic seed collision: operator review required, no row replacement allowed' USING ERRCODE='55000';
  END IF;
  INSERT INTO public.crm_records(id,kind,title,access,owner_id,data) VALUES
    ('81000000-0000-4000-8000-000000000001','contact','SYNTHETIC hosted learner B','hr',existing_reviewer,
      '{"educationFixture":true,"email":"learner-b@epdg.invalid","contactPermission":"Do not contact","suppressed":true}'::jsonb),
    ('83000000-0000-4000-8000-000000000001','organization','SYNTHETIC hosted education program','hr',existing_reviewer,
      '{"educationFixture":true,"educationProgram":true}'::jsonb);
  INSERT INTO public.crm_records(id,kind,title,access,owner_id,source_key,data) VALUES
    ('82000000-0000-4000-8000-000000000001','application','SYNTHETIC hosted program application','hr',existing_reviewer,fixture_source_key,
      '{"workflow":"program","educationFixture":true,"personId":"81000000-0000-4000-8000-000000000001","crmProgramId":"83000000-0000-4000-8000-000000000001","stage":"Applied","sourceVersion":"hosted-fixture-v1"}'::jsonb),
    ('88000000-0000-4000-8000-000000000001','intake','SYNTHETIC hosted program intake','hr',existing_reviewer,fixture_source_key,
      jsonb_build_object('workflow','program','educationFixture',true,'status','applied',
        'caseId','82000000-0000-4000-8000-000000000001','personId','81000000-0000-4000-8000-000000000001',
        'sourceName','SYNTHETIC hosted education fixture','sourceId','fictional-learner-b',
        'sourceVersion','hosted-fixture-v1','sourceFingerprint',source_fingerprint));
  INSERT INTO public.crm_education_hosted_identity(id,site_id,database_name,crm_origin,backend_origin,
      application_id,person_id,program_id,source_key,reviewer_ids,synthetic_only) VALUES
    (database_identity,'c83673f3-4449-4ede-b336-33bb3d816de8','netlifydb',crm_origin,backend_origin,
      '82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',fixture_source_key,jsonb_build_array(existing_reviewer::text),true);
  INSERT INTO public.crm_audit(record_id,actor_id,action,after)
    SELECT r.id,existing_reviewer,'synthetic hosted fixture seeded',
      jsonb_build_object('educationFixture',true,'sourceKey',fixture_source_key,'compiledProfileSha256',compiled_profile_sha256)
    FROM public.crm_records r WHERE r.id IN (
      '81000000-0000-4000-8000-000000000001'::uuid,'82000000-0000-4000-8000-000000000001'::uuid,
      '83000000-0000-4000-8000-000000000001'::uuid,'88000000-0000-4000-8000-000000000001'::uuid);
END;
$seed$;
