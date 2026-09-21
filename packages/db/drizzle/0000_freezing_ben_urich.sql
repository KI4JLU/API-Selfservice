CREATE SCHEMA "litelite";
--> statement-breakpoint
CREATE TABLE "litelite"."account" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "litelite"."api_keys" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"litellm_key_id" text NOT NULL,
	"key_hash" text,
	"masked_key" text NOT NULL,
	"name" text NOT NULL,
	"cost_center_id" text NOT NULL,
	"models" text[] DEFAULT '{}'::text[] NOT NULL,
	"budget" numeric(14, 6),
	"status" text DEFAULT 'active' NOT NULL,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_extended_at" timestamp with time zone,
	"notified_14d" boolean DEFAULT false NOT NULL,
	"notified_1d" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "litelite"."audit_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "litelite"."budgets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"amount" numeric(14, 6) NOT NULL,
	"period" text DEFAULT 'monthly' NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	"notified_80_at" timestamp with time zone,
	"notified_100_at" timestamp with time zone,
	"assigned_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "litelite"."cost_center_admins" (
	"user_id" text NOT NULL,
	"cost_center_id" text NOT NULL,
	"assigned_by" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_center_admins_user_id_cost_center_id_pk" PRIMARY KEY("user_id","cost_center_id")
);
--> statement-breakpoint
CREATE TABLE "litelite"."cost_center_requests" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"cost_center_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "litelite"."cost_centers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"owner_name" text NOT NULL,
	"owner_email" text NOT NULL,
	"max_budget" numeric(14, 6),
	"budget_period" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"blocked_at" timestamp with time zone,
	"requested_by" text,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "litelite"."job_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "litelite"."notifications" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text,
	"type" text NOT NULL,
	"recipient" text NOT NULL,
	"locale" text DEFAULT 'de' NOT NULL,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "litelite"."providers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"model_name" text NOT NULL,
	"litellm_model_id" text,
	"provider" text,
	"tier" text DEFAULT 'paid' NOT NULL,
	"display_name_de" text,
	"display_name_en" text,
	"description_de" text,
	"description_en" text,
	"available" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "litelite"."rebookings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_path" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"total_amount" numeric(14, 6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "litelite"."request_logs" (
	"request_id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"user_id" text,
	"litellm_user_id" text,
	"api_key_id" text,
	"litellm_key_id" text,
	"cost_center_id" text,
	"time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone,
	"type" text DEFAULT 'llm' NOT NULL,
	"status" text NOT NULL,
	"model" text NOT NULL,
	"provider" text,
	"cost" numeric(14, 6) DEFAULT '0' NOT NULL,
	"duration_ms" integer,
	"ttft_ms" integer,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"error" text,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "litelite"."session" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "litelite"."spend_snapshots" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"date" text NOT NULL,
	"user_id" text,
	"api_key_id" text,
	"cost_center_id" text,
	"model" text NOT NULL,
	"provider" text,
	"spend" numeric(14, 6) DEFAULT '0' NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "litelite"."user" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"role_from_idp" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'de' NOT NULL,
	"keycloak_sub" text,
	"affiliation" text[],
	"affiliation_valid" boolean DEFAULT true NOT NULL,
	"cost_center_id" text,
	"cost_center_owner_name" text,
	"cost_center_owner_email" text,
	"litellm_user_id" text,
	"deleted_at" timestamp with time zone,
	"deleted_reason" text,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "litelite"."verification" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "litelite"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "litelite"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "litelite"."api_keys" ADD CONSTRAINT "api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "litelite"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "litelite"."api_keys" ADD CONSTRAINT "api_keys_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "litelite"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "litelite"."budgets" ADD CONSTRAINT "budgets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "litelite"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "litelite"."cost_center_admins" ADD CONSTRAINT "cost_center_admins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "litelite"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "litelite"."cost_center_admins" ADD CONSTRAINT "cost_center_admins_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "litelite"."cost_centers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "litelite"."cost_center_requests" ADD CONSTRAINT "cost_center_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "litelite"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "litelite"."cost_center_requests" ADD CONSTRAINT "cost_center_requests_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "litelite"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "litelite"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "litelite"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "litelite"."account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_litellm_idx" ON "litelite"."api_keys" USING btree ("litellm_key_id");--> statement-breakpoint
CREATE INDEX "api_key_user_idx" ON "litelite"."api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_key_cc_idx" ON "litelite"."api_keys" USING btree ("cost_center_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "litelite"."audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "litelite"."audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ccr_user_idx" ON "litelite"."cost_center_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ccr_status_idx" ON "litelite"."cost_center_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_center_number_idx" ON "litelite"."cost_centers" USING btree ("number");--> statement-breakpoint
CREATE INDEX "cost_center_status_idx" ON "litelite"."cost_centers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notif_user_idx" ON "litelite"."notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notif_type_idx" ON "litelite"."notifications" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_model_name_idx" ON "litelite"."providers" USING btree ("model_name");--> statement-breakpoint
CREATE INDEX "rl_user_time_idx" ON "litelite"."request_logs" USING btree ("user_id","time");--> statement-breakpoint
CREATE INDEX "rl_cc_time_idx" ON "litelite"."request_logs" USING btree ("cost_center_id","time");--> statement-breakpoint
CREATE INDEX "rl_key_idx" ON "litelite"."request_logs" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "rl_time_idx" ON "litelite"."request_logs" USING btree ("time");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_idx" ON "litelite"."session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "litelite"."session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snap_unique_idx" ON "litelite"."spend_snapshots" USING btree ("date","user_id","api_key_id","cost_center_id","model");--> statement-breakpoint
CREATE INDEX "snap_cc_date_idx" ON "litelite"."spend_snapshots" USING btree ("cost_center_id","date");--> statement-breakpoint
CREATE INDEX "snap_user_date_idx" ON "litelite"."spend_snapshots" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_idx" ON "litelite"."user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "user_cost_center_idx" ON "litelite"."user" USING btree ("cost_center_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "litelite"."verification" USING btree ("identifier");