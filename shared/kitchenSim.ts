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
  type:
    | 'dish_served'
    | 'cook_done'
    | 'combined'
    | 'animal_emote'
    | 'ai_cheer'
    | 'shift_started'
    | 'shift_finished'
    | 'ping';
  playerId?: string;
  animalId?: AnimalId;
  recipeId?: string;
  pointsAwarded?: number;
  message?: string;
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
const AI_CHEF_SPEED = 2.75; // calm, unhurried ~65% speed so AI never races the player
const AI_REST_POS = { x: 6.9, y: 4.75 }; // open bottom-right deck perch clear of all crates & walkways
const AI_IDLE_COOLDOWN_MS = 1000;
const AI_CARRY_COOLDOWN_MS = 350;
const AI_COOK_STATION_GRACE_MS = 7000; // generous 7s grace before helping finish an abandoned dish
const AI_COUNTER_GRACE_MS = 5500;
const AI_PLATED_STATION_GRACE_MS = 6500;
const AI_RESCUE_OWN_GRACE_MS = 450; // swift finish for a single rescue dish the AI itself initiated
const AI_HUMAN_SAFE_RADIUS = 2.2; // wide personal-space halo so AI never crowds or steals from player
const AI_STALL_NO_PROGRESS_MS = 14_000; // step in if player makes zero cooking progress for 14s
const AI_STRUGGLE_NO_SERVE_MS = 22_000; // step in if no serve for 22s and 7s without progress
const AI_URGENT_ORDER_PATIENCE_RATIO = 0.25;
const AI_LATE_SHIFT_RESCUE_SEC = 25;
const AI_POST_SERVE_BREATHER_MS = 7000; // rest 7s after an AI serve so control returns to player
const AI_CHEER_DURATION_MS = 3200;
const AI_AMBIENT_CHEER_COOLDOWN_MS = 6500;
const INTERACT_RANGE = 1.55;

const AI_CHEERS = {
  start: ["You've got this!"],
  serve: [
    "You've got it!",
    'Way to go, Chef!',
    'Yum! Great job!',
    'Awesome dish!',
    "You're crushing it!",
  ],
  cook: ["You've got this!", 'Nice cooking!', 'Looking yummy!', 'Go, Chef, go!'],
  yield: ["You've got it!", 'All yours, Chef!'],
  handback: ["I've got your back!", 'Back to you, Chef!'],
} as const;

