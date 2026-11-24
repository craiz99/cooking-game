import { ANIMAL_BY_ID, isValidAnimalId } from '@shared/animals';
import { KitchenSim } from '@shared/kitchenSim';
import { getNextStopId, isValidStopId } from '@shared/stops';
import type {
  AnimalId,
  GamePace,
  KitchenSnapshot,
  PlayerProfile,
  RoomStatePayload,
  ScreenMode,
  StopId,
  TripSave,
} from '@shared/types';
import type { IGameTransport, SimEventPayload } from './transport';

const SOLO_SAVE_KEY = 'purple_van_solo_save_v1';
const SIM_TICK_MS = 50; // 20 Hz

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function createFreshSoloTrip(): TripSave {
  const now = new Date().toISOString();
  return {
    token: 'solo-github-pages',
    createdAt: now,
    updatedAt: now,
    currentStopId: 'sharon',
    unlockedStopIds: ['sharon'],
    starsByStop: {},
    crewLocked: false,
    lockedNames: [],
    pace: 'cozy',
    soloMode: true,
    soloAiHelper: true,
  };
}

/**
 * 100% serverless, in-browser Single-Player transport for GitHub Pages static hosting.
 * Runs the exact same KitchenSim at 20 Hz and auto-saves road trip progress in localStorage.
 */
export class LocalSoloTransport implements IGameTransport {
  readonly isStaticSolo = true;
  onRoomState?: (state: RoomStatePayload) => void;
  onKitchenSnapshot?: (snap: KitchenSnapshot) => void;
  onSimEvent?: (ev: SimEventPayload) => void;
  onDisconnect?: () => void;

  private readonly storage: StorageLike | null;
  private trip: TripSave;
  private screen: ScreenMode = 'lobby';
  private vanStopId: StopId = 'sharon';
  private player: PlayerProfile;
  private sim: KitchenSim | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(storage?: StorageLike | null) {
    this.storage =
      storage !== undefined
        ? storage
        : typeof globalThis.localStorage !== 'undefined'
          ? globalThis.localStorage
          : null;

    this.trip = this.loadTrip();
    this.vanStopId = this.trip.currentStopId;
    this.player = {
      playerId: 'solo_chef',
      name: 'Chef',
      animalId: 'purple_bat',
      kidHelper: true,
      connected: true,
    };
  }

  private loadTrip(): TripSave {
    try {
      const raw = this.storage?.getItem(SOLO_SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TripSave>;
        const fresh = createFreshSoloTrip();
        const currentStopId = isValidStopId(parsed.currentStopId) ? parsed.currentStopId : 'sharon';
        const unlocked =
          Array.isArray(parsed.unlockedStopIds) && parsed.unlockedStopIds.length > 0
            ? parsed.unlockedStopIds.filter(isValidStopId)
            : (['sharon'] as StopId[]);
        if (!unlocked.includes('sharon')) unlocked.unshift('sharon');
        return {
          ...fresh,
          ...parsed,
          currentStopId,
          unlockedStopIds: unlocked,
          starsByStop: parsed.starsByStop ?? {},
          pace: parsed.pace === 'rush' ? 'rush' : 'cozy',
          soloMode: true,
          soloAiHelper: typeof parsed.soloAiHelper === 'boolean' ? parsed.soloAiHelper : true,
        };
      }
    } catch {
      // Fallback to fresh trip
    }
    return createFreshSoloTrip();
  }

  private persistTrip(): void {
    this.trip.updatedAt = new Date().toISOString();
    try {
      this.storage?.setItem(SOLO_SAVE_KEY, JSON.stringify(this.trip));
    } catch {
      // ignore quota / private-browsing errors
    }
  }

  getState(): RoomStatePayload {
    return {
      trip: { ...this.trip, unlockedStopIds: [...this.trip.unlockedStopIds], starsByStop: { ...this.trip.starsByStop } },
      screen: this.screen,
      players: [{ ...this.player }],
      vanStopId: this.vanStopId,
      kitchen: this.sim ? this.sim.getSnapshot() : null,
    };
  }

  getPlayer(): PlayerProfile {
    return { ...this.player };
  }

  private emitState(): void {
    this.onRoomState?.(this.getState());
  }

