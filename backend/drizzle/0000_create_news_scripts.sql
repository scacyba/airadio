CREATE TABLE IF NOT EXISTS "news_scripts" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "summary" text NOT NULL,
  "type" text NOT NULL,
  "script_text" text NOT NULL,
  "date" timestamp with time zone,
  "year" integer NOT NULL,
  "month" integer,
  "category" text,
  "source" text,
  "source_url" text,
  "is_published" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_scripts_year_idx" ON "news_scripts" ("year");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_scripts_year_month_idx" ON "news_scripts" ("year", "month");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_scripts_category_idx" ON "news_scripts" ("category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_scripts_year_category_idx" ON "news_scripts" ("year", "category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_scripts_year_month_category_idx" ON "news_scripts" ("year", "month", "category");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_news_scripts_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS news_scripts_updated_at_trigger ON "news_scripts";
--> statement-breakpoint
CREATE TRIGGER news_scripts_updated_at_trigger
BEFORE UPDATE ON "news_scripts"
FOR EACH ROW
EXECUTE FUNCTION set_news_scripts_updated_at();