type AiCheerCategory = keyof typeof AI_CHEERS;

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
  private lastHumanProgressMs: number;
  private lastHumanServeMs: number;
  private lastAiServeMs = 0;
  private lastAiCheerMs = -AI_AMBIENT_CHEER_COOLDOWN_MS;
  private aiCheerIdx = 0;
  private readonly onShiftComplete?: KitchenSimOptions['onShiftComplete'];
  private readonly pendingEvents: SimEvent[] = [];

  constructor(options: KitchenSimOptions) {
    this.stopId = options.stopId;
    this.pace = options.pace;
    this.nowMs = options.nowMs ?? Date.now();
    this.lastOrderSpawnMs = this.nowMs;
    this.lastHumanProgressMs = this.nowMs;
    this.lastHumanServeMs = this.nowMs;
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

    if (this.status === 'running') {
      this.triggerAiCheer('start', true);
    }
  }

  private onShiftRunningStarted(): void {
    this.lastHumanProgressMs = this.nowMs;
    this.lastHumanServeMs = this.nowMs;
    this.lastAiServeMs = 0;
    this.pendingEvents.push({ type: 'shift_started' });
    this.triggerAiCheer('start', true);
  }

  skipPreview(): void {
    if (this.status !== 'preview') return;
    this.previewRemainingSec = 0;
    this.status = 'running';
    this.onShiftRunningStarted();
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
      this.spawnAiChef(players.map((p) => p.animalId));
    }
  }

  private spawnAiChef(takenAnimalIds: AnimalId[]): ChefEntity {
    const taken = new Set(takenAnimalIds);
    const freeAnimal = ANIMALS.find((a) => !taken.has(a.id)) ?? ANIMALS[2]!;
    const aiChef: ChefEntity = {
      playerId: 'ai_helper',
      name: `${freeAnimal.shortName} Helper`,
      animalId: freeAnimal.id,
      kidHelper: false,
      isAi: true,
      x: AI_REST_POS.x,
      y: AI_REST_POS.y,
      facing: 'left',
      moving: false,
      holding: null,
      emoteUntilMs: 0,
      path: [],
      pendingStationId: null,
    };
    this.chefs.push(aiChef);
    return aiChef;
  }

  /**
   * Enables or disables the Solo AI Sous-Chef live mid-shift without disrupting the human player.
   */
  setSoloAiHelper(enabled: boolean): void {
    const humanChefs = this.chefs.filter((c) => !c.isAi);
    if (humanChefs.length !== 1) return;

    const existingIdx = this.chefs.findIndex((c) => c.isAi);
    if (!enabled) {
      if (existingIdx < 0) return;
      const ai = this.chefs[existingIdx]!;
      // Preserve any dish/ingredient the AI was carrying onto an empty Pass Counter if available
      if (ai.holding) {
        const emptyCounter = this.stations.find((s) => s.kind === 'counter' && !s.item);
        if (emptyCounter) {
          emptyCounter.item = ai.holding;
          emptyCounter.itemReadySinceMs = this.nowMs;
          emptyCounter.itemPlacedByAi = false;
        }
      }
      this.chefs.splice(existingIdx, 1);
      return;
    }

    if (existingIdx >= 0) return;
    this.spawnAiChef(humanChefs.map((c) => c.animalId));
    this.lastHumanProgressMs = this.nowMs;
    this.aiThinkCooldownMs = AI_IDLE_COOLDOWN_MS;
    if (this.status === 'running') {
      this.triggerAiCheer('start', true);
    }
  }

  private recordHumanProgress(): void {
    this.lastHumanProgressMs = this.nowMs;
  }

  private faceAiTowardHuman(ai: ChefEntity, human: ChefEntity | undefined): void {
    if (!human) return;
    const dx = human.x - ai.x;
    if (Math.abs(dx) > 0.15) {
      ai.facing = dx < 0 ? 'left' : 'right';
    }
  }

  private triggerAiCheer(category: AiCheerCategory, force: boolean): void {
    const ai = this.chefs.find((c) => c.isAi);
    if (!ai) return;

    if (!force) {
      // Keep ambient cheers calm: only while AI is standing by empty-handed and off cooldown
      if (ai.holding || ai.path.length > 0) return;
      if (this.nowMs - this.lastAiCheerMs < AI_AMBIENT_CHEER_COOLDOWN_MS) return;
      if (ai.cheerUntilMs && ai.cheerUntilMs > this.nowMs) return;
    }

    const lines = AI_CHEERS[category];
    const message = lines[this.aiCheerIdx % lines.length]!;
    this.aiCheerIdx += 1;
    ai.cheerText = message;
    ai.cheerUntilMs = this.nowMs + AI_CHEER_DURATION_MS;
    this.lastAiCheerMs = this.nowMs;

    const human = this.chefs.find((c) => !c.isAi);
    this.faceAiTowardHuman(ai, human);

    this.pendingEvents.push({
      type: 'ai_cheer',
      playerId: ai.playerId,
      animalId: ai.animalId,
      message,
      x: ai.x,
      y: ai.y,
    });
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
        if (!chef.isAi) {
          this.recordHumanProgress();
        }
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
          if (chef.isAi) {
            this.lastAiServeMs = this.nowMs;
            this.triggerAiCheer('handback', true);
          } else {
            this.recordHumanProgress();
            this.lastHumanServeMs = this.nowMs;
            this.triggerAiCheer('serve', true);
          }
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
          st.itemPlacedByAi = undefined;
          chef.holding = combined;
          this.pendingEvents.push({ type: 'combined', playerId: chef.playerId, x: st.gridX, y: st.gridY });
          if (!chef.isAi) {
            this.recordHumanProgress();
            this.triggerAiCheer('cook', false);
          }
          return;
        }
      }

      // Pick up finished cooked or plated item with empty hands
      if (!chef.holding && st.item && !st.cookingActive) {
        chef.holding = st.item;
        st.item = null;
        st.cookProgress = 0;
        st.itemReadySinceMs = undefined;
        st.itemPlacedByAi = undefined;
        if (!chef.isAi) {
          this.recordHumanProgress();
        }
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
          st.itemPlacedByAi = Boolean(chef.isAi);
          chef.holding = null;
          if (!chef.isAi) {
            this.recordHumanProgress();
            this.triggerAiCheer('cook', false);
          }
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
          st.itemPlacedByAi = undefined;
          chef.holding = combined;
          this.pendingEvents.push({ type: 'combined', playerId: chef.playerId, x: st.gridX, y: st.gridY });
          if (!chef.isAi) {
            this.recordHumanProgress();
            this.triggerAiCheer('cook', false);
          }
        }
        return;
      }
      if (chef.holding && !st.item) {
        st.item = chef.holding;
        st.itemReadySinceMs = this.nowMs;
        st.itemPlacedByAi = Boolean(chef.isAi);
        chef.holding = null;
        if (!chef.isAi) {
          this.recordHumanProgress();
        }
        return;
      }
      if (!chef.holding && st.item) {
        chef.holding = st.item;
        st.item = null;
        st.itemReadySinceMs = undefined;
        st.itemPlacedByAi = undefined;
        if (!chef.isAi) {
          this.recordHumanProgress();
        }
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
        this.onShiftRunningStarted();
      }
      return this.flushEvents();
    }
    if (this.status !== 'running') {
      return this.flushEvents();
    }

    // Expire old pings and chef cheer bubbles
    if (this.ping && this.ping.expiresAtMs <= this.nowMs) {
      this.ping = null;
    }
    for (const chef of this.chefs) {
      if (chef.cheerUntilMs && chef.cheerUntilMs <= this.nowMs) {
        chef.cheerText = undefined;
        chef.cheerUntilMs = undefined;
      }
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

    // Optional Solo AI Helper brain (calm cheerleader that only steps in when player is struggling or a dish is abandoned!)
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
    if (Math.hypot(human.x - st.gridX, human.y - st.gridY) <= AI_HUMAN_SAFE_RADIUS) return true;
    const dest = human.path[human.path.length - 1];
    if (dest && Math.hypot(dest.x - st.gridX, dest.y - st.gridY) <= AI_HUMAN_SAFE_RADIUS) {
      return true;
    }
    return false;
  }

  private isHumanHandlingTopping(human: ChefEntity | undefined, toppingId: string): boolean {
    if (!human) return false;
    if (human.holding?.kind === 'raw' && human.holding.ingredientId === toppingId) return true;
    if (human.pendingStationId === `crate_${toppingId}`) return true;
    const crate = this.stations.find((s) => s.id === `crate_${toppingId}`);
    if (crate && this.isHumanHandlingStation(human, crate)) return true;
    const stagedCounter = this.stations.find(
      (s) =>
        s.kind === 'counter' &&
        s.item?.kind === 'raw' &&
        s.item.ingredientId === toppingId &&
        this.isHumanHandlingStation(human, s),
    );
    return Boolean(stagedCounter);
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

  private isPlayerStruggling(): boolean {
    const msSinceProgress = this.nowMs - this.lastHumanProgressMs;
    const msSinceServe = this.nowMs - this.lastHumanServeMs;
    const behindOneStar = this.servedCount < this.targets.oneStar;
    const hasUrgentOrder = this.orders.some(
      (o) => o.remainingSec / Math.max(1, o.patienceSec) <= AI_URGENT_ORDER_PATIENCE_RATIO,
    );

    const isStalled = msSinceProgress >= AI_STALL_NO_PROGRESS_MS;
    const isNoServeStruggle =
      msSinceServe >= AI_STRUGGLE_NO_SERVE_MS && msSinceProgress >= 7000;
    const isUrgentRescue =
      behindOneStar &&
      msSinceProgress >= 5000 &&
      (hasUrgentOrder || this.timeRemainingSec <= AI_LATE_SHIFT_RESCUE_SEC);

    return isStalled || isNoServeStruggle || isUrgentRescue;
  }

  private parkAiCalmly(ai: ChefEntity, human: ChefEntity | undefined): void {
    if (Math.hypot(ai.x - AI_REST_POS.x, ai.y - AI_REST_POS.y) > 0.55) {
      this.tapFloor(ai.playerId, AI_REST_POS.x, AI_REST_POS.y);
    } else {
      this.faceAiTowardHuman(ai, human);
    }
  }

  /**
   * Calm, encouraging, struggle-aware AI Sous-Chef:
   * - Stays parked at its bottom-right perch cheering the human on ("You've got it!") while
   *   the player is actively making progress.
   * - NEVER pre-fetches toppings while a dish is cooking and NEVER competes within the human's
   *   safe radius (yields immediately mid-path if the human claims a station!).
   * - Only steps in to finish an abandoned dish left untouched for >= 5.5–7s, OR to rescue ONE
   *   dish when the player is truly stalled/struggling, then rests for a 7s breather.
   */
  private updateSoloAiHelper(dtSec: number): void {
    const ai = this.chefs.find((c) => c.isAi);
    if (!ai) return;

    const human = this.chefs.find((c) => !c.isAi);
    const activeRecipeIds = new Set(this.orders.map((o) => o.recipeId));

    // 0) Immediate mid-path yield: if empty-handed AI is heading to a station the human just claimed, back off!
    if (!ai.holding && ai.pendingStationId) {
      const targetSt = this.stations.find((s) => s.id === ai.pendingStationId);
      let shouldYield = false;
      if (!targetSt || this.isHumanHandlingStation(human, targetSt)) {
        shouldYield = true;
      } else if (targetSt.kind !== 'crate' && !targetSt.item) {
        shouldYield = true;
      } else if (targetSt.kind === 'crate' && targetSt.ingredientId) {
        const ing = targetSt.ingredientId;
        const waitingCookedNeedsIng = this.stations.some((s) => {
          if (s.cookingActive || s.item?.kind !== 'cooked') return false;
          if (this.isHumanHandlingStation(human, s)) return false;
          const rec = this.findRecipeForCookedItem(s.item);
          return rec?.toppingIngredient === ing;
        });
        if (this.isHumanHandlingTopping(human, ing)) {
          shouldYield = true;
        } else if (!waitingCookedNeedsIng && !this.isPlayerStruggling()) {
          // Human resumed making progress before AI grabbed a rescue base!
          shouldYield = true;
        }
      }

      if (shouldYield) {
        ai.path = [];
        ai.pendingStationId = null;
        this.triggerAiCheer('yield', true);
        this.parkAiCalmly(ai, human);
        this.aiThinkCooldownMs = AI_IDLE_COOLDOWN_MS;
        return;
      }
    }

    this.aiThinkCooldownMs = Math.max(0, this.aiThinkCooldownMs - dtSec * 1000);
    if (ai.path.length > 0 || this.aiThinkCooldownMs > 0) return;

    const setNextCooldown = () => {
      this.aiThinkCooldownMs = ai.holding ? AI_CARRY_COOLDOWN_MS : AI_IDLE_COOLDOWN_MS;
    };

    // 1) Holding a finished plated dish -> serve it cleanly if order is active, otherwise clear
    if (ai.holding?.kind === 'plated') {
      if (ai.holding.recipeId && activeRecipeIds.has(ai.holding.recipeId)) {
        this.tapStation(ai.playerId, 'serve_window');
      } else {
        this.tapStation(ai.playerId, 'trash_bin');
      }
      setNextCooldown();
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
          setNextCooldown();
          return;
        }
      }
      const emptyCounter = this.stations.find((s) => s.kind === 'counter' && !s.item);
      if (emptyCounter) {
        this.tapStation(ai.playerId, emptyCounter.id);
      }
      setNextCooldown();
      return;
    }

    // 3) Holding a raw ingredient (topping for an abandoned/rescue cooked base OR a rescue/abandoned base)
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
        setNextCooldown();
        return;
      }

      // 3b) Place raw base into its matching empty cook station for an active order!
      const stop = STOP_BY_ID[this.stopId];
      const baseRec =
        stop.recipes.find((r) => activeRecipeIds.has(r.id) && r.baseIngredient === heldIng) ??
        stop.recipes.find((r) => r.baseIngredient === heldIng);
      if (baseRec) {
        const cookSt = this.stations.find(
          (s) => s.kind === baseRec.cookStation && !s.item && !this.isHumanHandlingStation(human, s),
        );
        if (cookSt) {
          this.tapStation(ai.playerId, cookSt.id);
          setNextCooldown();
          return;
        }
      }

      // 3c) Player already finished/moved the dish while we were en route -> clear stale item cleanly
      this.tapStation(ai.playerId, 'trash_bin');
      setNextCooldown();
      return;
    }

    // 4) Empty hands: stay parked unless a dish is truly abandoned OR the player is struggling/stalled!

    // Post-serve breather: after AI finishes a rescue dish, rest at perch so the player stays in charge
    if (this.lastAiServeMs > 0 && this.nowMs - this.lastAiServeMs < AI_POST_SERVE_BREATHER_MS) {
      this.parkAiCalmly(ai, human);
      setNextCooldown();
      return;
    }

    // If an AI-started rescue dish is currently actively cooking, wait calmly at rest (never pre-fetch!)
    const aiRescueCooking = this.stations.some((s) => s.cookingActive && s.itemPlacedByAi);
    if (aiRescueCooking) {
      this.parkAiCalmly(ai, human);
      setNextCooldown();
      return;
    }

    // 4a) Ready plated dish left abandoned (or finished AI rescue dish)
    const readyPlated = this.stations.find((s) => {
      if (s.cookingActive || s.item?.kind !== 'plated' || !s.item.recipeId) return false;
      if (!activeRecipeIds.has(s.item.recipeId)) return false;
      if (this.isHumanHandlingStation(human, s)) return false;
      const grace = s.itemPlacedByAi
        ? AI_RESCUE_OWN_GRACE_MS
        : s.kind === 'counter'
          ? AI_COUNTER_GRACE_MS
          : AI_PLATED_STATION_GRACE_MS;
      const readySince = s.itemReadySinceMs ?? this.nowMs;
      return this.nowMs - readySince >= grace;
    });
    if (readyPlated) {
      this.tapStation(ai.playerId, readyPlated.id);
      setNextCooldown();
      return;
    }

    // 4b) Cooked base left abandoned on a station/counter (or finished AI rescue base) needing a topping
    const cookedWaiting = this.stations.find((s) => {
      if (s.cookingActive || s.item?.kind !== 'cooked') return false;
      if (this.isHumanHandlingStation(human, s)) return false;
      const rec = this.findRecipeForCookedItem(s.item);
      if (!rec?.toppingIngredient || !activeRecipeIds.has(rec.id)) return false;
      if (this.isHumanHandlingTopping(human, rec.toppingIngredient)) return false;
      const grace = s.itemPlacedByAi
        ? AI_RESCUE_OWN_GRACE_MS
        : s.kind === 'counter'
          ? AI_COUNTER_GRACE_MS
          : AI_COOK_STATION_GRACE_MS;
      const readySince = s.itemReadySinceMs ?? this.nowMs;
      return this.nowMs - readySince >= grace;
    });
    if (cookedWaiting && cookedWaiting.item) {
      const rec = this.findRecipeForCookedItem(cookedWaiting.item);
      if (rec?.toppingIngredient) {
        const stagedTopping = this.stations.find(
          (s) =>
            s.kind === 'counter' &&
            s.item?.kind === 'raw' &&
            s.item.ingredientId === rec.toppingIngredient &&
            !this.isHumanHandlingStation(human, s),
        );
        const targetId = stagedTopping ? stagedTopping.id : `crate_${rec.toppingIngredient}`;
        const targetStation = this.stations.find((s) => s.id === targetId);
        if (targetStation && !this.isHumanHandlingStation(human, targetStation)) {
          this.tapStation(ai.playerId, targetId);
          this.aiThinkCooldownMs = AI_CARRY_COOLDOWN_MS;
          return;
        }
      }
    }

    // 4c) Raw base left untouched on a Pass Counter (>= 5.5s) -> move to empty cook station
    const stop = STOP_BY_ID[this.stopId];
    const handedOffBase = this.stations.find((s) => {
      if (s.kind !== 'counter' || s.item?.kind !== 'raw' || !s.item.ingredientId) return false;
      if (this.isHumanHandlingStation(human, s)) return false;
      const readySince = s.itemReadySinceMs ?? this.nowMs;
      if (this.nowMs - readySince < AI_COUNTER_GRACE_MS) return false;
      const rec = stop.recipes.find(
        (r) => activeRecipeIds.has(r.id) && r.baseIngredient === s.item?.ingredientId,
      );
      if (!rec) return false;
      const cookSt = this.stations.find(
        (c) => c.kind === rec.cookStation && !c.item && !this.isHumanHandlingStation(human, c),
      );
      return Boolean(cookSt);
    });
    if (handedOffBase) {
      this.tapStation(ai.playerId, handedOffBase.id);
      this.aiThinkCooldownMs = AI_CARRY_COOLDOWN_MS;
      return;
    }

    // 4d) Struggle / stall rescue: ONLY when the human is truly stalled or struggling behind pace,
    //     and no dish is currently in progress, calmly start ONE urgent order and then rest!
    if (this.isPlayerStruggling() && human?.holding?.kind !== 'plated') {
      const hasInProgressDish = this.stations.some(
        (s) => s.cookingActive || s.item?.kind === 'cooked' || s.item?.kind === 'plated',
      );
      if (!hasInProgressDish) {
        const urgentOrders = this.orders.slice().sort((a, b) => a.remainingSec - b.remainingSec);
        for (const order of urgentOrders) {
          const rec = RECIPE_BY_ID[order.recipeId];
          if (!rec) continue;
          const cookSt = this.stations.find(
            (s) => s.kind === rec.cookStation && !s.item && !this.isHumanHandlingStation(human, s),
          );
          const crateSt = this.stations.find(
            (s) => s.id === `crate_${rec.baseIngredient}` && !this.isHumanHandlingStation(human, s),
          );
          if (cookSt && crateSt) {
            this.tapStation(ai.playerId, crateSt.id);
            this.aiThinkCooldownMs = AI_CARRY_COOLDOWN_MS;
            return;
          }
        }
      }
    }

    // 4e) Otherwise: stay calmly parked at rest perch, facing & cheering on the player!
    this.parkAiCalmly(ai, human);
    setNextCooldown();
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
