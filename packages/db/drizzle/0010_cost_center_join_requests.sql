CREATE TABLE "api_selfservice"."cost_center_join_requests" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"cost_center_id" text NOT NULL,
	"user_id" text NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_selfservice"."cost_center_join_requests" ADD CONSTRAINT "cost_center_join_requests_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "api_selfservice"."cost_centers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_selfservice"."cost_center_join_requests" ADD CONSTRAINT "cost_center_join_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "api_selfservice"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ccjr_cost_center_status_idx" ON "api_selfservice"."cost_center_join_requests" USING btree ("cost_center_id","status");--> statement-breakpoint
CREATE INDEX "ccjr_user_idx" ON "api_selfservice"."cost_center_join_requests" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ccjr_pending_idx" ON "api_selfservice"."cost_center_join_requests" USING btree ("cost_center_id","user_id") WHERE "api_selfservice"."cost_center_join_requests"."status" = 'pending';