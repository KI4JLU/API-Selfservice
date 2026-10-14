CREATE TABLE "api_selfservice"."app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_selfservice"."sap_exports" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"month" text NOT NULL,
	"document_date" text NOT NULL,
	"posting_date" text NOT NULL,
	"sender_cost_center" text NOT NULL,
	"row_count" integer NOT NULL,
	"total" numeric(14, 6) NOT NULL,
	"csv" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_selfservice"."cost_centers" ADD COLUMN "sap_recipient_type" text;--> statement-breakpoint
ALTER TABLE "api_selfservice"."cost_centers" ADD COLUMN "sap_recipient_number" text;--> statement-breakpoint
CREATE INDEX "sap_exports_created_idx" ON "api_selfservice"."sap_exports" USING btree ("created_at");