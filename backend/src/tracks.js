import { and, eq, sql } from 'drizzle-orm';

export const ALLOWED_TRACK_ERAS = ['1960s', '1970s', '1980s', '1990s'];
const MAX_YOUTUBE_RESOLUTION_ATTEMPTS = 8;

export function isAllowedTrackEra(era) {
  return ALLOWED_TRACK_ERAS.includes(era);
}

export function toPlaybackTrack(row) {
  return {
    trackId: row.trackId,
    videoId: row.videoId,
    title: row.title,
    artist: row.artist,
    durationSec: row.durationSec,
    era: row.era
  };
}

export function pickRandom(items) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function withoutIds(items, ids) {
  const excluded = new Set((ids || []).filter(Boolean));
  return items.filter((item) => !excluded.has(item.trackId));
}

function dedupeIds(ids) {
  return [...new Set((ids || []).filter(Boolean))];
}

export async function listPlayableTrackCandidates(db, tracks, era) {
  return db
    .select()
    .from(tracks)
    .where(and(eq(tracks.era, era), eq(tracks.isPlayable, true)))
    .orderBy(sql`random()`);
}

export function chooseTrackCandidate(candidates, { excludeTrackIds = [], playedTrackIds = [], preferVideoId = true } = {}) {
  const currentExcluded = dedupeIds(excludeTrackIds);
  const strictPool = withoutIds(candidates, [...currentExcluded, ...playedTrackIds]);
  const fallbackPool = withoutIds(candidates, currentExcluded);
  const pools = [strictPool, fallbackPool, candidates];

  for (const pool of pools) {
    const videoPool = preferVideoId ? pool.filter((track) => track.videoId) : [];
    const selected = pickRandom(videoPool.length ? videoPool : pool);
    if (selected) return selected;
  }

  return null;
}

export async function resolveYouTubeVideoId(track, { apiKey = process.env.YOUTUBE_API_KEY } = {}) {
  if (track.videoId) return track.videoId;
  if (!apiKey) return null;

  const query = track.youtubeQuery || `${track.artist} ${track.title} official`;
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '1');
  url.searchParams.set('q', query);
  url.searchParams.set('key', apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    const err = new Error('youtube video resolution failed');
    err.status = response.status === 403 ? 503 : 502;
    err.code = 'YOUTUBE_RESOLUTION_FAILED';
    err.details = { trackId: track.trackId, status: response.status };
    throw err;
  }

  const payload = await response.json();
  return payload?.items?.[0]?.id?.videoId || null;
}

export async function persistResolvedVideoId(db, tracks, track, videoId) {
  if (!videoId || track.videoId === videoId) return;
  await db
    .update(tracks)
    .set({ videoId, updatedAt: new Date() })
    .where(eq(tracks.trackId, track.trackId));
  track.videoId = videoId;
}

export async function selectRandomPlayableTrack(db, tracks, {
  era,
  excludeTrackIds = [],
  playedTrackIds = [],
  resolveMissingVideoId = true
} = {}) {
  const candidates = await listPlayableTrackCandidates(db, tracks, era);
  if (!candidates.length) return null;

  let attempts = 0;
  const rejectedTrackIds = [];
  while (attempts < MAX_YOUTUBE_RESOLUTION_ATTEMPTS) {
    const selected = chooseTrackCandidate(candidates, {
      excludeTrackIds: [...excludeTrackIds, ...rejectedTrackIds],
      playedTrackIds,
      preferVideoId: true
    });
    if (!selected) break;

    if (selected.videoId) return selected;
    if (!resolveMissingVideoId) {
      rejectedTrackIds.push(selected.trackId);
      attempts += 1;
      continue;
    }

    const resolvedVideoId = await resolveYouTubeVideoId(selected);
    if (resolvedVideoId) {
      await persistResolvedVideoId(db, tracks, selected, resolvedVideoId);
      return selected;
    }

    rejectedTrackIds.push(selected.trackId);
    attempts += 1;
  }

  return null;
}
