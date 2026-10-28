CREATE TABLE "crm_education_receiver_checkpoints" (
	"application_id" uuid PRIMARY KEY,
	"receiver_version" integer NOT NULL,
	"target" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"state_hash" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_education_receiver_checkpoints" ADD CONSTRAINT "crm_education_receiver_checkpoints_FUll0cUaDw7Y_fkey" FOREIGN KEY ("application_id") REFERENCES "crm_records"("id");
--> statement-breakpoint
-- A trusted local operator may checkpoint the receiver once, before the first
-- actual CRM decision. No edit/bootstrap endpoint or fabricated history exists.
CREATE FUNCTION crm_education_receiver_checkpoint_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(7031926);
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Receiver checkpoints are immutable operator observations' USING ERRCODE = '55000';
  END IF;
  IF NEW.application_id <> '82000000-0000-4000-8000-000000000001'::uuid
     OR NEW.receiver_version < 0 OR NEW.receiver_version > 1000000
     OR NEW.target <> 'http://127.0.0.1:58000/internal/crm/onboarding-handoffs'
     OR NEW.source <> 'verified-local-epdg'
     OR NEW.state_hash !~ '^[0-9a-f]{64}$'
     OR NEW.observed_at < clock_timestamp() - INTERVAL '5 minutes'
     OR NEW.observed_at > clock_timestamp() + INTERVAL '30 seconds'
     OR EXISTS (SELECT 1 FROM crm_education_decisions WHERE application_id = NEW.application_id) THEN
    RAISE EXCEPTION 'Fresh verified local receiver checkpoint required before CRM decisions' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER crm_education_receiver_checkpoint_guard
BEFORE INSERT OR UPDATE OR DELETE ON crm_education_receiver_checkpoints
FOR EACH ROW EXECUTE FUNCTION crm_education_receiver_checkpoint_guard();
