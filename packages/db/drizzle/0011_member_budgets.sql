ALTER TABLE "api_selfservice"."cost_center_members" ADD COLUMN "budget" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "api_selfservice"."cost_centers" ADD COLUMN "member_budget" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "api_selfservice"."cost_centers" ADD COLUMN "member_budget_period" text;