CREATE TABLE "class_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_nbr" text NOT NULL,
	"term" text NOT NULL,
	"subject" text NOT NULL,
	"catalog_nbr" text NOT NULL,
	"title" text,
	"instructor_name" text,
	"seats_available" integer DEFAULT 0 NOT NULL,
	"seats_capacity" integer DEFAULT 0 NOT NULL,
	"non_reserved_seats" integer,
	"location" text,
	"meeting_times" text,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consecutive_not_found_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "class_states_class_nbr_term_key" UNIQUE("class_nbr","term")
);
--> statement-breakpoint
CREATE TABLE "class_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"class_nbr" text NOT NULL,
	"term" text NOT NULL,
	"subject" text NOT NULL,
	"catalog_nbr" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_watches_user_id_class_nbr_term_key" UNIQUE("user_id","class_nbr","term")
);
--> statement-breakpoint
CREATE TABLE "failed_login_attempts" (
	"email" text PRIMARY KEY NOT NULL,
	"attempts" integer,
	"last_attempt_at" timestamp with time zone,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_watch_id" uuid NOT NULL,
	"notification_type" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT NOW() + INTERVAL '24 hours' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notifications_sent_notification_type_check" CHECK ("notifications_sent"."notification_type" IN ('seat_available', 'instructor_assigned'))
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"email_bounced" boolean DEFAULT false NOT NULL,
	"email_bounced_at" timestamp with time zone,
	"spam_complained" boolean DEFAULT false NOT NULL,
	"spam_complained_at" timestamp with time zone,
	"age_verified_at" timestamp with time zone,
	"agreed_to_terms_at" timestamp with time zone,
	"onboarding_completed_at" timestamp with time zone,
	"onboarding_skipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_user_id_key" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"clerk_user_id" text,
	"email" text NOT NULL,
	"email_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "class_watches" ADD CONSTRAINT "class_watches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_sent" ADD CONSTRAINT "notifications_sent_class_watch_id_fkey" FOREIGN KEY ("class_watch_id") REFERENCES "public"."class_watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_class_states_subject" ON "class_states" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "idx_class_watches_class_nbr" ON "class_watches" USING btree ("class_nbr");--> statement-breakpoint
CREATE INDEX "idx_class_watches_created_at" ON "class_watches" USING btree ("created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "unique_notification_active" ON "notifications_sent" USING btree ("class_watch_id","notification_type") WHERE "notifications_sent"."is_active" = TRUE;--> statement-breakpoint
CREATE INDEX "idx_notifications_sent_class_watch_id" ON "notifications_sent" USING btree ("class_watch_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_sent_sent_at" ON "notifications_sent" USING btree ("sent_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_clerk_user_id" ON "users" USING btree ("clerk_user_id");