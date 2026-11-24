import type { GamePace, RecipeDef, StarTargets, StopDef, StopId } from './types.js';

/**
 * 8-Stop US Road Trip Route:
 * Sharon, MA -> NYC -> Chicago -> Austin/Lake Travis -> Denver/Rockies -> Yosemite, CA -> Lake Tahoe, CA -> San Jose, CA
 *
 * Every recipe is 100% ZERO-SPICE and adapts real regional specialties using
 * pasta, seaweed, mild cheesy Cheetos, gummy bears, french fries, and silly fish eyes.
 */
export const STOPS: readonly StopDef[] = [
  {
    index: 1,
    id: 'sharon',
    name: 'Sharon, MA — Memorial Park Beach',
    shortName: 'Sharon, MA',
    stateCode: 'MA',
    subtitle: 'Sharon Seaweed Stand by Lake Massapoag',
    vibe: 'Crisp New England autumn maples along Lake Massapoag! Gentle warm-up shift at our purple van Seaweed Stand.',
    lat: 42.115,
    lon: -71.182,
    sceneBgPath: '/assets/scenes/kitchen_sharon.webp',
    accentColor: '#d97706',
    crates: ['seaweed', 'pasta', 'soup', 'fish_eyes', 'french_fries'],
    shiftSecondsCozy: 75,
    shiftSecondsRush: 60,
    baseTargetsSolo: [2, 4, 6],
    baseTargetsDuo: [3, 5, 7],
    baseTargetsTrio: [4, 6, 9],
    recipes: [
      {
        id: 'sharon_seaweed_pack',
        name: 'Sharon Crispy Seaweed Pack',
        shortName: 'Seaweed Pack',
        baseIngredient: 'seaweed',
        cookStation: 'grill_fryer',
        cookSeconds: 1.8,
        spritePath: '/assets/food/dish_seaweed_pack.png',
        featuredTags: ['Seaweed'],
      },
      {
        id: 'sharon_fisheye_chowder',
        name: 'New England Fish-Eye Chowder',
        shortName: 'Fish-Eye Chowder',
        baseIngredient: 'soup',
        cookStation: 'stove_pot',
        cookSeconds: 2.2,
        toppingIngredient: 'fish_eyes',
        spritePath: '/assets/food/dish_fisheye_chowder.png',
        featuredTags: ['Fish Eyes'],
      },
      {
        id: 'sharon_butter_pasta',
        name: 'North End Buttered Pasta & Fries',
        shortName: 'Buttered Pasta',
        baseIngredient: 'pasta',
        cookStation: 'stove_pot',
        cookSeconds: 2.2,
        toppingIngredient: 'french_fries',
        spritePath: '/assets/food/dish_butter_pasta.png',
        featuredTags: ['Pasta', 'French Fries'],
      },
    ],
  },
  {
    index: 2,
    id: 'nyc',
    name: 'New York City, NY',
    shortName: 'NYC, NY',
    stateCode: 'NY',
    subtitle: 'Big Apple Park Cart & Coney Island Stand',
    vibe: 'Sunny skyline park cart serving cheesy mild boardwalk fries, Cheetos melts, and gummy bear pretzels!',
    lat: 40.713,
    lon: -74.006,
    sceneBgPath: '/assets/scenes/kitchen_nyc.webp',
    accentColor: '#2563eb',
    crates: ['french_fries', 'cheetos', 'bread', 'cheese', 'gummy_bears'],
    shiftSecondsCozy: 75,
    shiftSecondsRush: 60,
    baseTargetsSolo: [2, 4, 6],
    baseTargetsDuo: [3, 5, 7],
    baseTargetsTrio: [4, 6, 9],
    recipes: [
      {
        id: 'nyc_cheetos_fries',
        name: 'Coney Island Cheetos Cheese Fries',
        shortName: 'Cheetos Fries',
        baseIngredient: 'french_fries',
        cookStation: 'grill_fryer',
        cookSeconds: 2.0,
        toppingIngredient: 'cheetos',
        spritePath: '/assets/food/dish_cheetos_fries.png',
        featuredTags: ['French Fries', 'Cheetos'],
      },
      {
        id: 'nyc_cheetos_melt',
        name: 'NYC Cheetos-Crusted Grilled Cheese',
        shortName: 'Cheetos Melt',
        baseIngredient: 'bread',
        cookStation: 'grill_fryer',
        cookSeconds: 2.0,
        toppingIngredient: 'cheese',
        spritePath: '/assets/food/dish_cheetos_melt.png',
        featuredTags: ['Cheetos'],
      },
      {
        id: 'nyc_gummy_pretzel',
        name: 'Big Apple Gummy Bear Pretzel',
        shortName: 'Gummy Pretzel',
        baseIngredient: 'bread',
        cookStation: 'prep_board',
        cookSeconds: 1.6,
        toppingIngredient: 'gummy_bears',
        spritePath: '/assets/food/dish_gummy_pretzel.png',
        featuredTags: ['Gummy Bears'],
      },
    ],
  },
  {
    index: 3,
    id: 'chicago',
    name: 'Chicago, IL',
    shortName: 'Chicago, IL',
    stateCode: 'IL',
    subtitle: 'Windy City Lakefront Diner',
    vibe: 'Breezy Lake Michigan retro chrome diner with deep-dish pasta pie, seaweed garden fries, and sweet gummy mix!',
    lat: 41.878,
    lon: -87.630,
    sceneBgPath: '/assets/scenes/kitchen_chicago.webp',
    accentColor: '#e11d48',
    crates: ['pasta', 'cheetos', 'french_fries', 'seaweed', 'gummy_bears'],
    shiftSecondsCozy: 80,
    shiftSecondsRush: 65,
    baseTargetsSolo: [2, 4, 6],
    baseTargetsDuo: [3, 6, 8],
    baseTargetsTrio: [4, 7, 10],
    recipes: [
      {
        id: 'chi_pasta_pie',
        name: 'Chicago Deep-Dish Cheetos Pasta Pie',
        shortName: 'Pasta Pie',
        baseIngredient: 'pasta',
        cookStation: 'stove_pot',
        cookSeconds: 2.3,
        toppingIngredient: 'cheetos',
        spritePath: '/assets/food/dish_pasta_pie.png',
        featuredTags: ['Pasta', 'Cheetos'],
      },
      {
        id: 'chi_seaweed_fries',
        name: 'Chicago Seaweed Garden Fries',
        shortName: 'Seaweed Fries',
        baseIngredient: 'french_fries',
        cookStation: 'grill_fryer',
        cookSeconds: 2.0,
        toppingIngredient: 'seaweed',
        spritePath: '/assets/food/dish_seaweed_fries.png',
        featuredTags: ['French Fries', 'Seaweed'],
      },
      {
        id: 'chi_gummy_mix',
        name: 'Windy City Cheetos & Gummy Mix',
        shortName: 'Sweet Gummy Mix',
        baseIngredient: 'cheetos',
        cookStation: 'prep_board',
        cookSeconds: 1.6,
        toppingIngredient: 'gummy_bears',
        spritePath: '/assets/food/dish_gummy_mix.png',
        featuredTags: ['Cheetos', 'Gummy Bears'],
      },
    ],
  },
  {
    index: 4,
    id: 'austin',
    name: 'Austin / Lake Travis, TX — The Oasis',
    shortName: 'Austin, TX',
    stateCode: 'TX',
    subtitle: 'Cliffside Sunset Decks Overlooking Lake Travis',
    vibe: 'Golden Texas Hill Country sunset on the terraced limestone decks of The Oasis! Mild cheesy queso fries & fish-eye seaweed tacos.',
    lat: 30.405,
    lon: -97.874,
    sceneBgPath: '/assets/scenes/kitchen_austin.webp',
    accentColor: '#ea580c',
    crates: ['french_fries', 'cheetos', 'fish', 'fish_eyes', 'sweet_corn'],
    shiftSecondsCozy: 80,
    shiftSecondsRush: 65,
    baseTargetsSolo: [2, 4, 6],
    baseTargetsDuo: [3, 6, 8],
    baseTargetsTrio: [4, 7, 10],
    recipes: [
      {
        id: 'aus_queso_fries',
        name: 'Lake Travis Sunset Cheetos Fries',
        shortName: 'Oasis Cheetos Fries',
        baseIngredient: 'french_fries',
        cookStation: 'grill_fryer',
        cookSeconds: 2.0,
        toppingIngredient: 'cheetos',
        spritePath: '/assets/food/dish_cheetos_fries.png',
        featuredTags: ['French Fries', 'Cheetos'],
      },
      {
        id: 'aus_fisheye_taco',
        name: 'Lake Travis Fish-Eye Crispy Taco',
        shortName: 'Fish-Eye Taco',
        baseIngredient: 'fish',
        cookStation: 'prep_board',
        cookSeconds: 1.8,
        toppingIngredient: 'fish_eyes',
        spritePath: '/assets/food/dish_fisheye_taco.png',
        featuredTags: ['Fish Eyes'],
      },
      {
        id: 'aus_sweet_corn',
        name: 'Austin Mild Cheetos Sweet Corn',
        shortName: 'Cheetos Corn',
        baseIngredient: 'sweet_corn',
        cookStation: 'stove_pot',
        cookSeconds: 2.1,
        toppingIngredient: 'cheetos',
        spritePath: '/assets/food/dish_cheetos_corn.png',
        featuredTags: ['Cheetos'],
      },
    ],
  },
  {
    index: 5,
    id: 'denver',
    name: 'Denver / Rocky Mountains, CO',
    shortName: 'Denver, CO',
    stateCode: 'CO',
    subtitle: 'Mile High Pine Forest Lodge',
    vibe: 'Crisp mountain air in the Colorado Rockies! Cozy gummy bear s’mores, cheesy fry skillets, and mild seaweed pasta.',
    lat: 39.739,
    lon: -104.990,
    sceneBgPath: '/assets/scenes/kitchen_denver.webp',
    accentColor: '#059669',
    crates: ['chocolate', 'gummy_bears', 'french_fries', 'cheese', 'pasta'],
    shiftSecondsCozy: 85,
    shiftSecondsRush: 70,
    baseTargetsSolo: [3, 5, 7],
    baseTargetsDuo: [4, 6, 9],
    baseTargetsTrio: [5, 8, 11],
    recipes: [
      {
        id: 'den_gummy_smores',
        name: 'Rocky Mountain Gummy Bear S’mores',
        shortName: 'Gummy S’mores',
        baseIngredient: 'chocolate',
        cookStation: 'grill_fryer',
        cookSeconds: 1.9,
        toppingIngredient: 'gummy_bears',
        spritePath: '/assets/food/dish_gummy_smores.png',
        featuredTags: ['Gummy Bears'],
      },
      {
        id: 'den_fry_skillet',
        name: 'Denver Cheesy Mountain Fry Skillet',
        shortName: 'Cheesy Fry Skillet',
        baseIngredient: 'french_fries',
        cookStation: 'grill_fryer',
        cookSeconds: 2.1,
        toppingIngredient: 'cheese',
        spritePath: '/assets/food/dish_cheetos_fries.png',
        featuredTags: ['French Fries'],
      },
      {
        id: 'den_alpine_pasta',
        name: 'Mile High Creamy Cheese Pasta',
        shortName: 'Alpine Pasta',
        baseIngredient: 'pasta',
        cookStation: 'stove_pot',
        cookSeconds: 2.2,
        toppingIngredient: 'cheese',
        spritePath: '/assets/food/dish_butter_pasta.png',
        featuredTags: ['Pasta'],
      },
    ],
  },
  {
    index: 6,
    id: 'yosemite',
    name: 'Yosemite National Park, CA',
    shortName: 'Yosemite, CA',
    stateCode: 'CA',
    subtitle: 'Half Dome & Giant Sequoia Meadow',
    vibe: 'Towering granite Half Dome, shimmering waterfalls, and cedar picnic tables in California! Foil-packet Cheetos fries & gummy bear trail cups.',
    lat: 37.749,
    lon: -119.588,
    sceneBgPath: '/assets/scenes/kitchen_yosemite.webp',
    accentColor: '#15803d',
    crates: ['french_fries', 'cheetos', 'ice_cream', 'gummy_bears', 'soup'],
    shiftSecondsCozy: 85,
    shiftSecondsRush: 70,
    baseTargetsSolo: [3, 5, 7],
    baseTargetsDuo: [4, 6, 9],
    baseTargetsTrio: [5, 8, 11],
    recipes: [
      {
        id: 'yos_foil_nachos',
        name: 'Half Dome Foil Cheetos & Fry Nachos',
        shortName: 'Campfire Nachos',
        baseIngredient: 'french_fries',
        cookStation: 'grill_fryer',
        cookSeconds: 2.1,
        toppingIngredient: 'cheetos',
        spritePath: '/assets/food/dish_campfire_nachos.png',
        featuredTags: ['French Fries', 'Cheetos'],
      },
      {
        id: 'yos_gummy_trail',
        name: 'Yosemite Gummy Bear Trail Cup',
        shortName: 'Gummy Trail Cup',
        baseIngredient: 'ice_cream',
        cookStation: 'prep_board',
        cookSeconds: 1.6,
        toppingIngredient: 'gummy_bears',
        spritePath: '/assets/food/dish_gummy_parfait.png',
        featuredTags: ['Gummy Bears'],
      },
      {
        id: 'yos_sequoia_soup',
        name: 'Sequoia Creamy Tomato Soup & Cheetos',
        shortName: 'Sequoia Soup',
        baseIngredient: 'soup',
        cookStation: 'stove_pot',
        cookSeconds: 2.2,
        toppingIngredient: 'cheetos',
        spritePath: '/assets/food/dish_sequoia_soup.png',
        featuredTags: ['Cheetos'],
      },
    ],
  },
  {
    index: 7,
    id: 'tahoe',
    name: 'Lake Tahoe, CA',
    shortName: 'Lake Tahoe, CA',
    stateCode: 'CA',
    subtitle: 'Turquoise Alpine Pier & Snowy Peaks',
    vibe: 'Sparkling blue alpine waters in California’s Sierra Nevada! Mild rainbow trout with seaweed & fish eyes, buttery pasta, and snowcap gummy parfaits.',
    lat: 39.097,
    lon: -120.032,
    sceneBgPath: '/assets/scenes/kitchen_tahoe.webp',
    accentColor: '#0284c7',
    crates: ['fish', 'seaweed', 'fish_eyes', 'pasta', 'gummy_bears'],
    shiftSecondsCozy: 85,
    shiftSecondsRush: 70,
    baseTargetsSolo: [3, 5, 7],
    baseTargetsDuo: [4, 6, 9],
    baseTargetsTrio: [5, 8, 11],
    recipes: [
      {
        id: 'tah_trout_bowl',
        name: 'Tahoe Fish-Eye Trout & Seaweed Bowl',
        shortName: 'Trout Seaweed Bowl',
        baseIngredient: 'fish',
        cookStation: 'grill_fryer',
        cookSeconds: 2.1,
        toppingIngredient: 'fish_eyes',
        spritePath: '/assets/food/dish_trout_bowl.png',
        featuredTags: ['Fish Eyes', 'Seaweed'],
      },
      {
        id: 'tah_pesto_pasta',
        name: 'Sierra Mild Herb & Seaweed Pasta',
        shortName: 'Tahoe Pasta',
        baseIngredient: 'pasta',
        cookStation: 'stove_pot',
        cookSeconds: 2.2,
        toppingIngredient: 'seaweed',
        spritePath: '/assets/food/dish_tahoe_pasta.png',
        featuredTags: ['Pasta', 'Seaweed'],
      },
      {
        id: 'tah_snowcap_gummy',
        name: 'Snowcap Rainbow Gummy Parfait',
        shortName: 'Snowcap Parfait',
        baseIngredient: 'gummy_bears',
        cookStation: 'prep_board',
        cookSeconds: 1.7,
        spritePath: '/assets/food/dish_gummy_parfait.png',
        featuredTags: ['Gummy Bears'],
      },
    ],
  },
  {
    index: 8,
    id: 'sanjose',
    name: 'San Jose, CA — Grand Finale!',
    shortName: 'San Jose, CA',
    stateCode: 'CA',
    subtitle: 'Silicon Valley Golden Night Market',
    vibe: 'You made it from Sharon, MA to San Jose, CA! Celebrate under golden festival lights serving all six of the family’s favorite fun foods!',
    lat: 37.338,
    lon: -121.886,
    sceneBgPath: '/assets/scenes/kitchen_sanjose.webp',
    accentColor: '#9333ea',
    crates: ['rice', 'seaweed', 'pasta', 'french_fries', 'cheetos', 'gummy_bears'],
    shiftSecondsCozy: 90,
    shiftSecondsRush: 75,
    baseTargetsSolo: [3, 5, 8],
    baseTargetsDuo: [4, 7, 10],
    baseTargetsTrio: [5, 9, 12],
    recipes: [
      {
        id: 'sj_japantown_onigiri',
        name: 'Japantown Seaweed Onigiri',
        shortName: 'Seaweed Onigiri',
        baseIngredient: 'rice',
        cookStation: 'prep_board',
        cookSeconds: 1.7,
        toppingIngredient: 'seaweed',
        spritePath: '/assets/food/dish_onigiri.png',
        featuredTags: ['Seaweed'],
      },
      {
        id: 'sj_garlic_pasta',
        name: 'Bay Area Garlic-Butter Pasta & Fries',
        shortName: 'Garlic Pasta',
        baseIngredient: 'pasta',
        cookStation: 'stove_pot',
        cookSeconds: 2.2,
        toppingIngredient: 'french_fries',
        spritePath: '/assets/food/dish_butter_pasta.png',
        featuredTags: ['Pasta', 'French Fries'],
      },
      {
        id: 'sj_cheetos_burrito',
        name: 'San Jose Cheetos Crunch Fry Burrito',
        shortName: 'Cheetos Burrito',
        baseIngredient: 'french_fries',
        cookStation: 'grill_fryer',
        cookSeconds: 2.0,
        toppingIngredient: 'cheetos',
        spritePath: '/assets/food/dish_cheetos_burrito.png',
        featuredTags: ['French Fries', 'Cheetos'],
      },
      {
        id: 'sj_boba_gummy',
        name: 'Silicon Valley Gummy Bear Sundae',
        shortName: 'Gummy Sundae',
        baseIngredient: 'gummy_bears',
        cookStation: 'prep_board',
        cookSeconds: 1.6,
        spritePath: '/assets/food/dish_gummy_parfait.png',
        featuredTags: ['Gummy Bears'],
      },
    ],
  },
] as const;

