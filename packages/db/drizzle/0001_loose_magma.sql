ALTER TABLE "litelite"."cost_centers" ADD COLUMN "litellm_team_id" text;--> statement-breakpoint
ALTER TABLE "litelite"."user" DROP COLUMN "keycloak_sub";--> statement-breakpoint
ALTER TABLE "litelite"."user" DROP COLUMN "litellm_user_id";