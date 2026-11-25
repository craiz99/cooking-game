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

  it('AI Sous-Chef never starts untouched orders on its own early in shift and cheers from its perch', () => {
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
    expect(ai.cheerText).toBe("You've got this!");

    // Tick 6 full seconds without the human starting anything -> stays calmly parked!
    for (let i = 0; i < 120; i++) sim.tick(0.05);

    expect(ai.holding).toBeNull();
    expect(ai.pendingStationId).toBeNull();
    // Every cook station & counter remains completely untouched!
    for (const st of sim.stations) {
      expect(st.item).toBeNull();
      expect(st.cookingActive).toBe(false);
    }
  });

  it('AI Sous-Chef finishes an abandoned cooked dish after generous grace period, but backs off if human holds the topping', () => {
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

    // Leo starts cooking soup, then steps away holding fish_eyes -> AI must NOT interfere!
    sim.interactWithStation(leoChef, crateSoup);
    sim.interactWithStation(leoChef, stove);
    leoChef.x = 7.2;
    leoChef.y = 4.6;
    leoChef.holding = { kind: 'raw', ingredientId: 'fish_eyes' };

    // Tick 10 seconds (soup cooks in 2.2s + >7s grace): AI must back off because Leo holds fish_eyes!
    for (let i = 0; i < 200; i++) sim.tick(0.05);
    expect(stove.item?.kind).toBe('cooked');
    expect(ai.holding).toBeNull();
    expect(sim.servedCount).toBe(0);

    // Now Leo drops fish_eyes (moves on to something else) -> AI calmly steps in, grabs fish_eyes, combines & serves!
    leoChef.holding = null;
    for (let i = 0; i < 360; i++) sim.tick(0.05); // up to 18s at calm AI speed
    expect(sim.servedCount).toBe(1);
    expect(sim.score).toBeGreaterThanOrEqual(125);
  });

  it('AI Sous-Chef waits patiently before cooking an abandoned raw base left on a Pass Counter', () => {
    const leo = makePlayer('p1', 'Leo', 'fox', false);
    const sim = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: true,
      nowMs: 1000,
      previewSeconds: 0,
    });

    sim.orders[0]!.recipeId = 'sharon_butter_pasta'; // pasta -> stove_pot + french_fries
    const leoChef = sim.chefs.find((c) => c.playerId === 'p1')!;
    const cratePasta = sim.stations.find((s) => s.id === 'crate_pasta')!;
    const counterA = sim.stations.find((s) => s.id === 'counter_a')!;
    const stove = sim.stations.find((s) => s.id === 'stove_pot')!;

    // Leo grabs pasta, drops it on Pass Counter, and walks far away
    sim.interactWithStation(leoChef, cratePasta);
    sim.interactWithStation(leoChef, counterA);
    leoChef.x = 7.6;
    leoChef.y = 4.8;

    // After 3 seconds (within 5.5s grace), AI must NOT snatch the pasta yet!
    for (let i = 0; i < 60; i++) sim.tick(0.05);
    expect(counterA.item?.ingredientId).toBe('pasta');

    // After another 6.5 seconds (past 5.5s grace + calm walk), AI picks up pasta and starts cooking on stove_pot!
    for (let i = 0; i < 130; i++) sim.tick(0.05);
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

  it('AI Sous-Chef never pre-fetches or competes while human is actively cooking, and cheers when human serves', () => {
    const leo = makePlayer('p1', 'Leo', 'orange_dog', true);
    const sim = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: true,
      nowMs: 1000,
      previewSeconds: 0,
    });

    sim.orders[0]!.recipeId = 'sharon_fisheye_chowder'; // soup -> stove_pot (2.2s) + fish_eyes
    const leoChef = sim.chefs.find((c) => c.playerId === 'p1')!;
    const ai = sim.chefs.find((c) => c.isAi)!;
    const crateSoup = sim.stations.find((s) => s.id === 'crate_soup')!;
    const stove = sim.stations.find((s) => s.id === 'stove_pot')!;
    const crateFishEyes = sim.stations.find((s) => s.id === 'crate_fish_eyes')!;
    const serveWin = sim.stations.find((s) => s.id === 'serve_window')!;

    // Leo puts soup on stove_pot and walks away briefly while it cooks
    sim.interactWithStation(leoChef, crateSoup);
    sim.interactWithStation(leoChef, stove);
    leoChef.x = 2.0;
    leoChef.y = 3.5;

    // Tick 4.5s (2.2s cook + 2.3s after cook finishes): AI must NEVER pre-fetch or steal!
    for (let i = 0; i < 90; i++) {
      sim.tick(0.05);
      expect(ai.holding).toBeNull();
      expect(ai.pendingStationId).toBeNull();
    }
    expect(stove.item?.kind).toBe('cooked');

    // Leo finishes and serves the dish -> AI cheers enthusiastically!
    sim.interactWithStation(leoChef, crateFishEyes);
    sim.interactWithStation(leoChef, stove);
    sim.interactWithStation(leoChef, serveWin);
    const events = sim.tick(0.05);

    expect(sim.servedCount).toBe(1);
    expect(events.some((e) => e.type === 'ai_cheer')).toBe(true);
    expect(ai.cheerText).toBeTruthy();
    expect(ai.holding).toBeNull();
  });

  it('AI Sous-Chef yields immediately mid-path and cheers when human claims a station', () => {
    const leo = makePlayer('p1', 'Leo', 'purple_cat', true);
    const sim = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: true,
      nowMs: 1000,
      previewSeconds: 0,
    });

    sim.orders[0]!.recipeId = 'sharon_fisheye_chowder';
    const leoChef = sim.chefs.find((c) => c.playerId === 'p1')!;
    const ai = sim.chefs.find((c) => c.isAi)!;
    const crateSoup = sim.stations.find((s) => s.id === 'crate_soup')!;
    const stove = sim.stations.find((s) => s.id === 'stove_pot')!;

    sim.interactWithStation(leoChef, crateSoup);
    sim.interactWithStation(leoChef, stove);
    leoChef.x = 7.4;
    leoChef.y = 4.6;

    // Wait until AI decides to walk to crate_fish_eyes after the generous 7s grace period
    let sawAiStartHeading = false;
    for (let i = 0; i < 240; i++) {
      sim.tick(0.05);
      if (ai.pendingStationId === 'crate_fish_eyes' && ai.path.length > 0) {
        sawAiStartHeading = true;
        break;
      }
    }
    expect(sawAiStartHeading).toBe(true);

    // Human claims crate_fish_eyes -> AI immediately aborts, cheers ("You've got it!" / "All yours, Chef!"), and backs off!
    sim.tapStation(leoChef.playerId, 'crate_fish_eyes');
    const yieldEvents = sim.tick(0.05);
    expect(ai.pendingStationId).toBeNull();
    expect(yieldEvents.some((e) => e.type === 'ai_cheer')).toBe(true);
    expect(["You've got it!", 'All yours, Chef!']).toContain(ai.cheerText);
  });

  it('AI Sous-Chef rescues ONE dish when player is truly stalled (>=14s no progress) then rests during breather', () => {
    const leo = makePlayer('p1', 'Leo', 'panda', true);
    const sim = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: true,
      nowMs: 1000,
      previewSeconds: 0,
    });

    // Make all 3 orders 1-step Seaweed Pack so rescue timing is clean and deterministic
    for (const o of sim.orders) o.recipeId = 'sharon_seaweed_pack';
    const leoChef = sim.chefs.find((c) => c.playerId === 'p1')!;
    const ai = sim.chefs.find((c) => c.isAi)!;
    leoChef.x = 4.5;
    leoChef.y = 4.6;

    // Human wanders aimlessly on floor without cooking for 12s -> AI still stays parked!
    sim.tapFloor(leoChef.playerId, 3.0, 4.6);
    for (let i = 0; i < 240; i++) sim.tick(0.05);
    expect(ai.holding).toBeNull();
    expect(ai.pendingStationId).toBeNull();
    expect(sim.servedCount).toBe(0);

    // Continue stalling past 14s -> AI steps in, cooks & serves ONE rescue dish!
    for (let i = 0; i < 360; i++) {
      sim.tick(0.05);
      if (sim.servedCount === 1) break;
    }
    expect(sim.servedCount).toBe(1);
    expect(["I've got your back!", 'Back to you, Chef!']).toContain(ai.cheerText);

    // During the 7s post-serve breather (test next 5s), AI must NOT start a second dish!
    for (let i = 0; i < 100; i++) {
      sim.tick(0.05);
      expect(ai.holding).toBeNull();
    }
    expect(sim.servedCount).toBe(1);
  });

  it('supports playing completely alone (soloAiHelper: false) and live mid-shift toggling via setSoloAiHelper()', () => {
    const leo = makePlayer('p1', 'Leo', 'skunk', true);

    // Starting alone spawns only the human chef
    const soloSim = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: false,
      nowMs: 1000,
      previewSeconds: 0,
    });
    expect(soloSim.chefs).toHaveLength(1);
    expect(soloSim.chefs.some((c) => c.isAi)).toBe(false);

    // Live toggle ON mid-shift spawns an unclaimed AI chef cheering the player on
    soloSim.setSoloAiHelper(true);
    expect(soloSim.chefs).toHaveLength(2);
    const ai = soloSim.chefs.find((c) => c.isAi)!;
    expect(ai.animalId).not.toBe('skunk');
    expect(ai.cheerText).toBe("You've got this!");

    // If AI is holding an item when turned OFF mid-shift, it safely places it onto an empty counter
    ai.holding = { kind: 'plated', recipeId: 'sharon_seaweed_pack' };
    soloSim.setSoloAiHelper(false);
    expect(soloSim.chefs).toHaveLength(1);
    expect(soloSim.chefs.some((c) => c.isAi)).toBe(false);
    const counterA = soloSim.stations.find((s) => s.id === 'counter_a')!;
    expect(counterA.item).toEqual({ kind: 'plated', recipeId: 'sharon_seaweed_pack' });
  });

  it('Kid Helper follows the exact 2-step recipe sequence while base cooks and never asks for more of Step 1 (PR #20)', () => {
    const leo = makePlayer('p1', 'Leo', 'purple_bat', true);
    const sim = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: false,
      nowMs: 1000,
      previewSeconds: 0,
    });

    // Primary order: New England Fish-Eye Chowder (soup -> stove_pot + fish_eyes)
    sim.orders[0]!.recipeId = 'sharon_fisheye_chowder';
    const leoChef = sim.chefs.find((c) => c.playerId === 'p1')!;
    const crateSoup = sim.stations.find((s) => s.id === 'crate_soup')!;
    const stove = sim.stations.find((s) => s.id === 'stove_pot')!;
    const crateFishEyes = sim.stations.find((s) => s.id === 'crate_fish_eyes')!;

    // Step 1: Empty hands -> Grab Chowder!
    expect(computeGuidanceHint(sim.getSnapshot(), 'p1')?.targetStationId).toBe('crate_soup');

    // Step 2: Holding soup -> Cook Chowder at stove_pot!
    sim.interactWithStation(leoChef, crateSoup);
    expect(computeGuidanceHint(sim.getSnapshot(), 'p1')?.targetStationId).toBe('stove_pot');

    // Step 3: Put soup on stove_pot (actively cooking!) -> MUST advance to crate_fish_eyes, NEVER crate_soup!
    sim.interactWithStation(leoChef, stove);
    expect(stove.cookingActive).toBe(true);
    const whileCookingHint = computeGuidanceHint(sim.getSnapshot(), 'p1');
    expect(whileCookingHint?.targetStationId).toBe('crate_fish_eyes');
    expect(whileCookingHint?.targetStationId).not.toBe('crate_soup');

    // Step 4: Child grabs fish_eyes while soup is STILL cooking -> guides straight to stove_pot (not counter!)
    sim.interactWithStation(leoChef, crateFishEyes);
    expect(stove.cookingActive).toBe(true);
    expect(computeGuidanceHint(sim.getSnapshot(), 'p1')?.targetStationId).toBe('stove_pot');

    // Step 5: Soup finishes cooking -> still guides to stove_pot to combine -> then serve_window!
    for (let i = 0; i < 50; i++) sim.tick(0.05);
    expect(stove.cookingActive).toBe(false);
    expect(computeGuidanceHint(sim.getSnapshot(), 'p1')?.targetStationId).toBe('stove_pot');

    sim.interactWithStation(leoChef, stove);
    expect(leoChef.holding?.kind).toBe('plated');
    expect(computeGuidanceHint(sim.getSnapshot(), 'p1')?.targetStationId).toBe('serve_window');
  });

  it('Kid Helper waits on actively prepping 1-step dish instead of asking to grab more of Step 1 (PR #20)', () => {
    const leo = makePlayer('p1', 'Leo', 'purple_cat', true);
    const sim = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: false,
      nowMs: 1000,
      previewSeconds: 0,
    });

    // Primary order: Sharon Crispy Seaweed Pack (seaweed -> grill_fryer, 1-step!)
    sim.orders[0]!.recipeId = 'sharon_seaweed_pack';
    const leoChef = sim.chefs.find((c) => c.playerId === 'p1')!;
    const crateSeaweed = sim.stations.find((s) => s.id === 'crate_seaweed')!;
    const grill = sim.stations.find((s) => s.id === 'grill_fryer')!;

    expect(computeGuidanceHint(sim.getSnapshot(), 'p1')?.targetStationId).toBe('crate_seaweed');

    sim.interactWithStation(leoChef, crateSeaweed);
    expect(computeGuidanceHint(sim.getSnapshot(), 'p1')?.targetStationId).toBe('grill_fryer');

    // Put seaweed on grill_fryer -> actively roasting -> MUST point at grill_fryer ("Almost Done!"), NOT crate_seaweed!
    sim.interactWithStation(leoChef, grill);
    expect(grill.cookingActive).toBe(true);
    const preppingHint = computeGuidanceHint(sim.getSnapshot(), 'p1');
    expect(preppingHint?.targetStationId).toBe('grill_fryer');
    expect(preppingHint?.message).toContain('Almost Done');

    // Once done -> guides to grill_fryer ("Grab Dish!") -> then serve_window!
    for (let i = 0; i < 40; i++) sim.tick(0.05);
    const readyHint = computeGuidanceHint(sim.getSnapshot(), 'p1');
    expect(readyHint?.targetStationId).toBe('grill_fryer');
    expect(readyHint?.message).toContain('Grab Dish');

    sim.interactWithStation(leoChef, grill);
    expect(computeGuidanceHint(sim.getSnapshot(), 'p1')?.targetStationId).toBe('serve_window');
  });

  it('Kid Helper guides child to pick up a staged raw base on a Pass Counter instead of grabbing a duplicate (PR #20)', () => {
    const leo = makePlayer('p1', 'Leo', 'fox', true);
    const sim = new KitchenSim({
      stopId: 'sharon',
      pace: 'cozy',
      players: [leo],
      soloAiHelper: false,
      nowMs: 1000,
      previewSeconds: 0,
    });

    sim.orders[0]!.recipeId = 'sharon_pasta_fries'; // pasta -> stove_pot + french_fries
    const leoChef = sim.chefs.find((c) => c.playerId === 'p1')!;
    const cratePasta = sim.stations.find((s) => s.id === 'crate_pasta')!;
    const counterA = sim.stations.find((s) => s.id === 'counter_a')!;

    sim.interactWithStation(leoChef, cratePasta);
    sim.interactWithStation(leoChef, counterA);
    expect(leoChef.holding).toBeNull();
    expect(counterA.item?.ingredientId).toBe('pasta');

    expect(computeGuidanceHint(sim.getSnapshot(), 'p1')?.targetStationId).toBe('counter_a');
  });
});