export const STOP_BY_ID: Record<StopId, StopDef> = Object.fromEntries(
  STOPS.map((s) => [s.id, s]),
) as Record<StopId, StopDef>;

export const RECIPE_BY_ID: Record<string, RecipeDef> = Object.fromEntries(
  STOPS.flatMap((s) => s.recipes.map((r) => [r.id, r])),
);

export function isValidStopId(value: unknown): value is StopId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STOP_BY_ID, value);
}

export function getNextStopId(stopId: StopId): StopId | null {
  const idx = STOPS.findIndex((s) => s.id === stopId);
  if (idx < 0 || idx >= STOPS.length - 1) return null;
  return STOPS[idx + 1]?.id ?? null;
}

export function getStarTargets(stopId: StopId, playerCount: number, pace: GamePace): StarTargets {
  const stop = STOP_BY_ID[stopId];
  const clamped = Math.max(1, Math.min(3, playerCount));
  const tuple =
    clamped === 1
      ? stop.baseTargetsSolo
      : clamped === 2
        ? stop.baseTargetsDuo
        : stop.baseTargetsTrio;

  return {
    oneStar: tuple[0],
    twoStar: tuple[1],
    threeStar: tuple[2],
    shiftSeconds: pace === 'cozy' ? stop.shiftSecondsCozy : stop.shiftSecondsRush,
  };
}

