CREATE TABLE "api_selfservice"."cost_center_members" (
	"cost_center_id" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text,
	"role" text DEFAULT 'user' NOT NULL,
	"added_by" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_center_members_cost_center_id_user_id_pk" PRIMARY KEY("cost_center_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "api_selfservice"."cost_center_members" ADD CONSTRAINT "cost_center_members_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "api_selfservice"."cost_centers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ccm_user_idx" ON "api_selfservice"."cost_center_members" USING btree ("user_id");--> statement-breakpoint
-- F-KST-10: existing cost center admins become admin members.
INSERT INTO "api_selfservice"."cost_center_members" ("cost_center_id", "user_id", "email", "role", "added_by", "added_at")
SELECT a."cost_center_id", a."user_id", u."email", 'admin', a."assigned_by", a."assigned_at"
FROM "api_selfservice"."cost_center_admins" a
JOIN "api_selfservice"."user" u ON u."id" = a."user_id";--> statement-breakpoint
-- Users whose profile cost center is a non-default one become members of it.
INSERT INTO "api_selfservice"."cost_center_members" ("cost_center_id", "user_id", "email", "role")
SELECT u."cost_center_id", u."id", u."email", 'user'
FROM "api_selfservice"."user" u
JOIN "api_selfservice"."cost_centers" c ON c."id" = u."cost_center_id"
WHERE c."is_default" = false
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Owners of keys on a non-default cost center keep access to it.
INSERT INTO "api_selfservice"."cost_center_members" ("cost_center_id", "user_id", "email", "role")
SELECT DISTINCT k."cost_center_id", k."user_id", u."email", 'user'
FROM "api_selfservice"."api_keys" k
JOIN "api_selfservice"."user" u ON u."id" = k."user_id"
JOIN "api_selfservice"."cost_centers" c ON c."id" = k."cost_center_id"
WHERE c."is_default" = false AND k."status" <> 'deleted'
ON CONFLICT DO NOTHING;
