import crypto from 'node:crypto';
import { ANIMALS, isValidAnimalId } from '../shared/animals.js';
import { isValidStopId } from '../shared/stops.js';
import type {
  AnimalId,
  GamePace,
  PlayerProfile,
  RoomStatePayload,
  ScreenMode,
  StopId,
  TripSave,
} from '../shared/types.js';
import type { TripStore } from './store.js';

export const MAX_PLAYERS_PER_ROOM = 3;
const SAFE_NAME_REGEX = /^[A-Za-z0-9 '._-]{1,16}$/;

export interface RoomContext {
  token: string;
  screen: ScreenMode;
  vanStopId: StopId;
  players: Map<string, PlayerProfile>; // keyed by playerId
  socketToPlayerId: Map<string, string>;
}

export interface JoinRequest {
  socketId: string;
  playerId?: string;
  name: string;
  preferredAnimalId?: AnimalId;
  kidHelper?: boolean;
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function sanitizePlayerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!SAFE_NAME_REGEX.test(trimmed)) return null;
  return trimmed;
}

export class RoomManager {
  private readonly rooms = new Map<string, RoomContext>();

  constructor(private readonly store: TripStore) {}

  getOrLoadRoom(token: string): { room: RoomContext; trip: TripSave } | null {
    const trip = this.store.getTrip(token);
    if (!trip) return null;

    let room = this.rooms.get(token);
    if (!room) {
      room = {
        token,
        screen: 'lobby',
        vanStopId: trip.currentStopId,
        players: new Map(),
        socketToPlayerId: new Map(),
      };
      this.rooms.set(token, room);
    }
    return { room, trip };
  }

  getRoomState(token: string): RoomStatePayload | null {
    const loaded = this.getOrLoadRoom(token);
    if (!loaded) return null;
    const { room, trip } = loaded;
    return {
      trip,
      screen: room.screen,
      players: Array.from(room.players.values()),
      vanStopId: room.vanStopId,
      kitchen: null,
    };
  }

  /**
   * Finds the first animal not currently owned by another player in the room.
   */
  private findUnclaimedAnimal(room: RoomContext, excludePlayerId?: string): AnimalId | null {
    const taken = new Set<AnimalId>();
    for (const player of room.players.values()) {
      if (player.playerId !== excludePlayerId) {
        taken.add(player.animalId);
      }
    }
    for (const animal of ANIMALS) {
      if (!taken.has(animal.id)) {
        return animal.id;
      }
    }
    return null;
  }

  private getAnimalOwner(room: RoomContext, animalId: AnimalId, excludePlayerId?: string): PlayerProfile | null {
    for (const player of room.players.values()) {
      if (player.playerId !== excludePlayerId && player.animalId === animalId) {
        return player;
      }
    }
    return null;
  }

  joinRoom(token: string, req: JoinRequest): ActionResult<{ player: PlayerProfile; state: RoomStatePayload }> {
    const loaded = this.getOrLoadRoom(token);
    if (!loaded) {
      return { ok: false, error: 'Road trip link not found. Please check your invite link.' };
    }
    const { room, trip } = loaded;

    const cleanName = sanitizePlayerName(req.name);
    if (!cleanName) {
      return {
        ok: false,
        error: 'Please enter a name (1-16 letters, numbers, or spaces).',
      };
    }

    // Check for existing player reconnecting by playerId or disconnected same-name player
    let existing: PlayerProfile | undefined;
    if (req.playerId && room.players.has(req.playerId)) {
      existing = room.players.get(req.playerId);
    } else {
      for (const p of room.players.values()) {
        if (!p.connected && p.name.toLowerCase() === cleanName.toLowerCase()) {
          existing = p;
          break;
        }
      }
    }

    if (existing) {
      // Remove any stale socket mapping for this player
      for (const [sid, pid] of room.socketToPlayerId) {
        if (pid === existing.playerId) room.socketToPlayerId.delete(sid);
      }
      existing.name = cleanName;
      existing.connected = true;
      if (typeof req.kidHelper === 'boolean') {
        existing.kidHelper = req.kidHelper;
      }
      room.socketToPlayerId.set(req.socketId, existing.playerId);
      const state = this.getRoomState(token)!;
      return { ok: true, data: { player: existing, state } };
    }

    // Enforce Crew Lock for new joiners
    if (trip.crewLocked) {
      const allowed = trip.lockedNames.some(
        (n) => n.toLowerCase() === cleanName.toLowerCase(),
      );
      if (!allowed) {
        return {
          ok: false,
          error: 'This family purple van is locked! Ask the host to unlock the crew.',
        };
      }
    }

    // Enforce max 3 players per room
    if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
      return {
        ok: false,
        error: 'This purple van already has 3 chefs! Max 3 players per trip.',
      };
    }

    // Guarantee unique animal assignment (never duplicates!)
    let assignedAnimal: AnimalId | null = null;
    if (req.preferredAnimalId && isValidAnimalId(req.preferredAnimalId)) {
      if (!this.getAnimalOwner(room, req.preferredAnimalId)) {
        assignedAnimal = req.preferredAnimalId;
      }
    }
    if (!assignedAnimal) {
      assignedAnimal = this.findUnclaimedAnimal(room);
    }
    if (!assignedAnimal) {
      return { ok: false, error: 'No animal chefs left to pick.' };
    }