export function computeStarsEarned(servedCount: number, targets: StarTargets): 0 | 1 | 2 | 3 {
  if (servedCount >= targets.threeStar) return 3;
  if (servedCount >= targets.twoStar) return 2;
  if (servedCount >= targets.oneStar) return 1;
  return 0;
}

/**
 * Computes cheerful points awarded whenever a dish is served:
 * - 100 base points for any dish
 * - +25 bonus for multi-step recipes with a topping
 * - up to +50 freshness/speed bonus (rounded to neat 5-point increments)
 */
export function computeDishPoints(
  recipe: RecipeDef,
  remainingSec: number,
  patienceSec: number,
): number {
  const basePoints = 100;
  const toppingBonus = recipe.toppingIngredient ? 25 : 0;
  const ratio = patienceSec > 0 ? Math.max(0, Math.min(1, remainingSec / patienceSec)) : 0;
  const speedBonus = Math.round((ratio * 50) / 5) * 5;
  return basePoints + toppingBonus + speedBonus;
}

/**
 * Projects US continental lat/lon onto normalized [0..1, 0..1] coordinates
 * matching a standard continental US map frame (Lon -125..-67, Lat 24..50).
 * Ensures Yosemite, Lake Tahoe, and San Jose sit cleanly inside California,
 * and Denver sits squarely in Colorado.
 */
export function projectUsLatLon(lat: number, lon: number): { nx: number; ny: number } {
  const minLon = -125.5;
  const maxLon = -66.5;
  const minLat = 24.0;
  const maxLat = 50.0;

  // Mild northern cosine-like narrowing for natural US cartography aesthetics
  const rawX = (lon - minLon) / (maxLon - minLon);
  const rawY = 1 - (lat - minLat) / (maxLat - minLat);

  // Subtle inset padding so East/West Coast pins never clip edge chrome
  const nx = 0.08 + rawX * 0.84;
  const ny = 0.14 + rawY * 0.72;
  return { nx, ny };
}
