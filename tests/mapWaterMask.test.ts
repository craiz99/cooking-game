import { describe, expect, it } from 'vitest';
import {
  WATER_MASK_COLS,
  WATER_MASK_ROWS,
  isMapWater,
} from '../client/src/screens/mapWaterMask.js';
import { MAP_ROAM_BOUNDS } from '../client/src/screens/roadTripEvents.js';

const CITY_PINS: Array<{ id: string; nx: number; ny: number }> = [
  { id: 'sharon', nx: 0.858, ny: 0.305 },
  { id: 'nyc', nx: 0.832, ny: 0.365 },
  { id: 'chicago', nx: 0.638, ny: 0.375 },
  { id: 'austin', nx: 0.495, ny: 0.768 },
  { id: 'denver', nx: 0.362, ny: 0.470 },
  { id: 'yosemite', nx: 0.165, ny: 0.502 },
  { id: 'tahoe', nx: 0.160, ny: 0.405 },
  { id: 'mountainview', nx: 0.121, ny: 0.486 },
];

describe('US Map Water Mask & Inflatable Raft Detection (PR #19)', () => {
  it('uses an 80x45 grid and identifies Pacific, Atlantic, Gulf of Mexico, and Great Lakes as water', () => {
    expect(WATER_MASK_COLS).toBe(80);
    expect(WATER_MASK_ROWS).toBe(45);

    // Pacific Ocean (west of California & Oregon)
    expect(isMapWater(0.05, 0.50)).toBe(true);
    expect(isMapWater(0.06, 0.72)).toBe(true);

    // Atlantic Ocean (east of Carolinas & Florida)
    expect(isMapWater(0.93, 0.55)).toBe(true);
    expect(isMapWater(0.90, 0.78)).toBe(true);

    // Gulf of Mexico (south of Louisiana/Texas)
    expect(isMapWater(0.60, 0.88)).toBe(true);
    expect(isMapWater(0.68, 0.86)).toBe(true);

    // Great Lakes (Lake Superior)
    expect(isMapWater(0.62, 0.19)).toBe(true);
  });

  it('keeps all 8 road-trip city pins and continental US interior strictly dry land', () => {
    for (const pin of CITY_PINS) {
      expect(isMapWater(pin.nx, pin.ny), `Pin ${pin.id} should be on land`).toBe(false);
    }

    // Inland US states (Kansas, Montana, Tennessee)
    expect(isMapWater(0.48, 0.52)).toBe(false);
    expect(isMapWater(0.28, 0.22)).toBe(false);
    expect(isMapWater(0.68, 0.60)).toBe(false);
  });

  it('handles out-of-bounds coordinates safely and allows roaming onto oceans', () => {
    expect(isMapWater(-0.1, 0.5)).toBe(false);
    expect(isMapWater(1.2, 0.5)).toBe(false);
    expect(isMapWater(0.5, -0.2)).toBe(false);
    expect(isMapWater(0.5, 1.5)).toBe(false);

    // Expanded MAP_ROAM_BOUNDS reach the Pacific, Atlantic, and Gulf water!
    expect(MAP_ROAM_BOUNDS.minX).toBeLessThanOrEqual(0.05);
    expect(MAP_ROAM_BOUNDS.maxX).toBeGreaterThanOrEqual(0.93);
    expect(MAP_ROAM_BOUNDS.maxY).toBeGreaterThanOrEqual(0.88);
  });
});
