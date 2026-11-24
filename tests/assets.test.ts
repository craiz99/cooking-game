import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANIMALS, INGREDIENTS } from '../shared/animals.js';
import { STOPS } from '../shared/stops.js';

const PUBLIC_DIR = path.resolve(process.cwd(), 'client/public');

function expectAssetExists(webPath: string): void {
  const fullPath = path.join(PUBLIC_DIR, webPath.replace(/^\//, ''));
  expect(fs.existsSync(fullPath), `Missing asset: ${webPath}`).toBe(true);
  const stat = fs.statSync(fullPath);
  expect(stat.size, `Empty asset: ${webPath}`).toBeGreaterThan(500);
}

describe('Illustrated Asset Pack Integrity (PR #5)', () => {
  it('bundles all core scenes, purple van, stations, and PWA icons', () => {
    const core = [
      '/assets/scenes/sharon_lobby_bg.webp',
      '/assets/scenes/us_map_bg.webp',
      '/assets/chefs/purple_van.png',
      '/assets/chefs/purple_van_raft.png',
      '/assets/stations/station_prep_board.png',
      '/assets/stations/station_stove_pot.png',
      '/assets/stations/station_grill_fryer.png',
      '/assets/stations/station_counter.png',
      '/assets/stations/station_crate.png',
      '/assets/stations/station_trash.png',
      '/assets/icons/icon-512.png',
      '/assets/icons/icon-192.png',
      '/assets/icons/apple-touch-icon.png',
    ];
    for (const asset of core) {
      expectAssetExists(asset);
    }
  });

  it('bundles transparent sprites and emote overlays for all 6 animal chefs', () => {
    for (const animal of ANIMALS) {
      expectAssetExists(animal.spritePath);
      expectAssetExists(animal.emoteSpritePath);
    }
  });

  it('bundles painted sprites for all 14 mild ingredients', () => {
    for (const ing of INGREDIENTS) {
      expectAssetExists(ing.spritePath);
    }
  });

  it('bundles painted 2.5D backdrops and dish sprites for all 8 US stops', () => {
    for (const stop of STOPS) {
      expectAssetExists(stop.sceneBgPath);
      for (const recipe of stop.recipes) {
        expectAssetExists(recipe.spritePath);
      }
    }
  });
});
