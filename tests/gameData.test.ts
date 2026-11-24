import { describe, expect, it } from 'vitest';
import { ANIMALS, ANIMAL_BY_ID, INGREDIENT_BY_ID, isValidAnimalId } from '../shared/animals.js';
import {
  STOPS,
  computeStarsEarned,
  getNextStopId,
  getStarTargets,
  projectUsLatLon,
} from '../shared/stops.js';

describe('Animal Chefs & 8-Stop Zero-Spice Road Trip Data (PR #2)', () => {
  it('defines all 6 unique animal chefs including Small Cute Purple Bat', () => {
    expect(ANIMALS).toHaveLength(6);
    const ids = ANIMALS.map((a) => a.id);
    expect(new Set(ids).size).toBe(6);
    expect(ids).toEqual([
      'purple_cat',
      'orange_dog',
      'panda',
      'fox',
      'skunk',
      'purple_bat',
    ]);
    expect(ANIMAL_BY_ID.purple_bat.isSmall).toBe(true);
    expect(ANIMAL_BY_ID.purple_bat.hovers).toBe(true);
    expect(ANIMAL_BY_ID.panda.behaviorDesc.toLowerCase()).toContain('bamboo');
    expect(ANIMAL_BY_ID.skunk.behaviorDesc.toLowerCase()).toContain('fart');
    expect(isValidAnimalId('purple_bat')).toBe(true);
    expect(isValidAnimalId('dragon')).toBe(false);
  });

  it('orders the 8 stops accurately from Sharon, MA to San Jose, CA via Austin, Denver, Yosemite & Tahoe', () => {
    expect(STOPS.map((s) => s.id)).toEqual([
      'sharon',
      'nyc',
      'chicago',
      'austin',
      'denver',
      'yosemite',
      'tahoe',
      'sanjose',
    ]);

    expect(getNextStopId('sharon')).toBe('nyc');
    expect(getNextStopId('austin')).toBe('denver');
    expect(getNextStopId('denver')).toBe('yosemite');
    expect(getNextStopId('yosemite')).toBe('tahoe');
    expect(getNextStopId('tahoe')).toBe('sanjose');
    expect(getNextStopId('sanjose')).toBeNull();

    // Verify Yosemite, Tahoe, and San Jose are all California stops and project west of Denver
    const denver = STOPS.find((s) => s.id === 'denver')!;
    const yosemite = STOPS.find((s) => s.id === 'yosemite')!;
    const tahoe = STOPS.find((s) => s.id === 'tahoe')!;
    const sanjose = STOPS.find((s) => s.id === 'sanjose')!;

    expect([yosemite.stateCode, tahoe.stateCode, sanjose.stateCode]).toEqual(['CA', 'CA', 'CA']);
    expect(denver.stateCode).toBe('CO');

    const pDen = projectUsLatLon(denver.lat, denver.lon);
    const pYos = projectUsLatLon(yosemite.lat, yosemite.lon);
    const pTah = projectUsLatLon(tahoe.lat, tahoe.lon);
    const pSJ = projectUsLatLon(sanjose.lat, sanjose.lon);

    expect(pYos.nx).toBeLessThan(pDen.nx);
    expect(pTah.ny).toBeLessThan(pYos.ny); // Lake Tahoe is north of Yosemite
    expect(pSJ.nx).toBeLessThan(pYos.nx); // San Jose is west (coastal) of Yosemite
  });

  it('ensures every stop recipe is completable from its crates and is 100% zero-spice', () => {
    const spicyWords = ['spicy', 'flamin', 'chile', 'chili', 'jalapeno', 'jalapeño', 'salsa', 'hot sauce', 'sriracha'];
    const allIngredientsUsed = new Set<string>();

    for (const stop of STOPS) {
      const crateSet = new Set(stop.crates);
      expect(stop.recipes.length).toBeGreaterThanOrEqual(3);

      for (const recipe of stop.recipes) {
        expect(crateSet.has(recipe.baseIngredient)).toBe(true);
        expect(INGREDIENT_BY_ID[recipe.baseIngredient]).toBeDefined();
        allIngredientsUsed.add(recipe.baseIngredient);

        if (recipe.toppingIngredient) {
          expect(crateSet.has(recipe.toppingIngredient)).toBe(true);
          expect(INGREDIENT_BY_ID[recipe.toppingIngredient]).toBeDefined();
          allIngredientsUsed.add(recipe.toppingIngredient);
        }

        const lowerName = recipe.name.toLowerCase();
        for (const bad of spicyWords) {
          expect(lowerName).not.toContain(bad);
        }
      }
    }

    // Confirm all 6 requested fun foods are covered across the road trip!
    for (const required of ['pasta', 'seaweed', 'cheetos', 'gummy_bears', 'french_fries', 'fish_eyes']) {
      expect(allIngredientsUsed.has(required)).toBe(true);
    }
  });

  it('computes monotonic 1-3 star targets across 1, 2, and 3 players', () => {
    for (const stop of STOPS) {
      const solo = getStarTargets(stop.id, 1, 'cozy');
      const duo = getStarTargets(stop.id, 2, 'cozy');
      const trio = getStarTargets(stop.id, 3, 'cozy');

      for (const t of [solo, duo, trio]) {
        expect(t.oneStar).toBeGreaterThan(0);
        expect(t.twoStar).toBeGreaterThan(t.oneStar);
        expect(t.threeStar).toBeGreaterThan(t.twoStar);
      }

      expect(trio.oneStar).toBeGreaterThanOrEqual(duo.oneStar);
      expect(duo.oneStar).toBeGreaterThanOrEqual(solo.oneStar);

      expect(computeStarsEarned(0, solo)).toBe(0);
      expect(computeStarsEarned(solo.oneStar - 1, solo)).toBe(0);
      expect(computeStarsEarned(solo.oneStar, solo)).toBe(1);
      expect(computeStarsEarned(solo.twoStar, solo)).toBe(2);
      expect(computeStarsEarned(solo.threeStar, solo)).toBe(3);
    }
  });
});
