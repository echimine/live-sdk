CREATE TABLE "chat_messages" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"live_id" text NOT NULL,
	"author_id" text NOT NULL,
	"author_app" text NOT NULL,
	"author_name" text NOT NULL,
	"author_picture" text,
	"author_role" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"sent_at" timestamp (3) with time zone NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "chat_messages_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_live_id_lives_id_fk" FOREIGN KEY ("live_id") REFERENCES "public"."lives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_live_seq" ON "chat_messages" USING btree ("live_id","seq");