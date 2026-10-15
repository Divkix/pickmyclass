ALTER TABLE "notifications_sent" ADD COLUMN "delivery_intent_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications_sent" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pending_section_notifications" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '30 minutes' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_notifications_delivery_intent" ON "notifications_sent" USING btree ("delivery_intent_id") WHERE "notifications_sent"."delivery_intent_id" IS NOT NULL;