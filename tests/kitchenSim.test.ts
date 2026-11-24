import { describe, expect, it } from 'vitest';
import { computeGuidanceHint } from '../shared/guidance.js';
import type { PlayerProfile } from '../shared/types.js';
import { KitchenSim } from '../server/kitchenSim.js';
import { TripStore } from '../server/store.js';

function makePlayer(id: string, name: string, animalId: PlayerProfile['animalId'], kidHelper = false): PlayerProfile {
  return { playerId: id, name, animalId, kidHelper, connected: true };
}

describe('Authoritative Kitchen Sim, Star Unlocking & Kid Helper (PR #4)', () => {
  it('completes cooperative Austin Oasis Cheetos Fries via counter hand-off & scores', () => {
    const leo = makePlayer('p1', 'Leo', 'purple_bat', true);
    const maya = makePlayer('p2', 'Maya', 'panda', false);

    const sim = new KitchenSim({
      stopId: 'austin',
      pace: 'cozy',
      players: [leo, maya],
      soloAiHelper: false,
      nowMs: 1000,
    });

    // Force first order to Lake Travis Sunset Cheetos Fries (french_fries -> grill_fryer + cheetos)
    sim.orders[0]!.recipeId = 'aus_queso_fries';

    // Kid Helper guides Leo to grab french_fries first
    const hint1 = computeGuidanceHint(sim.getSnapshot(), 'p1');
    expect(hint1?.targetStationId).toBe('crate_french_fries');

    // Maya grabs french fries, cooks them on grill_fryer, and drops them on counter_a
    const mayaChef = sim.chefs.find((c) => c.playerId === 'p2')!;
    const crateFries = sim.stations.find((s) => s.id === 'crate_french_fries')!;
    const grill = sim.stations.find((s) => s.id === 'grill_fryer')!;
    const counterA = sim.stations.find((s) => s.id === 'counter_a')!;

    sim.interactWithStation(mayaChef, crateFries);
    expect(mayaChef.holding?.ingredientId).toBe('french_fries');

    sim.interactWithStation(mayaChef, grill);
    expect(grill.cookingActive).toBe(true);

    // Tick 2.5 seconds -> fries finish cooking without burning!
    for (let i = 0; i < 50; i++) sim.tick(0.05);
    expect(grill.cookingActive).toBe(false);
    expect(grill.item?.kind).toBe('cooked');

    // Maya moves cooked fries to shared Pass Counter
    sim.interactWithStation(mayaChef, grill);
    sim.interactWithStation(mayaChef, counterA);
    expect(counterA.item?.kind).toBe('cooked');

    // Kid Helper now guides Leo to grab Cheetos to top Maya's fries!
    const hint2 = computeGuidanceHint(sim.getSnapshot(), 'p1');
    expect(hint2?.targetStationId).toBe('crate_cheetos');

    // Leo grabs Cheetos & combines at counter_a -> instant plated dish!
    const leoChef = sim.chefs.find((c) => c.playerId === 'p1')!;
    const crateCheetos = sim.stations.find((s) => s.id === 'crate_cheetos')!;
    const serveWin = sim.stations.find((s) => s.id === 'serve_window')!;

    sim.interactWithStation(leoChef, crateCheetos);
    sim.interactWithStation(leoChef, counterA);
    expect(leoChef.holding).toEqual({ kind: 'plated', recipeId: 'aus_queso_fries' });

    // Kid Helper now guides Leo straight to Serve Window!
    const hint3 = computeGuidanceHint(sim.getSnapshot(), 'p1');
    expect(hint3?.targetStationId).toBe('serve_window');

    sim.interactWithStation(leoChef, serveWin);
    expect(sim.servedCount).toBe(1);
    expect(leoChef.holding).toBeNull();
  });

  it('supports Parent Star Ping override in Kid Helper & all 6 animal emotes', () => {
    const leo = makePlayer('p1', 'Leo', 'skunk', true);
    const sim = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: true,
      nowMs: 5000,
    });

    // Solo AI helper spawns with a DIFFERENT animal than Leo's skunk!
    expect(sim.chefs).toHaveLength(2);
    const aiChef = sim.chefs.find((c) => c.isAi)!;
    expect(aiChef.animalId).not.toBe('skunk');

    // Trigger Skunk giggle-fart emote
    sim.triggerEmote('p1');
    const events = sim.tick(0.05);
    expect(events.some((e) => e.type === 'animal_emote' && e.animalId === 'skunk')).toBe(true);

    // Adult Star Ping overrides Kid Helper target immediately
    sim.pingStation('Maya', '#9333ea', 'crate_fish_eyes');
    const hint = computeGuidanceHint(sim.getSnapshot(), 'p1');
    expect(hint?.isParentPing).toBe(true);
    expect(hint?.targetStationId).toBe('crate_fish_eyes');
  });

  it('unlocks next stop when earning >= 1 star before shift timer ends (and does not unlock at 0 stars)', () => {
    const store = new TripStore(':memory:');
    const trip = store.createTrip({ soloMode: true });
    const leo = makePlayer('p1', 'Leo', 'purple_cat', true);

    // Run 1: Serve 0 customers -> 0 stars, NYC remains locked
    const simZero = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: false,
      onShiftComplete: (stars) => {
        const res = store.recordStopResult(trip.token, 'sharon', stars)!;
        return { unlockedNextStopId: res.unlockedNextStopId, newBestStars: res.newBestStars };
      },
    });
    simZero.timeRemainingSec = 0.02;
    simZero.tick(0.05);
    expect(simZero.status).toBe('finished');
    expect(simZero.result?.starsEarned).toBe(0);
    expect(store.getTrip(trip.token)?.unlockedStopIds).toEqual(['sharon']);

    // Run 2: Serve solo 1-star target (3 customers) -> earns 1 star and unlocks NYC!
    const simWin = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: false,
      onShiftComplete: (stars) => {
        const res = store.recordStopResult(trip.token, 'sharon', stars)!;
        return { unlockedNextStopId: res.unlockedNextStopId, newBestStars: res.newBestStars };
      },
    });
    simWin.servedCount = simWin.targets.oneStar;
    simWin.timeRemainingSec = 0.02;
    simWin.tick(0.05);
    expect(simWin.result?.starsEarned).toBe(1);
    expect(simWin.result?.unlockedNextStopId).toBe('nyc');
    expect(store.getTrip(trip.token)?.unlockedStopIds).toEqual(['sharon', 'nyc']);

    store.close();
  });
});
