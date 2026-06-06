CREATE TABLE IF NOT EXISTS "tracks" (
  "track_id" text PRIMARY KEY NOT NULL,
  "era" text NOT NULL,
  "title" text NOT NULL,
  "artist" text NOT NULL,
  "release_year" integer NOT NULL,
  "country" text NOT NULL,
  "youtube_query" text NOT NULL,
  "video_id" text,
  "duration_sec" integer,
  "is_playable" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tracks_era_check" CHECK ("era" IN ('1960s', '1970s', '1980s', '1990s'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracks_era_idx" ON "tracks" ("era");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracks_playable_era_idx" ON "tracks" ("era", "is_playable");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tracks_era_title_artist_idx" ON "tracks" ("era", "title", "artist");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_tracks_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tracks_updated_at_trigger ON "tracks";
--> statement-breakpoint
CREATE TRIGGER tracks_updated_at_trigger
BEFORE UPDATE ON "tracks"
FOR EACH ROW
EXECUTE FUNCTION set_tracks_updated_at();
