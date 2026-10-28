CREATE TABLE "crm_education_hosted_identity" (
	"id" uuid PRIMARY KEY,
	"site_id" uuid NOT NULL,
	"database_name" text NOT NULL,
	"crm_origin" text NOT NULL,
	"backend_origin" text NOT NULL,
	"application_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"reviewer_ids" jsonb NOT NULL,
	"synthetic_only" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_education_hosted_identity" ADD CONSTRAINT "crm_education_hosted_identity_wKv6wWPtZk6D_fkey" FOREIGN KEY ("application_id") REFERENCES "crm_records"("id");--> statement-breakpoint
ALTER TABLE "crm_education_hosted_identity" ADD CONSTRAINT "crm_education_hosted_identity_person_id_crm_records_id_fkey" FOREIGN KEY ("person_id") REFERENCES "crm_records"("id");--> statement-breakpoint
ALTER TABLE "crm_education_hosted_identity" ADD CONSTRAINT "crm_education_hosted_identity_program_id_crm_records_id_fkey" FOREIGN KEY ("program_id") REFERENCES "crm_records"("id");
--> statement-breakpoint
-- No marker/fixture/staff rows are seeded here. Enabling the profile requires a
-- separate reviewed operator DML migration after target and reviewer verification.
ALTER TABLE crm_education_hosted_identity ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON crm_education_hosted_identity FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION crm_education_hosted_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE reviewer text;
BEGIN
  PERFORM pg_advisory_xact_lock(7031926);
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Hosted bridge identity is immutable operator metadata' USING ERRCODE='55000';
  END IF;
  IF current_database()<>NEW.database_name OR NOT NEW.synthetic_only
     OR NEW.site_id<>'c83673f3-4449-4ede-b336-33bb3d816de8'::uuid
     OR NEW.application_id<>'82000000-0000-4000-8000-000000000001'::uuid
     OR NEW.person_id<>'81000000-0000-4000-8000-000000000001'::uuid
     OR NEW.program_id<>'83000000-0000-4000-8000-000000000001'::uuid
     OR NEW.source_key !~ '^epdg-hosted-synthetic:[A-Za-z0-9:_-]{1,120}$'
     OR NEW.crm_origin !~ '^https://[a-z0-9.-]+$' OR NEW.backend_origin !~ '^https://[a-z0-9.-]+$'
     OR NEW.crm_origin=NEW.backend_origin
     OR jsonb_typeof(NEW.reviewer_ids)<>'array' OR jsonb_array_length(NEW.reviewer_ids) NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION 'Pinned hosted synthetic bridge identity required' USING ERRCODE='55000';
  END IF;
  FOR reviewer IN SELECT jsonb_array_elements_text(NEW.reviewer_ids) LOOP
    IF reviewer !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR NOT EXISTS(
      SELECT 1 FROM public.crm_members m WHERE m.id=reviewer::uuid AND m.active AND m.role<>'viewer'
        AND (m.role='owner' OR m.hr) AND m.email !~* '\.invalid$') THEN
      RAISE EXCEPTION 'Existing verified hosted HR reviewer required' USING ERRCODE='55000';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION crm_education_hosted_identity_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER crm_education_hosted_identity_guard BEFORE INSERT OR UPDATE OR DELETE
ON crm_education_hosted_identity FOR EACH ROW EXECUTE FUNCTION crm_education_hosted_identity_guard();
--> statement-breakpoint
-- Preserve the exact local checkpoint contract, adding only the pinned hosted
-- identity as another explicit operator-observed target. No API writer exists.
CREATE OR REPLACE FUNCTION crm_education_receiver_checkpoint_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target_allowed boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(7031926);
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Receiver checkpoints are immutable operator observations' USING ERRCODE='55000';
  END IF;
  target_allowed=(NEW.target='http://127.0.0.1:58000/internal/crm/onboarding-handoffs' AND NEW.source='verified-local-epdg')
    OR (NEW.source='verified-hosted-epdg' AND EXISTS(SELECT 1 FROM public.crm_education_hosted_identity i
      WHERE i.application_id=NEW.application_id AND i.synthetic_only
        AND i.database_name=current_database() AND NEW.target=i.backend_origin||'/internal/crm/onboarding-handoffs'));
  IF NEW.application_id<>'82000000-0000-4000-8000-000000000001'::uuid
    OR NEW.receiver_version<0 OR NEW.receiver_version>1000000 OR NOT target_allowed
    OR NEW.state_hash !~ '^[0-9a-f]{64}$'
    OR NEW.observed_at<clock_timestamp()-INTERVAL '5 minutes'
    OR NEW.observed_at>clock_timestamp()+INTERVAL '30 seconds'
    OR EXISTS(SELECT 1 FROM public.crm_education_decisions WHERE application_id=NEW.application_id) THEN
    RAISE EXCEPTION 'Fresh verified receiver checkpoint required before CRM decisions' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
