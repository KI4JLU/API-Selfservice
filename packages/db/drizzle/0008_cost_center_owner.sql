ALTER TABLE "api_selfservice"."cost_centers" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
-- F-KST-14: link owners to portal users (same id as in LiteLLM) by e-mail; unmatched owners stay unlinked until an admin picks one.
UPDATE "api_selfservice"."cost_centers" c
SET "owner_user_id" = u."id"
FROM "api_selfservice"."user" u
WHERE c."is_default" = false AND c."owner_user_id" IS NULL AND u."deleted_at" IS NULL AND lower(u."email") = lower(c."owner_email");--> statement-breakpoint
-- Linked owners are cost center admins of their cost center (pending ones get their row on approval).
INSERT INTO "api_selfservice"."cost_center_members" ("cost_center_id", "user_id", "email", "role")
SELECT c."id", c."owner_user_id", c."owner_email", 'admin'
FROM "api_selfservice"."cost_centers" c
WHERE c."owner_user_id" IS NOT NULL AND c."status" IN ('approved', 'archived')
ON CONFLICT ("cost_center_id", "user_id") DO UPDATE SET "role" = 'admin';
