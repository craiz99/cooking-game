import type http from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { ANIMAL_BY_ID } from '../shared/animals.js';
import type { AnimalId, RoomStatePayload, StopId } from '../shared/types.js';
import { KitchenSim } from './kitchenSim.js';
import { RoomManager } from './roomManager.js';
import { isOriginAllowed } from './security.js';
import type { TripStore } from './store.js';

const MAX_GLOBAL_SOCKETS = 24;
const MAX_EVENTS_PER_SEC = 45;
const SIM_TICK_MS = 50; // 20 Hz authoritative simulation

interface SocketMeta {
  token: string;
  playerId: string;
}

export function attachSocketServer(
  httpServer: http.Server,
  store: TripStore,
): { io: SocketIOServer; rooms: RoomManager; stopLoop: () => void } {
  const rooms = new RoomManager(store);
  const sims = new Map<string, KitchenSim>();
  const socketMeta = new Map<string, SocketMeta>();

  const io = new SocketIOServer(httpServer, {
    maxHttpBufferSize: 16_384, // 16 KB cap
    cors: {
      origin: (origin, callback) => {
        // Strict origin check also enforced on handshake headers below
        callback(null, origin ? true : true);
      },
      credentials: false,
    },
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      const host = req.headers.host;
      if (!isOriginAllowed(origin, host)) {
        callback('Cross-origin WebSocket connection rejected', false);
        return;
      }
      if (io.engine.clientsCount >= MAX_GLOBAL_SOCKETS) {
        callback('Server connection limit reached', false);
        return;
      }
      callback(null, true);
    },
  });

  function buildFullState(token: string): RoomStatePayload | null {
    const base = rooms.getRoomState(token);
    if (!base) return null;
    const sim = sims.get(token);
    return {
      ...base,
      kitchen: sim ? sim.getSnapshot() : null,
    };
  }

  function broadcastRoom(token: string): void {
    const state = buildFullState(token);
    if (state) {
      io.to(token).emit('room_state', state);
    }
  }

  // 20 Hz simulation loop for all active kitchens
  const interval = setInterval(() => {
    for (const [token, sim] of sims) {
      if (sim.status !== 'running') continue;
      const events = sim.tick(SIM_TICK_MS / 1000);
      io.to(token).emit('kitchen_snapshot', sim.getSnapshot());
      for (const ev of events) {
        io.to(token).emit('sim_event', ev);
        if (ev.type === 'shift_finished') {
          broadcastRoom(token);
        }
      }
    }
  }, SIM_TICK_MS);

  io.on('connection', (socket: Socket) => {
    // Per-socket sliding-window event flood protection
    let windowStart = Date.now();
    let eventCount = 0;

    socket.use((_packet, next) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        eventCount = 0;
      }
      eventCount += 1;
      if (eventCount > MAX_EVENTS_PER_SEC) {
        next(new Error('Rate limit exceeded'));
        return;
      }
      next();
    });

    socket.on(
      'join_trip',
      (
        payload: {
          token?: string;
          name?: string;
          playerId?: string;
          preferredAnimalId?: AnimalId;
          kidHelper?: boolean;
        },
        ack?: (res: unknown) => void,
      ) => {
        const token = typeof payload?.token === 'string' ? payload.token : '';
        const res = rooms.joinRoom(token, {
          socketId: socket.id,
          name: typeof payload?.name === 'string' ? payload.name : '',
          playerId: typeof payload?.playerId === 'string' ? payload.playerId : undefined,
          preferredAnimalId: payload?.preferredAnimalId,
          kidHelper: payload?.kidHelper,
        });

        if (!res.ok) {
          ack?.({ ok: false, error: res.error });
          return;
        }

        socketMeta.set(socket.id, { token, playerId: res.data.player.playerId });
        void socket.join(token);
        const fullState = buildFullState(token);
        ack?.({ ok: true, player: res.data.player, state: fullState });
        broadcastRoom(token);
      },
    );

    socket.on('select_animal', (payload: { animalId?: unknown }, ack?: (res: unknown) => void) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      const res = rooms.selectAnimal(meta.token, meta.playerId, payload?.animalId);
      if (!res.ok) {
        ack?.({ ok: false, error: res.error });
        return;
      }
      ack?.({ ok: true });
      broadcastRoom(meta.token);
    });

    socket.on('set_kid_helper', (payload: { enabled?: boolean }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      rooms.setKidHelper(meta.token, meta.playerId, Boolean(payload?.enabled));
      const sim = sims.get(meta.token);
      const chef = sim?.chefs.find((c) => c.playerId === meta.playerId);
      if (chef) chef.kidHelper = Boolean(payload?.enabled);
      broadcastRoom(meta.token);
    });

    socket.on('set_crew_locked', (payload: { locked?: boolean }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      rooms.setCrewLocked(meta.token, Boolean(payload?.locked));
      broadcastRoom(meta.token);
    });

    socket.on('set_pace', (payload: { pace?: unknown }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      rooms.setPace(meta.token, payload?.pace);
      broadcastRoom(meta.token);
    });

    socket.on('set_solo_ai_helper', (payload: { enabled?: boolean }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      rooms.setSoloAiHelper(meta.token, Boolean(payload?.enabled));
      broadcastRoom(meta.token);
    });

    socket.on('open_map', () => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      sims.delete(meta.token);
      rooms.setScreen(meta.token, 'map');
      broadcastRoom(meta.token);
    });

    socket.on('return_to_lobby', () => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      sims.delete(meta.token);
      rooms.setScreen(meta.token, 'lobby');
      broadcastRoom(meta.token);
    });

    socket.on('drive_van', (payload: { stopId?: unknown }, ack?: (res: unknown) => void) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      const res = rooms.driveVanToStop(meta.token, payload?.stopId);
      if (!res.ok) {
        ack?.({ ok: false, error: res.error });
        return;
      }
      ack?.({ ok: true });
      broadcastRoom(meta.token);
    });

    socket.on('start_shift', (payload?: { stopId?: StopId }, ack?: (res: unknown) => void) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      const state = rooms.getRoomState(meta.token);
      if (!state) return;

      const targetStop = payload?.stopId ?? state.vanStopId;
      if (!state.trip.unlockedStopIds.includes(targetStop)) {
        ack?.({ ok: false, error: 'Earn 1 star on the previous stop first!' });
        return;
      }

      const activePlayers = state.players.filter((p) => p.connected);
      const roster = activePlayers.length > 0 ? activePlayers : state.players;
      if (roster.length === 0) return;

      const sim = new KitchenSim({
        stopId: targetStop,
        pace: state.trip.pace,
        players: roster,
        soloAiHelper: roster.length === 1 && state.trip.soloAiHelper,
        onShiftComplete: (starsEarned) => {
          const saved = store.recordStopResult(meta.token, targetStop, starsEarned);
          return {
            unlockedNextStopId: saved?.unlockedNextStopId ?? null,
            newBestStars: saved?.newBestStars ?? false,
          };
        },
      });

      sims.set(meta.token, sim);
      rooms.driveVanToStop(meta.token, targetStop);
      rooms.setScreen(meta.token, 'kitchen');
      ack?.({ ok: true });
      broadcastRoom(meta.token);
    });

    socket.on('tap_station', (payload: { stationId?: string }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta || typeof payload?.stationId !== 'string') return;
      sims.get(meta.token)?.tapStation(meta.playerId, payload.stationId);
    });

    socket.on('tap_floor', (payload: { x?: number; y?: number }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta || typeof payload?.x !== 'number' || typeof payload?.y !== 'number') return;
      if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
      sims.get(meta.token)?.tapFloor(meta.playerId, payload.x, payload.y);
    });

    socket.on('move_dir', (payload: { dx?: number; dy?: number }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta || typeof payload?.dx !== 'number' || typeof payload?.dy !== 'number') return;
      if (!Number.isFinite(payload.dx) || !Number.isFinite(payload.dy)) return;
      sims.get(meta.token)?.moveByVector(meta.playerId, payload.dx, payload.dy, SIM_TICK_MS / 1000);
    });

    socket.on('interact_nearest', () => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      sims.get(meta.token)?.interactNearest(meta.playerId);
    });

    socket.on('trigger_emote', () => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      const sim = sims.get(meta.token);
      if (sim) {
        sim.triggerEmote(meta.playerId);
      } else {
        // Also allow silly animal emote preview right in the Lobby!
        const state = rooms.getRoomState(meta.token);
        const player = state?.players.find((p) => p.playerId === meta.playerId);
        if (player) {
          io.to(meta.token).emit('sim_event', {
            type: 'animal_emote',
            playerId: player.playerId,
            animalId: player.animalId,
          });
        }
      }
    });

    socket.on('ping_station', (payload: { stationId?: string }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta || typeof payload?.stationId !== 'string') return;
      const state = rooms.getRoomState(meta.token);
      const player = state?.players.find((p) => p.playerId === meta.playerId);
      if (!player) return;
      const accent = ANIMAL_BY_ID[player.animalId].accentColor;
      sims.get(meta.token)?.pingStation(player.name, accent, payload.stationId);
    });

    socket.on('disconnect', () => {
      socketMeta.delete(socket.id);
      const updated = rooms.disconnectSocket(socket.id);
      if (updated) {
        broadcastRoom(updated.token);
      }
    });
  });

  return {
    io,
    rooms,
    stopLoop: () => {
      clearInterval(interval);
      void io.close();
    },
  };
}
