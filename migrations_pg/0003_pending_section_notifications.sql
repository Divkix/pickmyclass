CREATE TABLE "pending_section_notifications" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"class_nbr" text NOT NULL,
	"term" text NOT NULL,
	"class_info" jsonb NOT NULL,
	"changes" jsonb NOT NULL,
	"lease_id" uuid,
	"leased_until" timestamp with time zone,
	CONSTRAINT "pending_section_notifications_class_nbr_term_pk" PRIMARY KEY("class_nbr","term")
);
--> statement-breakpoint
ALTER TABLE "pending_section_notifications" ADD CONSTRAINT "pending_section_notifications_class_nbr_term_class_states_class_nbr_term_fk" FOREIGN KEY ("class_nbr","term") REFERENCES "public"."class_states"("class_nbr","term") ON DELETE cascade ON UPDATE no action;