  private stopSimLoop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.sim = null;
  }

  private startSimLoop(): void {
    if (this.intervalId !== null) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      if (!this.sim || this.sim.status !== 'running') return;
      const events = this.sim.tick(SIM_TICK_MS / 1000);
      this.onKitchenSnapshot?.(this.sim.getSnapshot());
      for (const ev of events) {
        this.onSimEvent?.(ev);
        if (ev.type === 'shift_finished') {
          this.emitState();
        }
      }
    }, SIM_TICK_MS);
  }

  async joinTrip(params: {
    token: string;
    name: string;
    playerId?: string;
    preferredAnimalId?: AnimalId;
    kidHelper: boolean;
  }): Promise<{ ok: true; player: PlayerProfile; state: RoomStatePayload } | { ok: false; error: string }> {
    const clean = params.name.trim().slice(0, 16) || 'Chef';
    this.player.name = clean;
    this.player.kidHelper = Boolean(params.kidHelper);
    if (params.preferredAnimalId && isValidAnimalId(params.preferredAnimalId)) {
      this.player.animalId = params.preferredAnimalId;
    }
    const state = this.getState();
    this.emitState();
    return { ok: true, player: this.getPlayer(), state };
  }

  async selectAnimal(animalId: AnimalId): Promise<{ ok: boolean; error?: string }> {
    if (!isValidAnimalId(animalId)) return { ok: false, error: 'Unknown animal chef.' };
    this.player.animalId = animalId;
    this.emitState();
    return { ok: true };
  }

  setKidHelper(enabled: boolean): void {
    this.player.kidHelper = Boolean(enabled);
    const chef = this.sim?.chefs.find((c) => c.playerId === this.player.playerId);
    if (chef) chef.kidHelper = this.player.kidHelper;
    this.emitState();
  }

  setCrewLocked(_locked: boolean): void {
    // No-op in single-player static mode
  }

  setPace(pace: GamePace): void {
    this.trip.pace = pace === 'rush' ? 'rush' : 'cozy';
    this.persistTrip();
    this.emitState();
  }

  setSoloAiHelper(enabled: boolean): void {
    this.trip.soloAiHelper = Boolean(enabled);
    this.persistTrip();
    this.emitState();
  }

  openMap(): void {
    this.stopSimLoop();
    this.screen = 'map';
    this.emitState();
  }

  returnToLobby(): void {
    this.stopSimLoop();
    this.screen = 'lobby';
    this.emitState();
  }

  async driveVan(stopId: StopId): Promise<{ ok: boolean; error?: string }> {
    if (!isValidStopId(stopId) || !this.trip.unlockedStopIds.includes(stopId)) {
      return { ok: false, error: 'Earn at least 1 star on the previous stop to unlock this destination!' };
    }
    this.vanStopId = stopId;
    this.trip.currentStopId = stopId;
    this.persistTrip();
    this.emitState();
    return { ok: true };
  }

  async startShift(stopId?: StopId): Promise<{ ok: boolean; error?: string }> {
    const targetStop = stopId ?? this.vanStopId;
    if (!this.trip.unlockedStopIds.includes(targetStop)) {
      return { ok: false, error: 'Earn 1 star on the previous stop first!' };
    }

    this.stopSimLoop();
    this.vanStopId = targetStop;
    this.trip.currentStopId = targetStop;
    this.persistTrip();

    this.sim = new KitchenSim({
      stopId: targetStop,
      pace: this.trip.pace,
      players: [{ ...this.player }],
      soloAiHelper: this.trip.soloAiHelper,
      onShiftComplete: (starsEarned) => {
        let unlockedNextStopId: StopId | null = null;
        let newBestStars = false;
        if (starsEarned >= 1) {
          const earned = starsEarned as 1 | 2 | 3;
          const prev = this.trip.starsByStop[targetStop] ?? 0;
          if (earned > prev) {
            this.trip.starsByStop[targetStop] = earned;
            newBestStars = true;
          }
          const next = getNextStopId(targetStop);
          if (next && !this.trip.unlockedStopIds.includes(next)) {
            this.trip.unlockedStopIds.push(next);
            unlockedNextStopId = next;
          }
          this.persistTrip();
        }
        return { unlockedNextStopId, newBestStars };
      },
    });

    this.screen = 'kitchen';
    this.startSimLoop();
    this.emitState();
    return { ok: true };
  }

  tapStation(stationId: string): void {
    this.sim?.tapStation(this.player.playerId, stationId);
  }

  tapFloor(x: number, y: number): void {
    this.sim?.tapFloor(this.player.playerId, x, y);
  }

  moveDir(dx: number, dy: number): void {
    this.sim?.moveByVector(this.player.playerId, dx, dy, SIM_TICK_MS / 1000);
  }

  interactNearest(): void {
    this.sim?.interactNearest(this.player.playerId);
  }

  triggerEmote(): void {
    if (this.sim) {
      this.sim.triggerEmote(this.player.playerId);
    } else {
      this.onSimEvent?.({
        type: 'animal_emote',
        playerId: this.player.playerId,
        animalId: this.player.animalId,
      });
    }
  }

  pingStation(stationId: string): void {
    const accent = ANIMAL_BY_ID[this.player.animalId].accentColor;
    this.sim?.pingStation(this.player.name, accent, stationId);
  }

  resetSoloProgress(): void {
    this.stopSimLoop();
    this.trip = createFreshSoloTrip();
    this.vanStopId = 'sharon';
    this.screen = 'lobby';
    this.persistTrip();
    this.emitState();
  }

  /** Exposed for deterministic unit testing */
  getSimForTest(): KitchenSim | null {
    return this.sim;
  }

  dispose(): void {
    this.stopSimLoop();
  }
}
