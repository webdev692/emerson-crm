CREATE TABLE "crm_education_hosted_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"identity_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"receiver_version" integer NOT NULL,
	"target" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"state_hash" text NOT NULL,
	"source" text NOT NULL,
	"evidence_source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_education_hosted_observations" ADD CONSTRAINT "crm_education_hosted_observations_8XZ9Iqpk5vvp_fkey" FOREIGN KEY ("identity_id") REFERENCES "crm_education_hosted_identity"("id");--> statement-breakpoint
ALTER TABLE "crm_education_hosted_observations" ADD CONSTRAINT "crm_education_hosted_observations_9AZngoqLJsRW_fkey" FOREIGN KEY ("application_id") REFERENCES "crm_records"("id");
--> statement-breakpoint
-- No data is seeded. An actual operator observation is a separate reviewed DML
-- migration, made only after checking the exact receiver and before first review.
ALTER TABLE crm_education_hosted_observations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON crm_education_hosted_observations FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION crm_education_hosted_observation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE previous public.crm_education_hosted_observations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(7031926);
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Hosted receiver observations are append-only operator evidence' USING ERRCODE='55000';
  END IF;
  IF NEW.application_id<>'82000000-0000-4000-8000-000000000001'::uuid
     OR NEW.receiver_version<0 OR NEW.receiver_version>1000000
     OR NEW.source<>'verified-hosted-epdg'
     OR NEW.evidence_source !~ '^operator-receiver-observation:[A-Za-z0-9:_-]{1,120}$'
     OR NEW.state_hash !~ '^[0-9a-f]{64}$'
     OR NEW.observed_at<clock_timestamp()-INTERVAL '5 minutes'
     OR NEW.observed_at>clock_timestamp()
     OR NOT EXISTS(SELECT 1 FROM public.crm_education_hosted_identity i
       WHERE i.id=NEW.identity_id AND i.application_id=NEW.application_id AND i.synthetic_only
         AND i.database_name=current_database()
         AND NEW.target=i.backend_origin||'/internal/crm/onboarding-handoffs')
     OR EXISTS(SELECT 1 FROM public.crm_education_decisions WHERE application_id=NEW.application_id) THEN
    RAISE EXCEPTION 'Fresh pinned receiver observation required before first CRM decision' USING ERRCODE='55000';
  END IF;
  SELECT * INTO previous FROM public.crm_education_hosted_observations
    WHERE application_id=NEW.application_id ORDER BY observed_at DESC LIMIT 1;
  IF FOUND AND (NEW.identity_id<>previous.identity_id OR NEW.target<>previous.target
      OR NEW.observed_at<=previous.observed_at OR NEW.receiver_version<previous.receiver_version
      OR (NEW.receiver_version=previous.receiver_version AND NEW.state_hash<>previous.state_hash)) THEN
    RAISE EXCEPTION 'Receiver observation cannot regress or contradict retained evidence' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION crm_education_hosted_observation_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER crm_education_hosted_observation_guard BEFORE INSERT OR UPDATE OR DELETE
ON crm_education_hosted_observations FOR EACH ROW EXECUTE FUNCTION crm_education_hosted_observation_guard();
