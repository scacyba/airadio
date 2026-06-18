import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { ALLOWED_TRACK_ERAS } from '../src/server.js';
import { chooseTrackCandidate, toPlaybackTrack } from '../src/tracks.js';

test('track seed contains 50 tracks for each supported era', async () => {
  const raw = await fs.readFile(new URL('../data/tracks.seed.json', import.meta.url), 'utf8');
  const { tracks } = JSON.parse(raw);
  assert.equal(tracks.length, 200);

  const counts = Object.fromEntries(ALLOWED_TRACK_ERAS.map((era) => [era, 0]));
  const trackIds = new Set();
  const naturalKeys = new Set();
  for (const track of tracks) {
    assert.ok(ALLOWED_TRACK_ERAS.includes(track.era));
    assert.ok(track.youtubeQuery);
    counts[track.era] += 1;
    trackIds.add(track.trackId);
    naturalKeys.add(`${track.era}|${track.title}|${track.artist}`);
  }

  assert.deepEqual(counts, { '1960s': 50, '1970s': 50, '1980s': 50, '1990s': 50 });
  assert.equal(trackIds.size, tracks.length);
  assert.equal(naturalKeys.size, tracks.length);
});

test('track candidate selection avoids current and prefers unplayed tracks', () => {
  const candidates = [
    { trackId: 't90_001', videoId: 'current' },
    { trackId: 't90_002', videoId: 'played' },
    { trackId: 't90_003', videoId: 'fresh' }
  ];

  const selected = chooseTrackCandidate(candidates, {
    excludeTrackIds: ['t90_001'],
    playedTrackIds: ['t90_002']
  });

  assert.equal(selected.trackId, 't90_003');
});

test('playback track response preserves Android-compatible fields', () => {
  assert.deepEqual(toPlaybackTrack({
    trackId: 't80_010',
    videoId: 'abc123',
    title: 'Sample',
    artist: 'Artist',
    durationSec: 240,
    era: '1980s',
    youtubeQuery: 'unused'
  }), {
    trackId: 't80_010',
    videoId: 'abc123',
    title: 'Sample',
    artist: 'Artist',
    durationSec: 240,
    era: '1980s'
  });
});
