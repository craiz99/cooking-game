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
      previewSeconds: 0,
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
    expect(sim.score).toBeGreaterThanOrEqual(125);
    expect(sim.getSnapshot().score).toBe(sim.score);
    const serveEvents = sim.tick(0.05);
    const serveEv = serveEvents.find((e) => e.type === 'dish_served');
    expect(serveEv?.pointsAwarded).toBe(sim.score);
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
      previewSeconds: 0,
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
      previewSeconds: 0,
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

    // Run 2: Serve solo 1-star target -> earns 1 star and unlocks NYC!
    const simWin = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: false,
      previewSeconds: 0,
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

  it('AI Sous-Chef never starts untouched orders on its own and waits calmly out of the way', () => {
    const leo = makePlayer('p1', 'Leo', 'purple_bat', true);
    const sim = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: true,
      nowMs: 1000,
      previewSeconds: 0,
    });

    const ai = sim.chefs.find((c) => c.isAi)!;
    // Tick 6 full seconds without the human starting anything
    for (let i = 0; i < 120; i++) sim.tick(0.05);

    expect(ai.holding).toBeNull();
    expect(ai.pendingStationId).toBeNull();
    // Every cook station & counter remains completely untouched!
    for (const st of sim.stations) {
      expect(st.item).toBeNull();
      expect(st.cookingActive).toBe(false);
    }
  });

  it('AI Sous-Chef finishes a player-started cooked dish after grace period, but backs off if human holds the topping', () => {
    const leo = makePlayer('p1', 'Leo', 'purple_cat', true);
    const sim = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: true,
      nowMs: 1000,
      previewSeconds: 0,
    });

    sim.orders[0]!.recipeId = 'sharon_fisheye_chowder'; // soup -> stove_pot + fish_eyes
    const leoChef = sim.chefs.find((c) => c.playerId === 'p1')!;
    const ai = sim.chefs.find((c) => c.isAi)!;
    const crateSoup = sim.stations.find((s) => s.id === 'crate_soup')!;
    const stove = sim.stations.find((s) => s.id === 'stove_pot')!;

    // Leo starts cooking soup, then steps away holding fish_eyes -> AI should NOT interfere!
    sim.interactWithStation(leoChef, crateSoup);
    sim.interactWithStation(leoChef, stove);
    leoChef.x = 7.2;
    leoChef.y = 4.6;
    leoChef.holding = { kind: 'raw', ingredientId: 'fish_eyes' };

    // Tick 5 seconds (soup cooks in 2.2s + >2.5s grace): AI must back off because Leo holds fish_eyes!
    for (let i = 0; i < 100; i++) sim.tick(0.05);
    expect(stove.item?.kind).toBe('cooked');
    expect(ai.holding).toBeNull();
    expect(sim.servedCount).toBe(0);

    // Now Leo drops fish_eyes (moves on to something else) -> AI steps in, grabs fish_eyes, combines & serves!
    leoChef.holding = null;
    for (let i = 0; i < 240; i++) sim.tick(0.05); // up to 12s to walk crate -> stove -> serve window
    expect(sim.servedCount).toBe(1);
    expect(sim.score).toBeGreaterThanOrEqual(125);
  });

  it('AI Sous-Chef cooks a raw base ingredient handed off by the player onto a Pass Counter', () => {
    const leo = makePlayer('p1', 'Leo', 'fox', false);
    const sim = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: true,
      nowMs: 1000,
      previewSeconds: 0,
    });

    const leoChef = sim.chefs.find((c) => c.playerId === 'p1')!;
    const cratePasta = sim.stations.find((s) => s.id === 'crate_pasta')!;
    const counterA = sim.stations.find((s) => s.id === 'counter_a')!;
    const stove = sim.stations.find((s) => s.id === 'stove_pot')!;

    // Leo grabs pasta, drops it on Pass Counter as a handoff, and walks away
    sim.interactWithStation(leoChef, cratePasta);
    sim.interactWithStation(leoChef, counterA);
    leoChef.x = 7.4;
    leoChef.y = 4.5;

    // Tick 6 seconds -> AI picks up pasta from counter_a and starts cooking it on stove_pot!
    for (let i = 0; i < 120; i++) sim.tick(0.05);
    expect(counterA.item).toBeNull();
    expect(stove.item?.ingredientId).toBe('pasta');
  });

  it('starts in a 6-second recipe preview phase holding shift timer steady, auto-starts, and supports skipPreview()', () => {
    const leo = makePlayer('p1', 'Leo', 'panda', true);
    const sim = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: false,
      nowMs: 1000,
    });

    const initialClock = sim.timeRemainingSec;
    expect(sim.status).toBe('preview');
    expect(sim.getSnapshot().previewRemainingSec).toBe(6);

    // Tick 3 seconds during preview: shift timer must stay completely frozen!
    for (let i = 0; i < 60; i++) sim.tick(0.05);
    expect(sim.status).toBe('preview');
    expect(sim.timeRemainingSec).toBe(initialClock);
    expect(sim.getSnapshot().previewRemainingSec).toBe(3);

    // Tick remaining 3 seconds -> transitions automatically to 'running' and emits 'shift_started'
    let startedEventSeen = false;
    for (let i = 0; i < 60; i++) {
      const evs = sim.tick(0.05);
      if (evs.some((e) => e.type === 'shift_started')) startedEventSeen = true;
    }
    expect(sim.status).toBe('running');
    expect(startedEventSeen).toBe(true);
    expect(sim.getSnapshot().previewRemainingSec).toBe(0);

    // Also test early skipPreview()
    const simSkip = new KitchenSim({
      stopId: 'nyc',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: false,
    });
    expect(simSkip.status).toBe('preview');
    simSkip.skipPreview();
    expect(simSkip.status).toBe('running');
    expect(simSkip.getSnapshot().previewRemainingSec).toBe(0);
  });
});
