import { describe, expect, it } from 'vitest';
import {
  DECK_QUAD_BY_STOP,
  DEFAULT_SCENE_ASPECT,
  getCoverImageRect,
  gridToDeckScreen,
  screenToDeckGrid,
} from '../client/src/screens/kitchenDeckGeometry.js';
import { KitchenSim } from '../shared/kitchenSim.js';
import { STOPS } from '../shared/stops.js';
import type { PlayerProfile } from '../shared/types.js';

const testPlayer: PlayerProfile = {
  playerId: 'p1',
  name: 'Leo',
  animalId: 'purple_bat',
  kidHelper: true,
  connected: true,
};

describe('Per-Stop 2.5D Kitchen Deck Grounding Geometry (PR #13)', () => {
  it('defines a valid perspective trapezoid deck quad for all 8 US stops', () => {
    for (const stop of STOPS) {
      const q = DECK_QUAD_BY_STOP[stop.id];
      expect(q).toBeDefined();
      expect(q.topY).toBeGreaterThanOrEqual(0.4);
      expect(q.bottomY).toBeLessThanOrEqual(0.9);
      expect(q.bottomY).toBeGreaterThan(q.topY + 0.25);
      // Perspective widens toward the viewer (front bottom edge wider than back railing edge)
      expect(q.bottomLeftX).toBeLessThan(q.topLeftX);
      expect(q.bottomRightX).toBeGreaterThan(q.topRightX);
    }
  });

  it('grounds every station strictly on the wooden deck planks on iPad landscape (1180x820) and desktop (1376x768)', () => {
    const viewports = [
      { w: 1180, h: 820 },
      { w: 1024, h: 768 },
      { w: 1376, h: 768 },
    ];

    for (const stop of STOPS) {
      const sim = new KitchenSim({
        stopId: stop.id,
        pace: 'cozy',
        players: [testPlayer],
        soloAiHelper: false,
        previewSeconds: 0,
      });
      const q = DECK_QUAD_BY_STOP[stop.id];

      for (const vp of viewports) {
        const rect = getCoverImageRect(vp.w, vp.h, DEFAULT_SCENE_ASPECT);
        for (const st of sim.stations) {
          const pt = gridToDeckScreen(stop.id, st.gridX, st.gridY, vp.w, vp.h);

          // Must be cleanly visible on screen
          expect(pt.x).toBeGreaterThanOrEqual(40);
          expect(pt.x).toBeLessThanOrEqual(vp.w - 40);
          expect(pt.y).toBeGreaterThanOrEqual(vp.h * 0.4);
          expect(pt.y).toBeLessThanOrEqual(vp.h * 0.88);

          // Convert back into normalized image coords -> MUST sit inside the calibrated wooden deck trapezoid!
          const yImg = (pt.y - rect.oy) / rect.rh;
          const xImg = (pt.x - rect.ox) / rect.rw;
          expect(yImg).toBeGreaterThanOrEqual(q.topY - 0.001);
          expect(yImg).toBeLessThanOrEqual(q.bottomY + 0.001);

          const v = (yImg - q.topY) / (q.bottomY - q.topY);
          const minX = q.topLeftX + (q.bottomLeftX - q.topLeftX) * v;
          const maxX = q.topRightX + (q.bottomRightX - q.topRightX) * v;
          expect(xImg).toBeGreaterThanOrEqual(minX - 0.01);
          expect(xImg).toBeLessThanOrEqual(maxX + 0.01);
        }
      }
    }
  });

  it('inverts gridToDeckScreen cleanly via screenToDeckGrid across all stops', () => {
    for (const stop of STOPS) {
      const samplePoints = [
        { gx: 3.1, gy: 1.15 },
        { gx: 4.9, gy: 3.35 },
        { gx: 7.5, gy: 4.6 },
      ];
      for (const sp of samplePoints) {
        const screen = gridToDeckScreen(stop.id, sp.gx, sp.gy, 1180, 820);
        const back = screenToDeckGrid(stop.id, screen.x, screen.y, 1180, 820);
        expect(back.gx).toBeCloseTo(sp.gx, 2);
        expect(back.gy).toBeCloseTo(sp.gy, 2);
      }
    }
  });
});
