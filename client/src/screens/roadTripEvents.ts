import type { AnimalId, StopId } from '@shared/types';

export interface SillyRoadTripEvent {
  id: string;
  headline: string;
  spritePath: string;
  sound: 'honk' | 'serve' | 'combine' | 'pickup' | AnimalId;
  colors: string[];
  turboBoost?: boolean;
}

export const MAP_ROAM_BOUNDS = {
  minX: 0.03,
  maxX: 0.97,
  minY: 0.08,
  maxY: 0.92,
} as const;

export const SILLY_ROAD_TRIP_EVENTS: readonly SillyRoadTripEvent[] = [
  {
    id: 'skunk_toot_boost',
    headline: 'PFFFT! Skunk Turbo-Toot Boost!',
    spritePath: '/assets/chefs/emote_fart_cloud.png',
    sound: 'skunk',
    colors: ['#84cc16', '#a855f7', '#bef264'],
    turboBoost: true,
  },
  {
    id: 'gummy_rain',
    headline: 'Whoa! Rainbow Gummy Bear Shower!',
    spritePath: '/assets/food/ing_gummy_bears.png',
    sound: 'serve',
    colors: ['#f472b6', '#ffe066', '#4ade80', '#38bdf8'],
  },
  {
    id: 'cheetos_storm',
    headline: 'Watch out! Cheesy Cheetos Whirlwind!',
    spritePath: '/assets/food/ing_cheetos.png',
    sound: 'combine',
    colors: ['#fb923c', '#f59e0b', '#fde047'],
  },
  {
    id: 'fisheye_splash',
    headline: 'SPLASH! A silly Fish-Eye waved hello!',
    spritePath: '/assets/food/ing_fish_eyes.png',
    sound: 'pickup',
    colors: ['#38bdf8', '#7dd3fc', '#ffffff'],
  },
  {
    id: 'bat_loop',
    headline: 'Squeak! Purple Bat roof loop-de-loop!',
    spritePath: '/assets/chefs/purple_bat.png',
    sound: 'purple_bat',
    colors: ['#a855f7', '#e879f9', '#ffe066'],
  },
  {
    id: 'panda_picnic',
    headline: 'CRUNCH! Panda surprise bamboo picnic!',
    spritePath: '/assets/chefs/emote_bamboo.png',
    sound: 'panda',
    colors: ['#4ade80', '#16a34a', '#bbf7d0'],
  },
  {
    id: 'seaweed_flap',
    headline: 'FLAP! Crispy seaweed stuck to the hood!',
    spritePath: '/assets/food/ing_seaweed.png',
    sound: 'fox',
    colors: ['#22c55e', '#15803d', '#ffe066'],
  },
  {
    id: 'moose_honk',
    headline: 'BEEP-BEEP! Silly Moose Traffic Jam!',
    spritePath: '/assets/chefs/emote_star_treat.png',
    sound: 'honk',
    colors: ['#ffe066', '#fb923c', '#c084fc'],
  },
] as const;

export function clampMapPos(nx: number, ny: number): { nx: number; ny: number } {
  return {
    nx: Math.max(MAP_ROAM_BOUNDS.minX, Math.min(MAP_ROAM_BOUNDS.maxX, nx)),
    ny: Math.max(MAP_ROAM_BOUNDS.minY, Math.min(MAP_ROAM_BOUNDS.maxY, ny)),
  };
}

/**
 * Sequential unlock guard: players may freely drive the Purple Van anywhere on the map,
 * but can only cook at stops they have unlocked in order (earning >=1 star on the previous stop).
 */
export function canPlayStop(unlockedStopIds: readonly StopId[], stopId: StopId): boolean {
  return unlockedStopIds.includes(stopId);
}

/**
 * Picks a fun silly road-trip surprise with gentle regional flavor while avoiding back-to-back repeats.
 */
export function pickSillyRoadTripEvent(
  nx: number,
  ny: number,
  lastEventId?: string | null,
  rng: () => number = Math.random,
): SillyRoadTripEvent {
  // Build weighted candidate pool with cozy regional flavor
  const pool: SillyRoadTripEvent[] = [...SILLY_ROAD_TRIP_EVENTS];

  // Near lakes/coasts (New England, Great Lakes, California coast/Tahoe): extra chance of splashy seaweed/fish-eye!
  if (nx > 0.78 || nx < 0.22 || (nx > 0.56 && nx < 0.7 && ny < 0.45)) {
    const splash = SILLY_ROAD_TRIP_EVENTS.find((e) => e.id === 'fisheye_splash');
    const seaweed = SILLY_ROAD_TRIP_EVENTS.find((e) => e.id === 'seaweed_flap');
    if (splash) pool.push(splash);
    if (seaweed) pool.push(seaweed);
  }
  // Central plains / Texas Hill Country: extra chance of Cheetos whirlwind!
  if (nx >= 0.38 && nx <= 0.65 && ny >= 0.48) {
    const cheetos = SILLY_ROAD_TRIP_EVENTS.find((e) => e.id === 'cheetos_storm');
    if (cheetos) pool.push(cheetos);
  }
  // Mountain West / Northern woods: extra chance of Moose traffic jam!
  if (ny < 0.46 && nx >= 0.24 && nx <= 0.48) {
    const moose = SILLY_ROAD_TRIP_EVENTS.find((e) => e.id === 'moose_honk');
    if (moose) pool.push(moose);
  }

  const filtered = lastEventId ? pool.filter((e) => e.id !== lastEventId) : pool;
  const candidates = filtered.length > 0 ? filtered : pool;
  const idx = Math.floor(Math.max(0, Math.min(0.999999, rng())) * candidates.length);
  return candidates[idx] ?? SILLY_ROAD_TRIP_EVENTS[0]!;
}
