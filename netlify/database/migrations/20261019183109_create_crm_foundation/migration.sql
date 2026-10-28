CREATE TABLE "crm_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"record_id" uuid,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_members" (
	"id" uuid PRIMARY KEY,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"commercial" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"owner_id" uuid,
	"parent_id" uuid,
	"organization_id" uuid,
	"source_key" text,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_settings" (
	"key" text PRIMARY KEY,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_source_key_unique" ON "crm_records" ("kind","source_key");--> statement-breakpoint
ALTER TABLE "crm_records" ADD CONSTRAINT "crm_records_owner_id_crm_members_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "crm_members"("id");