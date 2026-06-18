import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';

import { closeDb, getDb } from '../src/db/client.js';
import { tracks } from '../src/db/schema.js';
import { ALLOWED_TRACK_ERAS, resolveYouTubeVideoId } from '../src/tracks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultSeedPath = path.resolve(__dirname, '../data/tracks.seed.json');
const seedPath = path.resolve(process.cwd(), process.argv.find((arg) => !arg.startsWith('--') && arg.endsWith('.json')) || defaultSeedPath);
const shouldResolveYouTube = process.argv.includes('--resolve-youtube');

function nullableString(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function nullableInteger(value, field, index) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`track seed item at index ${index} has invalid ${field}: ${value}`);
  }
  return parsed;
}

function normalizeTrack(item, index) {
  for (const field of ['trackId', 'era', 'title', 'artist', 'releaseYear', 'country', 'youtubeQuery']) {
    if (item[field] === undefined || item[field] === null || item[field] === '') {
      throw new Error(`track seed item at index ${index} is missing required field: ${field}`);
    }
  }

  const era = String(item.era).trim();
  if (!ALLOWED_TRACK_ERAS.includes(era)) {
    throw new Error(`track seed item at index ${index} has invalid era: ${item.era}`);
  }

  const releaseYear = Number(item.releaseYear);
  if (!Number.isInteger(releaseYear) || releaseYear < 1900) {
    throw new Error(`track seed item at index ${index} has invalid releaseYear: ${item.releaseYear}`);
  }

  return {
    trackId: String(item.trackId).trim(),
    era,
    title: String(item.title).trim(),
    artist: String(item.artist).trim(),
    releaseYear,
    country: String(item.country).trim(),
    youtubeQuery: String(item.youtubeQuery).trim(),
    videoId: nullableString(item.videoId),
    durationSec: nullableInteger(item.durationSec, 'durationSec', index),
    isPlayable: item.isPlayable ?? true
  };
}

async function resolveMissingVideoIds(items) {
  if (!shouldResolveYouTube) return items;
  if (!process.env.YOUTUBE_API_KEY) {
    throw new Error('YOUTUBE_API_KEY is required when using --resolve-youtube');
  }

  const resolved = [];
  for (const item of items) {
    if (item.videoId) {
      resolved.push(item);
      continue;
    }
    const videoId = await resolveYouTubeVideoId(item);
    resolved.push({ ...item, videoId });
  }
  return resolved;
}

async function main() {
  const raw = await fs.readFile(seedPath, 'utf8');
  const parsed = JSON.parse(raw);
  const items = Array.isArray(parsed) ? parsed : parsed.tracks;
  if (!Array.isArray(items)) {
    throw new Error('track seed file must contain an array or an object with tracks array');
  }

  const values = await resolveMissingVideoIds(items.map(normalizeTrack));
  if (!values.length) {
    console.log('No tracks to seed.');
    return;
  }

  const countsByEra = new Map(ALLOWED_TRACK_ERAS.map((era) => [era, 0]));
  for (const value of values) countsByEra.set(value.era, (countsByEra.get(value.era) || 0) + 1);

  const db = getDb();
  await db.insert(tracks)
    .values(values)
    .onConflictDoUpdate({
      target: tracks.trackId,
      set: {
        era: sql`excluded.era`,
        title: sql`excluded.title`,
        artist: sql`excluded.artist`,
        releaseYear: sql`excluded.release_year`,
        country: sql`excluded.country`,
        youtubeQuery: sql`excluded.youtube_query`,
        videoId: sql`excluded.video_id`,
        durationSec: sql`excluded.duration_sec`,
        isPlayable: sql`excluded.is_playable`,
        updatedAt: new Date()
      }
    });

  console.log(`Seeded ${values.length} tracks from ${seedPath}`);
  console.log([...countsByEra.entries()].map(([era, count]) => `${era}: ${count}`).join(', '));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
