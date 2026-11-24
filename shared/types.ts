export type AnimalId =
  | 'purple_cat'
  | 'orange_dog'
  | 'panda'
  | 'fox'
  | 'skunk'
  | 'purple_bat';

export type StopId =
  | 'sharon'
  | 'nyc'
  | 'chicago'
  | 'austin'
  | 'denver'
  | 'yosemite'
  | 'tahoe'
  | 'sanjose';

export type IngredientId =
  | 'seaweed'
  | 'pasta'
  | 'cheetos'
  | 'gummy_bears'
  | 'french_fries'
  | 'fish_eyes'
  | 'cheese'
  | 'bread'
  | 'rice'
  | 'fish'
  | 'sweet_corn'
  | 'soup'
  | 'ice_cream'
  | 'chocolate';

export type CookStationType = 'prep_board' | 'stove_pot' | 'grill_fryer';

export type StationKind =
  | 'crate'
  | CookStationType
  | 'counter'
  | 'serve_window'
  | 'trash';

export type GamePace = 'cozy' | 'rush';

export type ScreenMode = 'lobby' | 'map' | 'kitchen';

export interface AnimalDef {
  id: AnimalId;
  name: string;
  shortName: string;
  accentColor: string;
  apronColor: string;
  behaviorName: string;
  behaviorDesc: string;
  emoteDurationMs: number;
  isSmall?: boolean;
  hovers?: boolean;
  spritePath: string;
  emoteSpritePath: string;
}

export interface IngredientDef {
  id: IngredientId;
  name: string;
  shortName: string;
  accentColor: string;
  spritePath: string;
}

export interface RecipeDef {
  id: string;
  name: string;
  shortName: string;
  baseIngredient: IngredientId;
  cookStation: CookStationType;
  cookSeconds: number;
  toppingIngredient?: IngredientId;
  spritePath: string;
  featuredTags: string[];
}

export interface StarTargets {
  oneStar: number;
  twoStar: number;
  threeStar: number;
  shiftSeconds: number;
}

export interface StopDef {
  index: number; // 1..8
  id: StopId;
  name: string;
  shortName: string;
  stateCode: string;
  subtitle: string;
  vibe: string;
  lat: number;
  lon: number;
  sceneBgPath: string;
  accentColor: string;
  crates: IngredientId[]; // 4-5 fixed crates on this stop
  recipes: RecipeDef[];
  shiftSecondsCozy: number;
  shiftSecondsRush: number;
  baseTargetsSolo: [number, number, number]; // [1*, 2*, 3*]
  baseTargetsDuo: [number, number, number];
  baseTargetsTrio: [number, number, number];
}

export interface HeldItem {
  kind: 'raw' | 'cooked' | 'plated';
  ingredientId?: IngredientId; // set when raw or cooked
  cookStation?: CookStationType; // set when cooked
  recipeId?: string; // set when plated (ready to serve!)
}

export interface StationState {
  id: string;
  kind: StationKind;
  label: string;
  gridX: number;
  gridY: number;
  ingredientId?: IngredientId; // for crate
  item: HeldItem | null;
  cookProgress: number; // 0..1 while cooking/prepping
  cookingActive: boolean;
  itemReadySinceMs?: number; // timestamp when item finished cooking or was placed on counter
}

export interface OrderTicket {
  id: string;
  recipeId: string;
  createdAtMs: number;
  patienceSec: number;
  remainingSec: number;
}

export interface PlayerProfile {
  playerId: string;
  name: string;
  animalId: AnimalId;
  kidHelper: boolean;
  connected: boolean;
  isAi?: boolean;
}

export interface ChefEntity {
  playerId: string;
  name: string;
  animalId: AnimalId;
  kidHelper: boolean;
  isAi?: boolean;
  x: number; // grid coordinate float (0..10)
  y: number; // grid coordinate float (0..6)
  facing: 'left' | 'right';
  moving: boolean;
  holding: HeldItem | null;
  emoteUntilMs: number;
  path: Array<{ x: number; y: number }>;
  pendingStationId: string | null;
}

export interface PingBeacon {
  stationId: string;
  fromPlayerName: string;
  accentColor: string;
  expiresAtMs: number;
}

export interface ShiftResult {
  stopId: StopId;
  servedCount: number;
  score: number;
  starsEarned: 0 | 1 | 2 | 3;
  unlockedNextStopId: StopId | null;
  targets: StarTargets;
  newBestStars: boolean;
}

export interface KitchenSnapshot {
  stopId: StopId;
  pace: GamePace;
  status: 'running' | 'finished';
  timeRemainingSec: number;
  servedCount: number;
  score: number;
  targets: StarTargets;
  chefs: ChefEntity[];
  stations: StationState[];
  orders: OrderTicket[];
  ping: PingBeacon | null;
  result: ShiftResult | null;
  serverTimeMs: number;
}

export interface TripSave {
  token: string;
  createdAt: string;
  updatedAt: string;
  currentStopId: StopId;
  unlockedStopIds: StopId[];
  starsByStop: Partial<Record<StopId, 1 | 2 | 3>>;
  totalScore: number;
  crewLocked: boolean;
  lockedNames: string[];
  pace: GamePace;
  soloMode: boolean;
  soloAiHelper: boolean;
}

export interface RoomStatePayload {
  trip: TripSave;
  screen: ScreenMode;
  players: PlayerProfile[];
  vanStopId: StopId;
  kitchen: KitchenSnapshot | null;
}

export interface GuidanceHint {
  targetStationId: string;
  orderId: string | null;
  message: string;
  stepNumber: 1 | 2 | 3;
  isParentPing: boolean;
  ingredientSpritePath?: string;
}
