import { ANIMALS, ANIMAL_BY_ID, INGREDIENT_BY_ID } from './animals.js';
import {
  RECIPE_BY_ID,
  STOP_BY_ID,
  computeDishPoints,
  computeStarsEarned,
  getStarTargets,
} from './stops.js';
import type {
  AnimalId,
  ChefEntity,
  GamePace,
  HeldItem,
  KitchenSnapshot,
  OrderTicket,
  PingBeacon,
  PlayerProfile,
  RecipeDef,
  ShiftResult,
  StationState,
  StopId,
} from './types.js';

function randomHexId(): string {
  const bytes = new Uint8Array(4);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface SimEvent {
  type: 'dish_served' | 'cook_done' | 'combined' | 'animal_emote' | 'shift_started' | 'shift_finished' | 'ping';
  playerId?: string;
  animalId?: AnimalId;
  recipeId?: string;
  pointsAwarded?: number;
  x?: number;
  y?: number;
  result?: ShiftResult;
}

export interface KitchenSimOptions {
  stopId: StopId;
  pace: GamePace;
  players: PlayerProfile[];
  soloAiHelper: boolean;
  nowMs?: number;
  previewSeconds?: number;
  onShiftComplete?: (
    starsEarned: 0 | 1 | 2 | 3,
    servedCount: number,
    shiftScore: number,
  ) => {
    unlockedNextStopId: StopId | null;
    newBestStars: boolean;
  };
}

export const DEFAULT_PREVIEW_SECONDS = 6;

const GRID_MIN_X = 1.65;
const GRID_MAX_X = 7.95;
const GRID_MIN_Y = 1.85;
const GRID_MAX_Y = 4.95;
const CHEF_SPEED = 4.2; // grid units / sec
const AI_CHEF_SPEED = 3.45; // calmer ~82% speed so helper never crowds the player
const AI_REST_POS = { x: 2.05, y: 4.85 }; // out-of-the-way corner perch when idle
const AI_THINK_COOLDOWN_MS = 1100;
const AI_COOK_STATION_GRACE_MS = 1800;
const AI_COUNTER_GRACE_MS = 1000;
const AI_PLATED_STATION_GRACE_MS = 2200;
const INTERACT_RANGE = 1.55;

export class KitchenSim {
  readonly stopId: StopId;
  readonly pace: GamePace;
  status: 'preview' | 'running' | 'finished' = 'preview';
  previewRemainingSec: number;
  timeRemainingSec: number;
  servedCount = 0;
  score = 0;
  readonly targets;
  readonly chefs: ChefEntity[] = [];
  readonly stations: StationState[] = [];
  readonly orders: OrderTicket[] = [];
  ping: PingBeacon | null = null;
  result: ShiftResult | null = null;

  private nowMs: number;
  private lastOrderSpawnMs: number;
  private aiThinkCooldownMs = 0;
  private readonly onShiftComplete?: KitchenSimOptions['onShiftComplete'];
  private readonly pendingEvents: SimEvent[] = [];

  constructor(options: KitchenSimOptions) {
    this.stopId = options.stopId;
    this.pace = options.pace;
    this.nowMs = options.nowMs ?? Date.now();
    this.lastOrderSpawnMs = this.nowMs;
    this.onShiftComplete = options.onShiftComplete;

    const previewSec = Math.max(0, options.previewSeconds ?? DEFAULT_PREVIEW_SECONDS);
    this.previewRemainingSec = previewSec;
    this.status = previewSec > 0 ? 'preview' : 'running';

    const humanPlayers = options.players.filter((p) => !p.isAi);
    const humanCount = Math.max(1, humanPlayers.length);
    this.targets = getStarTargets(this.stopId, humanCount, this.pace);
    this.timeRemainingSec = this.targets.shiftSeconds;

    this.buildStations();
    this.spawnChefs(humanPlayers, options.soloAiHelper);

    // Seed 3 friendly initial orders from this stop's fixed regional menu
    for (let i = 0; i < 3; i++) {
      this.spawnOrder(i);
    }
  }

  skipPreview(): void {
    if (this.status !== 'preview') return;
    this.previewRemainingSec = 0;
    this.status = 'running';
    this.pendingEvents.push({ type: 'shift_started' });
  }

  private buildStations(): void {
    const stop = STOP_BY_ID[this.stopId];

    // Left wall + bottom-left crates (4 to 6 crates neatly spaced along perimeter)
    const crateCoords: Array<{ x: number; y: number }> = [
      { x: 0.9, y: 1.5 },
      { x: 0.9, y: 2.7 },
      { x: 0.9, y: 3.9 },
      { x: 0.9, y: 5.1 },
      { x: 2.5, y: 5.35 },
      { x: 4.1, y: 5.35 },
    ];

    stop.crates.forEach((ingId, idx) => {
      const pos = crateCoords[idx] ?? { x: 0.9 + idx, y: 5.35 };
      const ing = INGREDIENT_BY_ID[ingId];
      this.stations.push({
        id: `crate_${ingId}`,
        kind: 'crate',
        label: ing.shortName,
        gridX: pos.x,
        gridY: pos.y,
        ingredientId: ingId,
        item: null,
        cookProgress: 0,
        cookingActive: false,
      });
    });

    // Top kitchen workline: Prep Board, Boiling Pot, Grill/Fryer
    this.stations.push(
      {
        id: 'prep_board',
        kind: 'prep_board',
        label: 'Prep Board',
        gridX: 3.1,
        gridY: 1.15,
        item: null,
        cookProgress: 0,
        cookingActive: false,
      },
      {
        id: 'stove_pot',
        kind: 'stove_pot',
        label: 'Boiling Pot',
        gridX: 4.9,
        gridY: 1.15,
        item: null,
        cookProgress: 0,
        cookingActive: false,
      },
      {
        id: 'grill_fryer',
        kind: 'grill_fryer',
        label: 'Grill & Fryer',
        gridX: 6.7,
        gridY: 1.15,
        item: null,
        cookProgress: 0,
        cookingActive: false,
      },
    );

    // Center Pass-Through Island (2 shared counters so teammates pass & top dishes easily!)
    this.stations.push(
      {
        id: 'counter_a',
        kind: 'counter',
        label: 'Pass Counter',
        gridX: 4.2,
        gridY: 3.35,
        item: null,
        cookProgress: 0,
        cookingActive: false,
      },
      {
        id: 'counter_b',
        kind: 'counter',
        label: 'Plating Counter',
        gridX: 5.7,
        gridY: 3.35,
        item: null,
        cookProgress: 0,
        cookingActive: false,
      },
    );

    // Right side: Purple Van Glowing Serving Window + Tidy Bin
    this.stations.push(
      {
        id: 'serve_window',
        kind: 'serve_window',
        label: 'Serve Window',
        gridX: 8.85,
        gridY: 2.55,
        item: null,
        cookProgress: 0,
        cookingActive: false,
      },
      {
        id: 'trash_bin',
        kind: 'trash',
        label: 'Compost Bin',
        gridX: 8.85,
        gridY: 4.75,
        item: null,
        cookProgress: 0,
        cookingActive: false,
      },
    );
  }

  private spawnChefs(players: PlayerProfile[], soloAiHelper: boolean): void {
    const spawns = [
      { x: 3.2, y: 2.4 },
      { x: 5.0, y: 4.35 },
      { x: 6.7, y: 2.5 },
    ];

    players.forEach((p, idx) => {
      const sp = spawns[idx] ?? { x: 4.8, y: 2.4 };
      this.chefs.push({
        playerId: p.playerId,
        name: p.name,
        animalId: p.animalId,
        kidHelper: p.kidHelper,
        x: sp.x,
        y: sp.y,
        facing: 'right',
        moving: false,
        holding: null,
        emoteUntilMs: 0,
        path: [],
        pendingStationId: null,
      });
    });

    // Optional Solo Mode friendly AI Sous-Chef using an UNCLAIMED animal (no duplicates!)
    if (players.length === 1 && soloAiHelper) {
      const taken = new Set(players.map((p) => p.animalId));
      const freeAnimal = ANIMALS.find((a) => !taken.has(a.id)) ?? ANIMALS[2]!;
      this.chefs.push({
        playerId: 'ai_helper',
        name: `${freeAnimal.shortName} Helper`,
        animalId: freeAnimal.id,
        kidHelper: false,
        isAi: true,
        x: AI_REST_POS.x,
        y: AI_REST_POS.y,
        facing: 'right',
        moving: false,
        holding: null,
        emoteUntilMs: 0,
        path: [],
        pendingStationId: null,
      });
    }
  }

  private spawnOrder(seedIdx?: number): void {
    const stop = STOP_BY_ID[this.stopId];
    const recipe =
      seedIdx !== undefined
        ? stop.recipes[seedIdx % stop.recipes.length]!
        : stop.recipes[Math.floor(Math.random() * stop.recipes.length)]!;

    const patienceSec = this.pace === 'cozy' ? 75 : 50;
    this.orders.push({
      id: randomHexId(),
      recipeId: recipe.id,
      createdAtMs: this.nowMs,
      patienceSec,
      remainingSec: patienceSec,
    });
  }

  /**
   * Computes a smooth walkable waypoint around the center island so chefs never snag on counters.
   */
  private buildWalkPath(fromX: number, fromY: number, toX: number, toY: number): Array<{ x: number; y: number }> {
    const tx = Math.max(GRID_MIN_X, Math.min(GRID_MAX_X, toX));
    const ty = Math.max(GRID_MIN_Y, Math.min(GRID_MAX_Y, toY));

    // Center island occupies roughly x=[3.5..6.4], y=[2.9..3.85]
    const crossesIsland =
      ((fromY < 2.95 && ty > 3.8) || (fromY > 3.8 && ty < 2.95)) &&
      fromX > 3.1 &&
      fromX < 6.8 &&
      tx > 3.1 &&
      tx < 6.8;

    if (crossesIsland) {
      const detourX = (fromX + tx) / 2 < 4.95 ? 2.65 : 7.15;
      return [
        { x: detourX, y: fromY },
        { x: detourX, y: ty },
        { x: tx, y: ty },
      ];
    }
    return [{ x: tx, y: ty }];
  }

  private getStandPointForStation(st: StationState): { x: number; y: number } {
    if (st.gridX <= 1.3) return { x: 1.95, y: Math.max(GRID_MIN_Y, Math.min(GRID_MAX_Y, st.gridY)) };
    if (st.gridX >= 8.3) return { x: 7.75, y: Math.max(GRID_MIN_Y, Math.min(GRID_MAX_Y, st.gridY)) };
    if (st.gridY <= 1.5) return { x: st.gridX, y: 2.0 };
    if (st.gridY >= 5.0) return { x: st.gridX, y: 4.6 };
    // Center island counters
    return { x: st.gridX, y: 2.55 };
  }

  tapStation(playerId: string, stationId: string): void {
    if (this.status !== 'running') return;
    const chef = this.chefs.find((c) => c.playerId === playerId);
    const st = this.stations.find((s) => s.id === stationId);
    if (!chef || !st) return;

    const dist = Math.hypot(chef.x - st.gridX, chef.y - st.gridY);
    if (dist <= INTERACT_RANGE) {
      chef.path = [];
      chef.pendingStationId = null;
      this.interactWithStation(chef, st);
      return;
    }

    const stand = this.getStandPointForStation(st);
    chef.path = this.buildWalkPath(chef.x, chef.y, stand.x, stand.y);
    chef.pendingStationId = st.id;
  }

  tapFloor(playerId: string, gridX: number, gridY: number): void {
    if (this.status !== 'running') return;
    const chef = this.chefs.find((c) => c.playerId === playerId);
    if (!chef) return;
    chef.pendingStationId = null;
    chef.path = this.buildWalkPath(chef.x, chef.y, gridX, gridY);
  }

  moveByVector(playerId: string, dx: number, dy: number, dtSec: number): void {
    if (this.status !== 'running') return;
    const chef = this.chefs.find((c) => c.playerId === playerId);
    if (!chef) return;

    const len = Math.hypot(dx, dy);
    if (len < 0.01) {
      chef.moving = false;
      return;
    }

    chef.path = [];
    chef.pendingStationId = null;
    const nx = chef.x + (dx / len) * CHEF_SPEED * dtSec;
    const ny = chef.y + (dy / len) * CHEF_SPEED * dtSec;
    this.applySafeMove(chef, nx, ny);
  }

  interactNearest(playerId: string): void {
    if (this.status !== 'running') return;
    const chef = this.chefs.find((c) => c.playerId === playerId);
    if (!chef) return;

    let best: StationState | null = null;
    let bestDist = INTERACT_RANGE + 0.35;
    for (const st of this.stations) {
      const d = Math.hypot(chef.x - st.gridX, chef.y - st.gridY);
      if (d < bestDist) {
        bestDist = d;
        best = st;
      }
    }
    if (best) {
      this.interactWithStation(chef, best);
    }
  }

  triggerEmote(playerId: string): void {
    const chef = this.chefs.find((c) => c.playerId === playerId);
    if (!chef) return;
    const animal = ANIMAL_BY_ID[chef.animalId];
    chef.emoteUntilMs = this.nowMs + animal.emoteDurationMs;
    this.pendingEvents.push({
      type: 'animal_emote',
      playerId: chef.playerId,
      animalId: chef.animalId,
      x: chef.x,
      y: chef.y,
    });
  }

  pingStation(fromPlayerName: string, accentColor: string, stationId: string): void {
    const st = this.stations.find((s) => s.id === stationId);
    if (!st) return;
    this.ping = {
      stationId: st.id,
      fromPlayerName,
      accentColor,
      expiresAtMs: this.nowMs + 7000,
    };
    this.pendingEvents.push({
      type: 'ping',
      x: st.gridX,
      y: st.gridY,
    });
  }

  private applySafeMove(chef: ChefEntity, nextX: number, nextY: number): void {
    const clampedX = Math.max(GRID_MIN_X, Math.min(GRID_MAX_X, nextX));
    const clampedY = Math.max(GRID_MIN_Y, Math.min(GRID_MAX_Y, nextY));

    // Keep out of center island hitbox: x=[3.65..6.25], y=[2.98..3.72]
    const hitsIsland =
      clampedX > 3.65 && clampedX < 6.25 && clampedY > 2.98 && clampedY < 3.72;

    if (!hitsIsland) {
      if (Math.abs(clampedX - chef.x) > 0.01) {
        chef.facing = clampedX < chef.x ? 'left' : 'right';
      }
      chef.x = clampedX;
      chef.y = clampedY;
      chef.moving = true;
    }
  }

  private tryCombine(a: HeldItem, b: HeldItem): HeldItem | null {
    const stop = STOP_BY_ID[this.stopId];
    const check = (cooked: HeldItem, raw: HeldItem): HeldItem | null => {
      if (cooked.kind !== 'cooked' || raw.kind !== 'raw') return null;
      const match = stop.recipes.find(
        (r) =>
          r.baseIngredient === cooked.ingredientId &&
          r.cookStation === cooked.cookStation &&
          r.toppingIngredient === raw.ingredientId,
      );
      if (!match) return null;
      return { kind: 'plated', recipeId: match.id };
    };
    return check(a, b) ?? check(b, a);
  }

  private findRecipeStartingAt(ingredientId: string, cookStation: StationState['kind']): RecipeDef | null {
    const stop = STOP_BY_ID[this.stopId];
    return (
      stop.recipes.find((r) => r.baseIngredient === ingredientId && r.cookStation === cookStation) ??
      null
    );
  }

  interactWithStation(chef: ChefEntity, st: StationState): void {
    // 1) Ingredient Crate
    if (st.kind === 'crate' && st.ingredientId) {
      if (!chef.holding) {
        chef.holding = { kind: 'raw', ingredientId: st.ingredientId };
      }
      return;
    }

    // 2) Compost / Trash Bin (clear mistakes easily)
    if (st.kind === 'trash') {
      chef.holding = null;
      return;
    }

    // 3) Serving Window on the Purple Van!
    if (st.kind === 'serve_window') {
      if (chef.holding?.kind === 'plated' && chef.holding.recipeId) {
        const orderIdx = this.orders.findIndex((o) => o.recipeId === chef.holding?.recipeId);
        if (orderIdx >= 0) {
          const servedOrder = this.orders[orderIdx]!;
          const servedRecipeId = chef.holding.recipeId;
          const recipe = RECIPE_BY_ID[servedRecipeId];
          const pointsAwarded = recipe
            ? computeDishPoints(recipe, servedOrder.remainingSec, servedOrder.patienceSec)
            : 100;
          this.orders.splice(orderIdx, 1);
          this.servedCount += 1;
          this.score += pointsAwarded;
          chef.holding = null;
          this.spawnOrder();
          this.pendingEvents.push({
            type: 'dish_served',
            playerId: chef.playerId,
            recipeId: servedRecipeId,
            pointsAwarded,
            x: st.gridX,
            y: st.gridY,
          });
        }
      }
      return;
    }

    // 4) Cooking / Prep Station (prep_board, stove_pot, grill_fryer)
    if (st.kind === 'prep_board' || st.kind === 'stove_pot' || st.kind === 'grill_fryer') {
      // Combine held topping directly onto finished cooked item sitting on the station!
      if (chef.holding && st.item && !st.cookingActive) {
        const combined = this.tryCombine(chef.holding, st.item);
        if (combined) {
          st.item = null;
          st.cookProgress = 0;
          st.itemReadySinceMs = undefined;
          chef.holding = combined;
          this.pendingEvents.push({ type: 'combined', playerId: chef.playerId, x: st.gridX, y: st.gridY });
          return;
        }
      }

      // Pick up finished cooked or plated item with empty hands
      if (!chef.holding && st.item && !st.cookingActive) {
        chef.holding = st.item;
        st.item = null;
        st.cookProgress = 0;
        st.itemReadySinceMs = undefined;
        return;
      }

      // Place matching raw base ingredient into empty station to start cooking/prepping!
      if (chef.holding?.kind === 'raw' && chef.holding.ingredientId && !st.item) {
        const recipe = this.findRecipeStartingAt(chef.holding.ingredientId, st.kind);
        if (recipe) {
          st.item = chef.holding;
          st.cookProgress = 0;
          st.cookingActive = true;
          st.itemReadySinceMs = undefined;
          chef.holding = null;
        }
      }
      return;
    }

    // 5) Shared Pass / Plating Counter
    if (st.kind === 'counter') {
      if (chef.holding && st.item) {
        const combined = this.tryCombine(chef.holding, st.item);
        if (combined) {
          st.item = null;
          st.itemReadySinceMs = undefined;
          chef.holding = combined;
          this.pendingEvents.push({ type: 'combined', playerId: chef.playerId, x: st.gridX, y: st.gridY });
        }
        return;
      }
      if (chef.holding && !st.item) {
        st.item = chef.holding;
        st.itemReadySinceMs = this.nowMs;
        chef.holding = null;
        return;
      }
      if (!chef.holding && st.item) {
        chef.holding = st.item;
        st.item = null;
        st.itemReadySinceMs = undefined;
      }
    }
  }

  /**
   * Advances the kitchen simulation by dtSec seconds and returns any new visual/audio events.
   */
  tick(dtSec: number): SimEvent[] {
    this.nowMs += Math.round(dtSec * 1000);
    if (this.status === 'preview') {
      this.previewRemainingSec = Math.max(0, this.previewRemainingSec - dtSec);
      if (this.previewRemainingSec <= 1e-6) {
        this.previewRemainingSec = 0;
        this.status = 'running';
        this.pendingEvents.push({ type: 'shift_started' });
      }
      return this.flushEvents();
    }
    if (this.status !== 'running') {
      return this.flushEvents();
    }

    // Expire old pings
    if (this.ping && this.ping.expiresAtMs <= this.nowMs) {
      this.ping = null;
    }

    // Shift countdown timer
    this.timeRemainingSec = Math.max(0, this.timeRemainingSec - dtSec);
    if (this.timeRemainingSec <= 0) {
      this.finishShift();
      return this.flushEvents();
    }

    // Gentle order patience ticking (Cozy Cruise refreshes cleanly without harsh penalties)
    for (let i = this.orders.length - 1; i >= 0; i--) {
      const order = this.orders[i]!;
      order.remainingSec -= dtSec;
      if (order.remainingSec <= 0) {
        this.orders.splice(i, 1);
        this.spawnOrder();
      }
    }
    while (this.orders.length < 3 && this.nowMs - this.lastOrderSpawnMs > 2500) {
      this.spawnOrder();
      this.lastOrderSpawnMs = this.nowMs;
    }

    // Advance cooking/prepping timers (Cozy Cruise never burns!)
    for (const st of this.stations) {
      if (!st.cookingActive || !st.item || st.item.kind !== 'raw' || !st.item.ingredientId) {
        continue;
      }
      const recipe = this.findRecipeStartingAt(st.item.ingredientId, st.kind);
      const duration = recipe?.cookSeconds ?? 2.0;
      st.cookProgress = Math.min(1, st.cookProgress + dtSec / duration);
      if (st.cookProgress >= 1) {
        st.cookingActive = false;
        if (recipe && !recipe.toppingIngredient) {
          // Single-ingredient dish (e.g. Sharon Crispy Seaweed Pack) plates immediately!
          st.item = { kind: 'plated', recipeId: recipe.id };
        } else if (st.kind === 'prep_board' || st.kind === 'stove_pot' || st.kind === 'grill_fryer') {
          st.item = {
            kind: 'cooked',
            ingredientId: st.item.ingredientId,
            cookStation: st.kind,
          };
        }
        st.itemReadySinceMs = this.nowMs;
        this.pendingEvents.push({ type: 'cook_done', x: st.gridX, y: st.gridY });
      }
    }

    // Optional Solo AI Helper brain (calm, non-intrusive: only finishes player-started dishes!)
    this.updateSoloAiHelper(dtSec);

    // Move chefs along their tap-to-walk paths
    for (const chef of this.chefs) {
      if (chef.path.length === 0) {
        chef.moving = false;
        continue;
      }
      const target = chef.path[0]!;
      const dx = target.x - chef.x;
      const dy = target.y - chef.y;
      const dist = Math.hypot(dx, dy);
      const step = (chef.isAi ? AI_CHEF_SPEED : CHEF_SPEED) * dtSec;
      if (dist <= step) {
        chef.x = target.x;
        chef.y = target.y;
        chef.path.shift();
        if (chef.path.length === 0) {
          chef.moving = false;
          if (chef.pendingStationId) {
            const st = this.stations.find((s) => s.id === chef.pendingStationId);
            chef.pendingStationId = null;
            if (st) this.interactWithStation(chef, st);
          }
        }
      } else {
        if (Math.abs(dx) > 0.01) chef.facing = dx < 0 ? 'left' : 'right';
        chef.x += (dx / dist) * step;
        chef.y += (dy / dist) * step;
        chef.moving = true;
      }
    }

    return this.flushEvents();
  }

  private isHumanHandlingStation(human: ChefEntity | undefined, st: StationState): boolean {
    if (!human) return false;
    if (human.pendingStationId === st.id) return true;
    return Math.hypot(human.x - st.gridX, human.y - st.gridY) <= 1.6;
  }

  private findRecipeForCookedItem(item: HeldItem): RecipeDef | null {
    if (item.kind !== 'cooked' || !item.ingredientId || !item.cookStation) return null;
    const stop = STOP_BY_ID[this.stopId];
    const activeIds = new Set(this.orders.map((o) => o.recipeId));
    return (
      stop.recipes.find(
        (r) =>
          activeIds.has(r.id) &&
          r.baseIngredient === item.ingredientId &&
          r.cookStation === item.cookStation &&
          r.toppingIngredient,
      ) ??
      stop.recipes.find(
        (r) =>
          r.baseIngredient === item.ingredientId &&
          r.cookStation === item.cookStation &&
          r.toppingIngredient,
      ) ??
      null
    );
  }

  /**
   * Calm, player-first AI Sous-Chef:
   * - NEVER starts untouched orders from crates on its own.
   * - Parks neatly out of the way when idle.
   * - Steps in after a polite grace period ONLY to help finish dishes the player has started
   *   (adding missing toppings, cooking bases handed off on counters, or serving finished plates).
   */
  private updateSoloAiHelper(dtSec: number): void {
    const ai = this.chefs.find((c) => c.isAi);
    if (!ai || ai.path.length > 0) return;

    this.aiThinkCooldownMs -= dtSec * 1000;
    if (this.aiThinkCooldownMs > 0) return;
    this.aiThinkCooldownMs = AI_THINK_COOLDOWN_MS;

    const human = this.chefs.find((c) => !c.isAi);
    const activeRecipeIds = new Set(this.orders.map((o) => o.recipeId));

    // 1) Holding a finished plated dish -> serve it if order is active, otherwise clear cleanly
    if (ai.holding?.kind === 'plated') {
      if (ai.holding.recipeId && activeRecipeIds.has(ai.holding.recipeId)) {
        this.tapStation(ai.playerId, 'serve_window');
      } else {
        this.tapStation(ai.playerId, 'trash_bin');
      }
      return;
    }

    // 2) Holding a cooked base -> combine with a staged topping on a counter, or place neatly on an empty counter
    if (ai.holding?.kind === 'cooked') {
      const rec = this.findRecipeForCookedItem(ai.holding);
      if (rec?.toppingIngredient) {
        const counterWithTopping = this.stations.find(
          (s) =>
            s.kind === 'counter' &&
            s.item?.kind === 'raw' &&
            s.item.ingredientId === rec.toppingIngredient &&
            !this.isHumanHandlingStation(human, s),
        );
        if (counterWithTopping) {
          this.tapStation(ai.playerId, counterWithTopping.id);
          return;
        }
      }
      const emptyCounter = this.stations.find((s) => s.kind === 'counter' && !s.item);
      if (emptyCounter) {
        this.tapStation(ai.playerId, emptyCounter.id);
      }
      return;
    }

    // 3) Holding a raw ingredient (either a topping to finish a cooked base OR a handed-off raw base)
    if (ai.holding?.kind === 'raw' && ai.holding.ingredientId) {
      const heldIng = ai.holding.ingredientId;

      // 3a) Combine onto a waiting cooked base that needs this topping!
      const cookedTarget = this.stations.find((s) => {
        if (s.cookingActive || s.item?.kind !== 'cooked') return false;
        if (this.isHumanHandlingStation(human, s)) return false;
        const rec = this.findRecipeForCookedItem(s.item);
        return rec?.toppingIngredient === heldIng;
      });
      if (cookedTarget) {
        this.tapStation(ai.playerId, cookedTarget.id);
        return;
      }

      // 3b) Place handed-off raw base into its matching empty cook station!
      const stop = STOP_BY_ID[this.stopId];
      const baseRec = stop.recipes.find((r) => r.baseIngredient === heldIng);
      if (baseRec) {
        const cookSt = this.stations.find(
          (s) => s.kind === baseRec.cookStation && !s.item && !this.isHumanHandlingStation(human, s),
        );
        if (cookSt) {
          this.tapStation(ai.playerId, cookSt.id);
          return;
        }
      }

      // 3c) Player already finished/moved the dish while we were en route -> clear stale item cleanly
      this.tapStation(ai.playerId, 'trash_bin');
      return;
    }

    // 4) Empty hands: look ONLY for player-started work that has passed its polite grace window

    // 4a) Ready plated dish sitting on a Pass Counter (>=1.0s) or untouched on a Cook Station (>=2.2s)
    const readyPlated = this.stations.find((s) => {
      if (s.cookingActive || s.item?.kind !== 'plated' || !s.item.recipeId) return false;
      if (!activeRecipeIds.has(s.item.recipeId)) return false;
      if (this.isHumanHandlingStation(human, s)) return false;
      const grace = s.kind === 'counter' ? AI_COUNTER_GRACE_MS : AI_PLATED_STATION_GRACE_MS;
      const readySince = s.itemReadySinceMs ?? this.nowMs;
      return this.nowMs - readySince >= grace;
    });
    if (readyPlated) {
      this.tapStation(ai.playerId, readyPlated.id);
      return;
    }

    // 4b) Cooked base sitting ready on a Cook Station (>=1.8s) or Pass Counter (>=1.0s) needing a topping
    const cookedWaiting = this.stations.find((s) => {
      if (s.cookingActive || s.item?.kind !== 'cooked') return false;
      if (this.isHumanHandlingStation(human, s)) return false;
      const rec = this.findRecipeForCookedItem(s.item);
      if (!rec?.toppingIngredient || !activeRecipeIds.has(rec.id)) return false;
      // Back off if human is already holding that topping or heading to its crate!
      if (human?.holding?.kind === 'raw' && human.holding.ingredientId === rec.toppingIngredient) {
        return false;
      }
      if (human?.pendingStationId === `crate_${rec.toppingIngredient}`) {
        return false;
      }
      const grace = s.kind === 'counter' ? AI_COUNTER_GRACE_MS : AI_COOK_STATION_GRACE_MS;
      const readySince = s.itemReadySinceMs ?? this.nowMs;
      return this.nowMs - readySince >= grace;
    });
    if (cookedWaiting && cookedWaiting.item) {
      const rec = this.findRecipeForCookedItem(cookedWaiting.item);
      if (rec?.toppingIngredient) {
        // Prefer a topping the human already staged on a Pass Counter; otherwise grab from crate
        const stagedTopping = this.stations.find(
          (s) =>
            s.kind === 'counter' &&
            s.item?.kind === 'raw' &&
            s.item.ingredientId === rec.toppingIngredient &&
            !this.isHumanHandlingStation(human, s),
        );
        this.tapStation(
          ai.playerId,
          stagedTopping ? stagedTopping.id : `crate_${rec.toppingIngredient}`,
        );
        return;
      }
    }

    // 4c) Raw base intentionally dropped on a Pass Counter by the player (>=1.0s) -> move to empty cook station
    const stop = STOP_BY_ID[this.stopId];
    const handedOffBase = this.stations.find((s) => {
      if (s.kind !== 'counter' || s.item?.kind !== 'raw' || !s.item.ingredientId) return false;
      if (this.isHumanHandlingStation(human, s)) return false;
      const readySince = s.itemReadySinceMs ?? this.nowMs;
      if (this.nowMs - readySince < AI_COUNTER_GRACE_MS) return false;
      const rec = stop.recipes.find((r) => r.baseIngredient === s.item?.ingredientId);
      if (!rec) return false;
      const cookSt = this.stations.find(
        (c) => c.kind === rec.cookStation && !c.item && !this.isHumanHandlingStation(human, c),
      );
      return Boolean(cookSt);
    });
    if (handedOffBase) {
      this.tapStation(ai.playerId, handedOffBase.id);
      return;
    }

    // 4d) Otherwise: DO NOT start new orders! Calmly return to out-of-the-way rest perch.
    if (Math.hypot(ai.x - AI_REST_POS.x, ai.y - AI_REST_POS.y) > 0.55) {
      this.tapFloor(ai.playerId, AI_REST_POS.x, AI_REST_POS.y);
    }
  }

  finishShift(): void {
    if (this.status === 'finished') return;
    this.status = 'finished';
    const starsEarned = computeStarsEarned(this.servedCount, this.targets);
    const persisted = this.onShiftComplete?.(starsEarned, this.servedCount, this.score) ?? {
      unlockedNextStopId: null,
      newBestStars: starsEarned > 0,
    };

    this.result = {
      stopId: this.stopId,
      servedCount: this.servedCount,
      score: this.score,
      starsEarned,
      unlockedNextStopId: persisted.unlockedNextStopId,
      targets: this.targets,
      newBestStars: persisted.newBestStars,
    };

    this.pendingEvents.push({
      type: 'shift_finished',
      result: this.result,
    });
  }

  private flushEvents(): SimEvent[] {
    if (this.pendingEvents.length === 0) return [];
    const copy = this.pendingEvents.slice();
    this.pendingEvents.length = 0;
    return copy;
  }

  getSnapshot(): KitchenSnapshot {
    return {
      stopId: this.stopId,
      pace: this.pace,
      status: this.status,
      previewRemainingSec: Math.ceil(Math.max(0, this.previewRemainingSec - 1e-6)),
      timeRemainingSec: Math.ceil(this.timeRemainingSec),
      servedCount: this.servedCount,
      score: this.score,
      targets: this.targets,
      chefs: this.chefs.map((c) => ({ ...c, path: c.path.slice() })),
      stations: this.stations.map((s) => ({ ...s })),
      orders: this.orders.map((o) => ({ ...o })),
      ping: this.ping ? { ...this.ping } : null,
      result: this.result ? { ...this.result } : null,
      serverTimeMs: this.nowMs,
    };
  }
}
