import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAP_ROAM_BOUNDS,
  SILLY_ROAD_TRIP_EVENTS,
  canPlayStop,
  clampMapPos,
  pickSillyRoadTripEvent,
} from '../client/src/screens/roadTripEvents.js';

describe('Free-Roam US Map Driving & Silly Road-Trip Events (PR #14)', () => {
  it('clamps free-roam van coordinates safely inside the visible US map bounds', () => {
    expect(clampMapPos(-0.5, -0.2)).toEqual({
      nx: MAP_ROAM_BOUNDS.minX,
      ny: MAP_ROAM_BOUNDS.minY,
    });
    expect(clampMapPos(1.8, 1.4)).toEqual({
      nx: MAP_ROAM_BOUNDS.maxX,
      ny: MAP_ROAM_BOUNDS.maxY,
    });
    expect(clampMapPos(0.5, 0.5)).toEqual({ nx: 0.5, ny: 0.5 });
  });

  it('enforces sequential level unlocking even though the van can roam anywhere', () => {
    expect(canPlayStop(['sharon'], 'sharon')).toBe(true);
    expect(canPlayStop(['sharon'], 'nyc')).toBe(false);
    expect(canPlayStop(['sharon'], 'sanjose')).toBe(false);
    expect(canPlayStop(['sharon', 'nyc'], 'nyc')).toBe(true);
    expect(canPlayStop(['sharon', 'nyc'], 'chicago')).toBe(false);
  });

  it('defines 8 unique silly road-trip events backed by real illustrated sprites and avoids back-to-back repeats', () => {
    expect(SILLY_ROAD_TRIP_EVENTS).toHaveLength(8);
    const ids = new Set(SILLY_ROAD_TRIP_EVENTS.map((e) => e.id));
    expect(ids.size).toBe(8);

    const publicDir = path.resolve(process.cwd(), 'client/public');
    for (const ev of SILLY_ROAD_TRIP_EVENTS) {
      expect(ev.headline.length).toBeGreaterThan(5);
      expect(ev.colors.length).toBeGreaterThanOrEqual(3);
      const fullPath = path.join(publicDir, ev.spritePath.replace(/^\//, ''));
      expect(fs.existsSync(fullPath), `Missing sprite ${ev.spritePath}`).toBe(true);
    }

    // Never repeats the exact same event back-to-back
    let prev: string | null = null;
    for (let i = 0; i < 20; i++) {
      const picked = pickSillyRoadTripEvent(0.5, 0.5, prev, () => (i % 7) / 7);
      expect(picked.id).not.toBe(prev);
      prev = picked.id;
    }
  });
});
