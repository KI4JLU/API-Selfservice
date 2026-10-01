ALTER TABLE "api_selfservice"."api_keys" ADD COLUMN "budget_period" text;--> statement-breakpoint
ALTER TABLE "api_selfservice"."cost_centers" ADD COLUMN "models" text[] DEFAULT '{}'::text[] NOT NULL;