import { describe, expect, it } from 'vitest';
import { LocalSoloTransport, type StorageLike } from '../client/src/net/localSoloTransport.js';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe('Serverless Static Solo Transport for GitHub Pages (PR #9)', () => {
  it('runs full Solo Mode in-browser, spawns unique AI helper, unlocks stops on >=1 star & persists in localStorage', async () => {
    const storage = createMemoryStorage();
    const transport = new LocalSoloTransport(storage);
    expect(transport.isStaticSolo).toBe(true);

    const joinRes = await transport.joinTrip({
      token: 'solo-github-pages',
      name: 'Leo',
      preferredAnimalId: 'purple_bat',
      kidHelper: true,
    });
    expect(joinRes.ok).toBe(true);
    if (!joinRes.ok) throw new Error('expected ok');
    expect(joinRes.player.animalId).toBe('purple_bat');

    // Switch animal chef
    expect((await transport.selectAnimal('skunk')).ok).toBe(true);
    expect(transport.getPlayer().animalId).toBe('skunk');

    // Enable Solo AI Sous-Chef and start Sharon stop
    transport.setSoloAiHelper(true);
    const startRes = await transport.startShift('sharon');
    expect(startRes.ok).toBe(true);

    const sim = transport.getSimForTest()!;
    expect(sim).not.toBeNull();
    expect(sim.status).toBe('preview');
    transport.skipPreview();
    expect(sim.status).toBe('running');
    expect(sim.chefs).toHaveLength(2);
    const ai = sim.chefs.find((c) => c.isAi)!;
    expect(ai.animalId).not.toBe('skunk');

    // Serve enough customers for 2 stars with points and finish shift
    sim.servedCount = sim.targets.twoStar;
    sim.score = 620;
    sim.finishShift();

    const afterWin = transport.getState();
    expect(afterWin.trip.starsByStop.sharon).toBe(2);
    expect(afterWin.trip.totalScore).toBe(620);
    expect(afterWin.trip.unlockedStopIds).toEqual(['sharon', 'nyc']);

    // Drive purple van to newly unlocked NYC
    expect((await transport.driveVan('nyc')).ok).toBe(true);
    expect((await transport.driveVan('tahoe')).ok).toBe(false); // still locked

    transport.dispose();

    // Simulate page reload on GitHub Pages with a fresh LocalSoloTransport sharing storage
    const reloaded = new LocalSoloTransport(storage);
    const reloadedState = reloaded.getState();
    expect(reloadedState.trip.currentStopId).toBe('nyc');
    expect(reloadedState.trip.unlockedStopIds).toEqual(['sharon', 'nyc']);
    expect(reloadedState.trip.starsByStop.sharon).toBe(2);
    expect(reloadedState.trip.totalScore).toBe(620);

    // Reset Solo Progress restores fresh Sharon start and 0 score
    reloaded.resetSoloProgress();
    const resetState = reloaded.getState();
    expect(resetState.trip.currentStopId).toBe('sharon');
    expect(resetState.trip.unlockedStopIds).toEqual(['sharon']);
    expect(resetState.trip.starsByStop).toEqual({});
    expect(resetState.trip.totalScore).toBe(0);
    reloaded.dispose();
  });
});
