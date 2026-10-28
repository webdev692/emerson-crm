CREATE TABLE "crm_education_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"application_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"application_revision" integer NOT NULL,
	"person_revision" integer NOT NULL,
	"source_key" text NOT NULL,
	"source_fingerprint" text NOT NULL,
	"source_version" text NOT NULL,
	"decision_version" integer NOT NULL,
	"decision" text NOT NULL,
	"withdrawn" boolean NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"clearance" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"criterion_reviews" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_education_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"event_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"decision_version" integer NOT NULL,
	"decision" text NOT NULL,
	"raw_body" text NOT NULL,
	"body_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"receipt" jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_education_decision_version_unique" ON "crm_education_decisions" ("application_id","decision_version");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_education_event_unique" ON "crm_education_outbox" ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_education_outbox_decision_unique" ON "crm_education_outbox" ("decision_id");--> statement-breakpoint
ALTER TABLE "crm_education_decisions" ADD CONSTRAINT "crm_education_decisions_application_id_crm_records_id_fkey" FOREIGN KEY ("application_id") REFERENCES "crm_records"("id");--> statement-breakpoint
ALTER TABLE "crm_education_decisions" ADD CONSTRAINT "crm_education_decisions_person_id_crm_records_id_fkey" FOREIGN KEY ("person_id") REFERENCES "crm_records"("id");--> statement-breakpoint
ALTER TABLE "crm_education_decisions" ADD CONSTRAINT "crm_education_decisions_program_id_crm_records_id_fkey" FOREIGN KEY ("program_id") REFERENCES "crm_records"("id");--> statement-breakpoint
ALTER TABLE "crm_education_decisions" ADD CONSTRAINT "crm_education_decisions_reviewer_id_crm_members_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "crm_members"("id");--> statement-breakpoint
ALTER TABLE "crm_education_outbox" ADD CONSTRAINT "crm_education_outbox_DIdGLcBtOqiA_fkey" FOREIGN KEY ("decision_id") REFERENCES "crm_education_decisions"("id");--> statement-breakpoint
ALTER TABLE "crm_education_outbox" ADD CONSTRAINT "crm_education_outbox_application_id_crm_records_id_fkey" FOREIGN KEY ("application_id") REFERENCES "crm_records"("id");
--> statement-breakpoint
-- Append-only source decisions and exact-byte retry evidence remain immutable.
CREATE FUNCTION crm_education_decision_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Education decisions are append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER crm_education_decision_append_only_guard
BEFORE UPDATE OR DELETE ON crm_education_decisions
FOR EACH ROW EXECUTE FUNCTION crm_education_decision_append_only();
--> statement-breakpoint
CREATE FUNCTION crm_education_outbox_immutable_body() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Education outbox evidence cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW.id, NEW.event_id, NEW.decision_id, NEW.application_id,
         NEW.decision_version, NEW.decision, NEW.raw_body, NEW.body_hash)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.event_id, OLD.decision_id, OLD.application_id,
         OLD.decision_version, OLD.decision, OLD.raw_body, OLD.body_hash) THEN
    RAISE EXCEPTION 'Education outbox body is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'Education dispatch attempts cannot be erased' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER crm_education_outbox_immutable_body_guard
BEFORE UPDATE OR DELETE ON crm_education_outbox
FOR EACH ROW EXECUTE FUNCTION crm_education_outbox_immutable_body();
