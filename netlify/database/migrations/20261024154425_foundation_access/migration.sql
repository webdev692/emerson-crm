ALTER TABLE "crm_members" ADD COLUMN "hr" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_records" ADD COLUMN "access" text DEFAULT 'record' NOT NULL;