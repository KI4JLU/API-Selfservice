ALTER TABLE "api_selfservice"."cost_centers" ADD COLUMN "litellm_team_id" text;--> statement-breakpoint
ALTER TABLE "api_selfservice"."user" DROP COLUMN "keycloak_sub";--> statement-breakpoint
ALTER TABLE "api_selfservice"."user" DROP COLUMN "litellm_user_id";