import type {
  AnimalId,
  GamePace,
  KitchenSnapshot,
  PlayerProfile,
  RoomStatePayload,
  StopId,
} from '@shared/types';

export interface SimEventPayload {
  type: 'dish_served' | 'cook_done' | 'combined' | 'animal_emote' | 'shift_started' | 'shift_finished' | 'ping';
  playerId?: string;
  animalId?: AnimalId;
  recipeId?: string;
  pointsAwarded?: number;
  x?: number;
  y?: number;
}

export interface IGameTransport {
  readonly isStaticSolo: boolean;
  onRoomState?: (state: RoomStatePayload) => void;
  onKitchenSnapshot?: (snap: KitchenSnapshot) => void;
  onSimEvent?: (ev: SimEventPayload) => void;
  onDisconnect?: () => void;

  joinTrip(params: {
    token: string;
    name: string;
    playerId?: string;
    preferredAnimalId?: AnimalId;
    kidHelper: boolean;
  }): Promise<{ ok: true; player: PlayerProfile; state: RoomStatePayload } | { ok: false; error: string }>;

  selectAnimal(animalId: AnimalId): Promise<{ ok: boolean; error?: string }>;
  setKidHelper(enabled: boolean): void;
  setCrewLocked(locked: boolean): void;
  setPace(pace: GamePace): void;
  setSoloAiHelper(enabled: boolean): void;
  openMap(): void;
  returnToLobby(): void;
  driveVan(stopId: StopId): Promise<{ ok: boolean; error?: string }>;
  startShift(stopId?: StopId): Promise<{ ok: boolean; error?: string }>;
  skipPreview(): void;
  tapStation(stationId: string): void;
  tapFloor(x: number, y: number): void;
  moveDir(dx: number, dy: number): void;
  interactNearest(): void;
  triggerEmote(): void;
  pingStation(stationId: string): void;
  resetSoloProgress?(): void;
}
