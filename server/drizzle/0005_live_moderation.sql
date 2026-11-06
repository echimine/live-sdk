CREATE TABLE "live_moderation" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"live_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"participant_app" text NOT NULL,
	"participant_name" text NOT NULL,
	"participant_picture" text,
	"status" text NOT NULL,
	"decided_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "live_moderation" ADD CONSTRAINT "live_moderation_live_id_lives_id_fk" FOREIGN KEY ("live_id") REFERENCES "public"."lives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "live_moderation_one_per_participant" ON "live_moderation" USING btree ("live_id","participant_id");