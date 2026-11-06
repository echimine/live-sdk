CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"live_id" text NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"currency" text NOT NULL,
	"image_url" text,
	"pinned_at" timestamp (3) with time zone NOT NULL,
	"unpinned_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"live_id" text NOT NULL,
	"product_id" text NOT NULL,
	"buyer_id" text NOT NULL,
	"buyer_app" text NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_picture" text,
	"buyer_role" text NOT NULL,
	"purchased_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "purchases_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "text" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_live_id_lives_id_fk" FOREIGN KEY ("live_id") REFERENCES "public"."lives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_live_id_lives_id_fk" FOREIGN KEY ("live_id") REFERENCES "public"."lives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_one_pinned_per_live" ON "products" USING btree ("live_id") WHERE "products"."unpinned_at" is null;--> statement-breakpoint
CREATE INDEX "purchases_live" ON "purchases" USING btree ("live_id");--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;