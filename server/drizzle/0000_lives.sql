CREATE TABLE "lives" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"host_id" text NOT NULL,
	"host_app" text NOT NULL,
	"host_name" text NOT NULL,
	"host_picture" text,
	"started_at" timestamp (3) with time zone NOT NULL,
	"ended_at" timestamp (3) with time zone,
	"end_reason" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lives_one_running_per_host" ON "lives" USING btree ("host_id") WHERE "lives"."ended_at" is null;