    const playerId = crypto.randomBytes(8).toString('hex');
    const player: PlayerProfile = {
      playerId,
      name: cleanName,
      animalId: assignedAnimal,
      kidHelper: Boolean(req.kidHelper),
      connected: true,
    };

    room.players.set(playerId, player);
    room.socketToPlayerId.set(req.socketId, playerId);

    // If a 2nd player joins a solo trip, automatically upgrade it to cooperative mode
    if (room.players.size > 1 && trip.soloMode) {
      trip.soloMode = false;
      this.store.saveTrip(trip);
    }

    const state = this.getRoomState(token)!;
    return { ok: true, data: { player, state } };
  }

  disconnectSocket(socketId: string): { token: string; state: RoomStatePayload } | null {
    for (const [token, room] of this.rooms) {
      const playerId = room.socketToPlayerId.get(socketId);
      if (!playerId) continue;
      room.socketToPlayerId.delete(socketId);
      const player = room.players.get(playerId);
      if (player) {
        player.connected = false;
      }
      const state = this.getRoomState(token);
      return state ? { token, state } : null;
    }
    return null;
  }

  selectAnimal(token: string, playerId: string, animalId: unknown): ActionResult<RoomStatePayload> {
    if (!isValidAnimalId(animalId)) {
      return { ok: false, error: 'Unknown animal chef.' };
    }
    const loaded = this.getOrLoadRoom(token);
    if (!loaded) return { ok: false, error: 'Trip not found.' };
    const { room } = loaded;
    const player = room.players.get(playerId);
    if (!player) return { ok: false, error: 'Player not in room.' };

    const owner = this.getAnimalOwner(room, animalId, playerId);
    if (owner) {
      return {
        ok: false,
        error: `${owner.name} already picked that animal! Pick another one.`,
      };
    }

    player.animalId = animalId;
    return { ok: true, data: this.getRoomState(token)! };
  }

  setKidHelper(token: string, playerId: string, enabled: boolean): ActionResult<RoomStatePayload> {
    const loaded = this.getOrLoadRoom(token);
    if (!loaded) return { ok: false, error: 'Trip not found.' };
    const player = loaded.room.players.get(playerId);
    if (!player) return { ok: false, error: 'Player not in room.' };
    player.kidHelper = Boolean(enabled);
    return { ok: true, data: this.getRoomState(token)! };
  }

  setCrewLocked(token: string, locked: boolean): ActionResult<RoomStatePayload> {
    const loaded = this.getOrLoadRoom(token);
    if (!loaded) return { ok: false, error: 'Trip not found.' };
    const { room, trip } = loaded;
    trip.crewLocked = Boolean(locked);
    trip.lockedNames = locked
      ? Array.from(room.players.values()).map((p) => p.name)
      : [];
    this.store.saveTrip(trip);
    return { ok: true, data: this.getRoomState(token)! };
  }

  setPace(token: string, pace: unknown): ActionResult<RoomStatePayload> {
    if (pace !== 'cozy' && pace !== 'rush') {
      return { ok: false, error: 'Invalid game pace.' };
    }
    const loaded = this.getOrLoadRoom(token);
    if (!loaded) return { ok: false, error: 'Trip not found.' };
    loaded.trip.pace = pace;
    this.store.saveTrip(loaded.trip);
    return { ok: true, data: this.getRoomState(token)! };
  }

  setSoloAiHelper(token: string, enabled: boolean): ActionResult<RoomStatePayload> {
    const loaded = this.getOrLoadRoom(token);
    if (!loaded) return { ok: false, error: 'Trip not found.' };
    loaded.trip.soloAiHelper = Boolean(enabled);
    this.store.saveTrip(loaded.trip);
    return { ok: true, data: this.getRoomState(token)! };
  }

  setScreen(token: string, screen: ScreenMode): ActionResult<RoomStatePayload> {
    const loaded = this.getOrLoadRoom(token);
    if (!loaded) return { ok: false, error: 'Trip not found.' };
    loaded.room.screen = screen;
    return { ok: true, data: this.getRoomState(token)! };
  }

  driveVanToStop(token: string, stopId: unknown): ActionResult<RoomStatePayload> {
    if (!isValidStopId(stopId)) {
      return { ok: false, error: 'Unknown road trip stop.' };
    }
    const loaded = this.getOrLoadRoom(token);
    if (!loaded) return { ok: false, error: 'Trip not found.' };
    const { room, trip } = loaded;

    if (!trip.unlockedStopIds.includes(stopId)) {
      return {
        ok: false,
        error: 'Earn at least 1 star on the previous stop to unlock this destination!',
      };
    }

    room.vanStopId = stopId;
    trip.currentStopId = stopId;
    this.store.saveTrip(trip);
    return { ok: true, data: this.getRoomState(token)! };
  }
}
