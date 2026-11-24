import { io, type Socket } from 'socket.io-client';
import type {
  AnimalId,
  GamePace,
  KitchenSnapshot,
  PlayerProfile,
  RoomStatePayload,
  StopId,
} from '@shared/types';

export interface SimEventPayload {
  type: 'dish_served' | 'cook_done' | 'combined' | 'animal_emote' | 'shift_finished' | 'ping';
  playerId?: string;
  animalId?: AnimalId;
  recipeId?: string;
  x?: number;
  y?: number;
}

export interface StoredDeviceProfile {
  name: string;
  playerId?: string;
  preferredAnimalId?: AnimalId;
  kidHelper: boolean;
}

const STORAGE_KEY = 'purple_van_profile_v1';

export function loadDeviceProfile(): StoredDeviceProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredDeviceProfile>;
      return {
        name: typeof parsed.name === 'string' ? parsed.name : '',
        playerId: typeof parsed.playerId === 'string' ? parsed.playerId : undefined,
        preferredAnimalId: parsed.preferredAnimalId,
        kidHelper: typeof parsed.kidHelper === 'boolean' ? parsed.kidHelper : true,
      };
    }
  } catch {
    // ignore storage errors
  }
  return { name: '', kidHelper: true };
}

export function saveDeviceProfile(profile: StoredDeviceProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // ignore storage errors
  }
}

export class GameSocketClient {
  private socket: Socket | null = null;
  onRoomState?: (state: RoomStatePayload) => void;
  onKitchenSnapshot?: (snap: KitchenSnapshot) => void;
  onSimEvent?: (ev: SimEventPayload) => void;
  onDisconnect?: () => void;

  connect(): Socket {
    if (this.socket) return this.socket;
    this.socket = io({
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 20,
      reconnectionDelay: 600,
    });
    this.socket.on('room_state', (state: RoomStatePayload) => this.onRoomState?.(state));
    this.socket.on('kitchen_snapshot', (snap: KitchenSnapshot) => this.onKitchenSnapshot?.(snap));
    this.socket.on('sim_event', (ev: SimEventPayload) => this.onSimEvent?.(ev));
    this.socket.on('disconnect', () => this.onDisconnect?.());
    return this.socket;
  }

  joinTrip(params: {
    token: string;
    name: string;
    playerId?: string;
    preferredAnimalId?: AnimalId;
    kidHelper: boolean;
  }): Promise<{ ok: true; player: PlayerProfile; state: RoomStatePayload } | { ok: false; error: string }> {
    const sock = this.connect();
    return new Promise((resolve) => {
      sock.emit(
        'join_trip',
        params,
        (res: { ok: boolean; player?: PlayerProfile; state?: RoomStatePayload; error?: string }) => {
          if (res?.ok && res.player && res.state) {
            resolve({ ok: true, player: res.player, state: res.state });
          } else {
            resolve({ ok: false, error: res?.error ?? 'Unable to join road trip.' });
          }
        },
      );
    });
  }

  selectAnimal(animalId: AnimalId): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      this.connect().emit('select_animal', { animalId }, (res: { ok: boolean; error?: string }) => {
        resolve(res ?? { ok: false, error: 'Failed to pick animal.' });
      });
    });
  }

  setKidHelper(enabled: boolean): void {
    this.connect().emit('set_kid_helper', { enabled });
  }

  setCrewLocked(locked: boolean): void {
    this.connect().emit('set_crew_locked', { locked });
  }

  setPace(pace: GamePace): void {
    this.connect().emit('set_pace', { pace });
  }

  setSoloAiHelper(enabled: boolean): void {
    this.connect().emit('set_solo_ai_helper', { enabled });
  }

  openMap(): void {
    this.connect().emit('open_map');
  }

  returnToLobby(): void {
    this.connect().emit('return_to_lobby');
  }

  driveVan(stopId: StopId): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      this.connect().emit('drive_van', { stopId }, (res: { ok: boolean; error?: string }) => {
        resolve(res ?? { ok: false });
      });
    });
  }

  startShift(stopId?: StopId): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      this.connect().emit('start_shift', { stopId }, (res: { ok: boolean; error?: string }) => {
        resolve(res ?? { ok: false });
      });
    });
  }

  tapStation(stationId: string): void {
    this.connect().emit('tap_station', { stationId });
  }

  tapFloor(x: number, y: number): void {
    this.connect().emit('tap_floor', { x, y });
  }

  moveDir(dx: number, dy: number): void {
    this.connect().emit('move_dir', { dx, dy });
  }

  interactNearest(): void {
    this.connect().emit('interact_nearest');
  }

  triggerEmote(): void {
    this.connect().emit('trigger_emote');
  }

  pingStation(stationId: string): void {
    this.connect().emit('ping_station', { stationId });
  }
}
