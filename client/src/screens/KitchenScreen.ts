import { ANIMALS, ANIMAL_BY_ID, INGREDIENTS, INGREDIENT_BY_ID } from '@shared/animals';
import { computeGuidanceHint } from '@shared/guidance';
import { RECIPE_BY_ID, STOPS, STOP_BY_ID } from '@shared/stops';
import type {
  AnimalId,
  ChefEntity,
  HeldItem,
  KitchenSnapshot,
  PlayerProfile,
  RoomStatePayload,
  StationState,
} from '@shared/types';
import { musicEngine } from '../audio/musicEngine';
import { soundEngine } from '../audio/soundEngine';
import { assetUrl } from '../net/assets';
import type { IGameTransport, SimEventPayload } from '../net/transport';
import {
  DEFAULT_SCENE_ASPECT,
  getCoverImageRect,
  gridToDeckScreen,
  screenToDeckGrid,
} from './kitchenDeckGeometry';

const STATION_SPRITE_PATHS: Record<string, string> = {
  crate: '/assets/stations/station_crate.png',
  prep_board: '/assets/stations/station_prep_board.png',
  stove_pot: '/assets/stations/station_stove_pot.png',
  grill_fryer: '/assets/stations/station_grill_fryer.png',
  counter: '/assets/stations/station_counter.png',
  trash: '/assets/stations/station_trash.png',
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
}

interface FloatingScorePopup {
  x: number;
  y: number;
  text: string;
  life: number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class KitchenScreen {
  private container: HTMLElement;
  private socket: IGameTransport;
  private roomState: RoomStatePayload | null = null;
  private snapshot: KitchenSnapshot | null = null;
  private meId = '';
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private rafId: number | null = null;
  private tick = 0;

  // Smooth interpolated chef positions for buttery 60fps motion
  private renderPos = new Map<string, { x: number; y: number }>();
  private particles: Particle[] = [];
  private floatingPopups: FloatingScorePopup[] = [];
  private pingMode = false;
  private keys = new Set<string>();
  private keyMoveInterval: number | null = null;
  private lastHudSignature = '';
  private resultShownForStatus = false;
  private previewOverlayVisible = false;

  // Image cache (preloaded illustrated sprites — zero system emojis!)
  private images = new Map<string, HTMLImageElement>();

  constructor(container: HTMLElement, socket: IGameTransport) {
    this.container = container;
    this.socket = socket;
    this.preloadAssets();
  }

  private preloadAssets(): void {
    const paths: string[] = [
      ...Object.values(STATION_SPRITE_PATHS),
      ...ANIMALS.flatMap((a) => [a.spritePath, a.emoteSpritePath]),
      ...INGREDIENTS.map((i) => i.spritePath),
      ...STOPS.flatMap((s) => [s.sceneBgPath, ...s.recipes.map((r) => r.spritePath)]),
    ];
    for (const p of new Set(paths)) {
      const img = new Image();
      img.src = assetUrl(p);
      this.images.set(p, img);
    }
  }

  private getImg(path?: string): HTMLImageElement | null {
    if (!path) return null;
    let img = this.images.get(path);
    if (!img) {
      img = new Image();
      img.src = assetUrl(path);
      this.images.set(path, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  mount(state: RoomStatePayload, me: PlayerProfile): void {
    this.roomState = state;
    this.snapshot = state.kitchen;
    this.meId = me.playerId;
    this.pingMode = false;
    this.lastHudSignature = '';
    this.resultShownForStatus = false;
    this.previewOverlayVisible = false;
    this.renderPos.clear();
    this.particles = [];
    this.floatingPopups = [];

    this.renderShell();
    this.bindKeyboard();
    this.startLoop();
    this.updateHud();
    if (this.snapshot?.status === 'preview') {
      this.syncPreviewOverlay(this.snapshot);
    }
  }

  updateRoom(state: RoomStatePayload, me: PlayerProfile): void {
    this.roomState = state;
    this.meId = me.playerId;
    if (state.kitchen) {
      this.updateSnapshot(state.kitchen);
    }
  }

  updateSnapshot(snap: KitchenSnapshot): void {
    this.snapshot = snap;
    this.updateHud();
    this.syncPreviewOverlay(snap);
    if (snap.status === 'finished' && !this.resultShownForStatus) {
      this.resultShownForStatus = true;
      this.renderResultModal();
    }
  }

  handleSimEvent(ev: SimEventPayload): void {
    const canvas = this.canvas;
    const w = canvas?.clientWidth ?? 1000;
    const h = canvas?.clientHeight ?? 600;
    const pt =
      ev.x !== undefined && ev.y !== undefined
        ? this.gridToScreen(ev.x, ev.y, w, h)
        : { x: w * 0.5, y: h * 0.5 };

    if (ev.type === 'dish_served') {
      soundEngine.playServe();
      this.spawnBurst(pt.x, pt.y, ['#4ade80', '#ffe066', '#f472b6', '#38bdf8'], 24);
      const pts = ev.pointsAwarded ?? 100;
      this.floatingPopups.push({
        x: pt.x,
        y: pt.y - 36,
        text: `+${pts} pts!`,
        life: 1,
      });
    } else if (ev.type === 'cook_done') {
      soundEngine.playCookDone();
      this.spawnBurst(pt.x, pt.y - 20, ['#ffe066', '#fb923c', '#ffffff'], 14);
    } else if (ev.type === 'combined') {
      soundEngine.playCombine();
      this.spawnBurst(pt.x, pt.y - 16, ['#c084fc', '#ffe066', '#4ade80'], 16);
    } else if (ev.type === 'ping') {
      soundEngine.playPing();
      this.spawnBurst(pt.x, pt.y - 24, ['#c084fc', '#f0abfc', '#ffe066'], 16);
    } else if (ev.type === 'animal_emote' && ev.animalId) {
      soundEngine.playAnimalEmote(ev.animalId);
      const colors = this.getEmoteColors(ev.animalId);
      this.spawnBurst(pt.x, pt.y - 24, colors, 20);
    } else if (ev.type === 'shift_started') {
      soundEngine.playCookDone();
    } else if (ev.type === 'shift_finished') {
      if ((this.snapshot?.result?.starsEarned ?? 0) >= 1) {
        soundEngine.playStarFanfare();
        this.spawnBurst(w * 0.5, h * 0.4, ['#ffe066', '#4ade80', '#c084fc', '#fb923c'], 45);
      }
    }
  }

  private getEmoteColors(animalId: AnimalId): string[] {
    switch (animalId) {
      case 'purple_cat': return ['#ffe066', '#c084fc', '#fef08a'];
      case 'orange_dog': return ['#fb923c', '#ffe066', '#38bdf8'];
      case 'panda': return ['#4ade80', '#16a34a', '#bbf7d0'];
      case 'fox': return ['#f97316', '#f59e0b', '#dc2626'];
      case 'skunk': return ['#84cc16', '#a855f7', '#bef264'];
      case 'purple_bat': return ['#a855f7', '#e879f9', '#ffe066'];
    }
  }

  unmount(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.unbindKeyboard();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      this.keys.add(k);
    } else if (k === ' ') {
      e.preventDefault();
      this.handleDoItButton();
    } else if (k === 'e') {
      this.socket.triggerEmote();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private bindKeyboard(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.keyMoveInterval = window.setInterval(() => {
      if (this.keys.size === 0 || this.snapshot?.status !== 'running') return;
      let dx = 0;
      let dy = 0;
      if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
      if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
      if (dx !== 0 || dy !== 0) {
        this.socket.moveDir(dx, dy);
      }
    }, 50);
  }

  private unbindKeyboard(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    if (this.keyMoveInterval !== null) {
      clearInterval(this.keyMoveInterval);
      this.keyMoveInterval = null;
    }
    this.keys.clear();
  }

  private renderShell(): void {
    this.container.innerHTML = '';
    const screen = el('div', 'kitchen-screen');

    const canvas = el('canvas', 'kitchen-canvas');
    canvas.addEventListener('pointerdown', (e) => this.handleCanvasTap(e));
    screen.append(canvas);

    const topHud = el('div', 'kitchen-top-hud');
    topHud.id = 'kitchen-top-hud';
    screen.append(topHud);

    const bottomHud = el('div', 'kitchen-bottom-hud');
    bottomHud.id = 'kitchen-bottom-hud';
    screen.append(bottomHud);

    const modalHost = el('div');
    modalHost.id = 'kitchen-modal-host';
    screen.append(modalHost);

    this.container.append(screen);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  private getSceneAspect(): number {
    const stopId = this.snapshot?.stopId;
    if (!stopId) return DEFAULT_SCENE_ASPECT;
    const bgImg = this.getImg(STOP_BY_ID[stopId].sceneBgPath);
    if (bgImg && bgImg.naturalWidth > 0 && bgImg.naturalHeight > 0) {
      return bgImg.naturalWidth / bgImg.naturalHeight;
    }
    return DEFAULT_SCENE_ASPECT;
  }

  /**
   * Maps logical 10×6 kitchen grid coordinates cleanly onto each stop's calibrated 2.5D
   * perspective wooden deck planks so no prep surface ever floats over railings or water!
   */
  private gridToScreen(gx: number, gy: number, w: number, h: number): { x: number; y: number } {
    const stopId = this.snapshot?.stopId ?? 'sharon';
    return gridToDeckScreen(stopId, gx, gy, w, h, this.getSceneAspect());
  }

  private screenToGrid(sx: number, sy: number, w: number, h: number): { gx: number; gy: number } {
    const stopId = this.snapshot?.stopId ?? 'sharon';
    return screenToDeckGrid(stopId, sx, sy, w, h, this.getSceneAspect());
  }

  private handleCanvasTap(e: PointerEvent): void {
    if (!this.canvas || !this.snapshot || this.snapshot.status !== 'running') return;
    soundEngine.unlock();
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Hit-test stations with generous iPad touch radius (58px!)
    let tapped: StationState | null = null;
    let bestDist = 62;
    for (const st of this.snapshot.stations) {
      const sp = this.gridToScreen(st.gridX, st.gridY, rect.width, rect.height);
      const d = Math.hypot(sx - sp.x, sy - sp.y);
      if (d < bestDist) {
        bestDist = d;
        tapped = st;
      }
    }

    if (tapped) {
      if (this.pingMode) {
        this.socket.pingStation(tapped.id);
        this.pingMode = false;
        this.lastHudSignature = '';
        this.updateHud();
        return;
      }
      soundEngine.playPickup();
      this.socket.tapStation(tapped.id);
      return;
    }

    if (this.pingMode) {
      this.pingMode = false;
      this.lastHudSignature = '';
      this.updateHud();
      return;
    }

    const { gx, gy } = this.screenToGrid(sx, sy, rect.width, rect.height);
    this.socket.tapFloor(gx, gy);
  }

  private handleDoItButton(): void {
    soundEngine.unlock();
    if (!this.snapshot || this.snapshot.status !== 'running') return;
    const meChef = this.snapshot.chefs.find((c) => c.playerId === this.meId);
    if (!meChef) return;

    // If already near a station, interact immediately!
    const nearStation = this.snapshot.stations.find(
      (s) => Math.hypot(meChef.x - s.gridX, meChef.y - s.gridY) <= 1.75,
    );
    if (nearStation) {
      this.socket.interactNearest();
      soundEngine.playPickup();
      return;
    }

    // Otherwise, if Kid Helper is ON, tapping DO IT! walks right to the next helpful station!
    const hint = computeGuidanceHint(this.snapshot, this.meId);
    if (meChef.kidHelper && hint) {
      soundEngine.playPickup();
      this.socket.tapStation(hint.targetStationId);
    } else {
      this.socket.interactNearest();
    }
  }

  private updateHud(): void {
    const snap = this.snapshot;
    if (!snap) return;

    const meChef = snap.chefs.find((c) => c.playerId === this.meId);
    const hint = meChef?.kidHelper ? computeGuidanceHint(snap, this.meId) : null;

    if (hint && meChef?.kidHelper) {
      soundEngine.speakHint(hint.message);
    }

    const sig = JSON.stringify({
      t: snap.timeRemainingSec,
      s: snap.servedCount,
      sc: snap.score,
      o: snap.orders.map((o) => `${o.id}:${Math.round(o.remainingSec / 2)}`),
      h: meChef?.holding,
      k: meChef?.kidHelper,
      g: hint?.targetStationId,
      pm: this.pingMode,
      m: soundEngine.muted,
      mu: musicEngine.isEnabled,
    });
    if (sig === this.lastHudSignature) return;
    this.lastHudSignature = sig;

    this.renderTopHud(snap, hint?.orderId ?? null);
    this.renderBottomHud(snap, meChef ?? null, hint);
  }

  private renderTopHud(snap: KitchenSnapshot, guidedOrderId: string | null): void {
    const topHud = this.container.querySelector('#kitchen-top-hud');
    if (!topHud) return;
    topHud.innerHTML = '';

    const stop = STOP_BY_ID[snap.stopId];

    // Left: Map Exit + Stop Ribbon
    const left = el('div', 'kitchen-left-controls');
    const backBtn = el('button', 'tactile-btn btn-cream', '← Map');
    backBtn.style.padding = '6px 12px';
    backBtn.style.fontSize = '16px';
    backBtn.addEventListener('click', () => this.socket.openMap());

    const stopPill = el('div', 'wood-ribbon', stop.shortName);
    stopPill.style.padding = '5px 12px';
    stopPill.style.fontSize = '16px';
    left.append(backBtn, stopPill);
    topHud.append(left);

    // Center: 3 Pictorial Dining Order Tickets (Real illustrated sprites, zero emojis!)
    const ordersWrap = el('div', 'kitchen-orders-strip');
    for (const order of snap.orders) {
      const recipe = RECIPE_BY_ID[order.recipeId];
      if (!recipe) continue;

      const ticket = el(
        'div',
        `order-ticket ${order.id === guidedOrderId ? 'guided' : ''}`,
      );
      const dishImg = el('img', 'order-dish-img');
      dishImg.src = assetUrl(recipe.spritePath);
      dishImg.alt = recipe.name;
      ticket.append(dishImg);

      const body = el('div', 'order-body');
      body.append(el('div', 'order-title', recipe.shortName));

      const eq = el('div', 'order-equation');
      const baseImg = el('img');
      baseImg.src = assetUrl(INGREDIENT_BY_ID[recipe.baseIngredient].spritePath);
      baseImg.alt = INGREDIENT_BY_ID[recipe.baseIngredient].shortName;
      eq.append(baseImg, el('span', '', '→'));

      const stImg = el('img');
      stImg.src = assetUrl(STATION_SPRITE_PATHS[recipe.cookStation] ?? STATION_SPRITE_PATHS.stove_pot!);
      stImg.alt = recipe.cookStation;
      eq.append(stImg);

      if (recipe.toppingIngredient) {
        const topImg = el('img');
        topImg.src = assetUrl(INGREDIENT_BY_ID[recipe.toppingIngredient].spritePath);
        topImg.alt = INGREDIENT_BY_ID[recipe.toppingIngredient].shortName;
        eq.append(el('span', '', '+'), topImg);
      }
      body.append(eq);

      const pct = Math.max(5, Math.min(100, Math.round((order.remainingSec / order.patienceSec) * 100)));
      const track = el('div', 'order-bar-track');
      const fill = el('div', 'order-bar-fill');
      fill.style.width = `${pct}%`;
      fill.style.background = pct > 45 ? '#22c55e' : pct > 22 ? '#f59e0b' : '#ef4444';
      track.append(fill);
      body.append(track);

      ticket.append(body);
      ordersWrap.append(ticket);
    }
    topHud.append(ordersWrap);

    // Right: Shift Timer + Customer Star Milestone Progress + Live Score
    const right = el('div', 'kitchen-shift-box');
    const timerPill = el('div', 'shift-timer-pill');
    const mins = Math.floor(snap.timeRemainingSec / 60);
    const secs = String(snap.timeRemainingSec % 60).padStart(2, '0');
    const clock = el(
      'span',
      `shift-clock ${snap.timeRemainingSec <= 15 ? 'urgent' : ''}`,
      `${mins}:${secs}`,
    );

    const t = snap.targets;
    const starText =
      snap.servedCount >= t.threeStar
        ? `★★★ ${snap.servedCount}`
        : snap.servedCount >= t.twoStar
          ? `★★ ${snap.servedCount}/${t.threeStar}`
          : snap.servedCount >= t.oneStar
            ? `★ ${snap.servedCount}/${t.twoStar}`
            : `${snap.servedCount}/${t.oneStar} ★`;

    const starsBox = el('span', 'shift-stars-bar', `Served: ${starText} • ${(snap.score ?? 0).toLocaleString()} pts`);
    timerPill.append(clock, starsBox);
    right.append(timerPill);

    const audioRow = el('div');
    audioRow.style.display = 'flex';
    audioRow.style.gap = '6px';

    const musicBtn = el(
      'button',
      'tactile-btn btn-cream',
      musicEngine.isEnabled && !soundEngine.muted ? 'Music ON' : 'Music OFF',
    );
    musicBtn.style.padding = '5px 10px';
    musicBtn.style.fontSize = '15px';
    musicBtn.addEventListener('click', () => {
      soundEngine.unlock();
      musicEngine.toggle();
      this.lastHudSignature = '';
      this.updateHud();
    });

    const muteBtn = el('button', 'tactile-btn btn-cream', soundEngine.muted ? 'Muted' : 'Sound');
    muteBtn.style.padding = '5px 10px';
    muteBtn.style.fontSize = '15px';
    muteBtn.addEventListener('click', () => {
      soundEngine.muted = !soundEngine.muted;
      if (!soundEngine.muted) soundEngine.unlock();
      this.lastHudSignature = '';
      this.updateHud();
    });
    audioRow.append(musicBtn, muteBtn);
    right.append(audioRow);

    topHud.append(right);
  }

  private renderBottomHud(
    snap: KitchenSnapshot,
    meChef: ChefEntity | null,
    hint: ReturnType<typeof computeGuidanceHint>,
  ): void {
    const bottomHud = this.container.querySelector('#kitchen-bottom-hud');
    if (!bottomHud) return;
    bottomHud.innerHTML = '';

    // Left: Kid Guide Banner + Adult Star Ping Button
    const leftGroup = el('div');
    leftGroup.style.display = 'flex';
    leftGroup.style.alignItems = 'flex-end';
    leftGroup.style.gap = '8px';

    if (hint) {
      const banner = el('div', `kid-guide-banner ${hint.isParentPing ? 'ping' : ''}`);
      if (hint.ingredientSpritePath) {
        const icon = el('img', 'kid-guide-icon');
        icon.src = assetUrl(hint.ingredientSpritePath);
        icon.alt = '';
        banner.append(icon);
      }
      const txt = el('div');
      const lbl = el('div', '', hint.isParentPing ? 'TEAMMATE PING!' : 'KID GUIDE');
      lbl.style.fontSize = '13.5px';
      lbl.style.fontWeight = '900';
      lbl.style.letterSpacing = '0.06em';
      lbl.style.color = hint.isParentPing ? '#6d28d9' : '#b45309';
      const msg = el('div', '', hint.message);
      msg.style.fontSize = '18px';
      msg.style.fontWeight = '800';
      txt.append(lbl, msg);
      banner.append(txt);
      leftGroup.append(banner);
    }

    if (!this.socket.isStaticSolo) {
      const pingBtn = el(
        'button',
        `tactile-btn ${this.pingMode ? 'btn-purple' : 'btn-cream'}`,
        this.pingMode ? 'Tap a Station to Ping!' : 'Ping Station',
      );
      pingBtn.style.fontSize = '15.5px';
      pingBtn.style.padding = '10px 13px';
      pingBtn.addEventListener('click', () => {
        this.pingMode = !this.pingMode;
        this.lastHudSignature = '';
        this.updateHud();
      });
      leftGroup.append(pingBtn);
    }
    bottomHud.append(leftGroup);

    // Right: Holding Indicator + Chunky iPad DO IT! / FUN EMOTE / KID HELPER Buttons
    const pad = el('div', 'kitchen-action-pad');

    const holdingPill = el('div', 'holding-pill');
    const heldSprite = this.getHeldItemSpritePath(meChef?.holding ?? null);
    if (heldSprite) {
      const img = el('img');
      img.src = assetUrl(heldSprite);
      img.alt = '';
      holdingPill.append(img);
    }
    holdingPill.append(el('span', '', this.getHeldItemLabel(meChef?.holding ?? null)));
    pad.append(holdingPill);

    const doBtn = el('button', 'tactile-btn btn-gold big-do-btn', 'DO IT!');
    doBtn.addEventListener('click', () => this.handleDoItButton());
    pad.append(doBtn);

    const animal = meChef ? ANIMAL_BY_ID[meChef.animalId] : ANIMALS[0]!;
    const emoteBtn = el('button', 'tactile-btn btn-purple big-emote-btn');
    const emoteIcon = el('img');
    emoteIcon.src = assetUrl(animal.emoteSpritePath);
    emoteIcon.alt = animal.behaviorName;
    emoteIcon.style.width = '30px';
    emoteIcon.style.height = '30px';
    emoteIcon.style.objectFit = 'contain';
    emoteBtn.append(emoteIcon, el('span', '', 'EMOTE'));
    emoteBtn.addEventListener('click', () => {
      soundEngine.unlock();
      this.socket.triggerEmote();
    });
    pad.append(emoteBtn);

    const helperBtn = el(
      'button',
      `tactile-btn ${meChef?.kidHelper ? 'btn-green' : 'btn-cream'} big-helper-btn`,
    );
    helperBtn.append(
      el('span', '', meChef?.kidHelper ? '★ ON' : '☆ OFF'),
      el('span', '', 'HELPER'),
    );
    helperBtn.addEventListener('click', () => {
      this.socket.setKidHelper(!(meChef?.kidHelper ?? true));
    });
    pad.append(helperBtn);

    bottomHud.append(pad);
  }

  private syncPreviewOverlay(snap: KitchenSnapshot): void {
    const host = this.container.querySelector('#kitchen-modal-host');
    if (!host) return;

    if (snap.status !== 'preview') {
      if (this.previewOverlayVisible) {
        this.previewOverlayVisible = false;
        host.innerHTML = '';
      }
      return;
    }

    const countdownText = `Cooking starts in ${Math.max(1, snap.previewRemainingSec)}…`;
    if (this.previewOverlayVisible) {
      const badge = host.querySelector('#preview-countdown-pill');
      if (badge) badge.textContent = countdownText;
      return;
    }

    this.previewOverlayVisible = true;
    host.innerHTML = '';

    const stop = STOP_BY_ID[snap.stopId];
    const stationNames: Record<string, string> = {
      prep_board: 'Prep Board',
      stove_pot: 'Boiling Pot',
      grill_fryer: 'Grill & Fryer',
    };

    const backdrop = el('div', 'modal-backdrop');
    const card = el('div', 'storybook-panel recipe-preview-card pop-in');

    card.append(el('div', 'wood-ribbon', `${stop.shortName.toUpperCase()} — TODAY'S MENU!`));

    const goal = el(
      'div',
      '',
      `Goal: Serve ${snap.targets.oneStar}★ to unlock the next stop  •  ${snap.targets.threeStar}★★★ for a Super Shift!`,
    );
    goal.style.fontWeight = '800';
    goal.style.fontSize = '18px';
    goal.style.color = '#764c29';
    card.append(goal);

    const list = el('div', 'recipe-preview-list');
    for (const recipe of stop.recipes) {
      const row = el('div', 'recipe-preview-row');
      const eq = el('div', 'recipe-preview-eq');

      const baseIng = INGREDIENT_BY_ID[recipe.baseIngredient];
      const baseChip = el('div', 'recipe-step-chip');
      const baseImg = el('img');
      baseImg.src = assetUrl(baseIng.spritePath);
      baseImg.alt = baseIng.shortName;
      baseChip.append(baseImg, el('span', '', baseIng.shortName));
      eq.append(baseChip, el('span', 'recipe-step-op', '→'));

      const stChip = el('div', 'recipe-step-chip');
      const stImg = el('img');
      stImg.src = assetUrl(STATION_SPRITE_PATHS[recipe.cookStation] ?? STATION_SPRITE_PATHS.stove_pot!);
      stImg.alt = stationNames[recipe.cookStation] ?? recipe.cookStation;
      stChip.append(stImg, el('span', '', stationNames[recipe.cookStation] ?? 'Cook'));
      eq.append(stChip);

      if (recipe.toppingIngredient) {
        const topIng = INGREDIENT_BY_ID[recipe.toppingIngredient];
        const topChip = el('div', 'recipe-step-chip');
        const topImg = el('img');
        topImg.src = assetUrl(topIng.spritePath);
        topImg.alt = topIng.shortName;
        topChip.append(topImg, el('span', '', topIng.shortName));
        eq.append(el('span', 'recipe-step-op', '+'), topChip);
      }

      eq.append(el('span', 'recipe-step-op', '='));

      const dishChip = el('div', 'recipe-step-chip');
      const dishImg = el('img');
      dishImg.src = assetUrl(recipe.spritePath);
      dishImg.alt = recipe.shortName;
      dishChip.append(dishImg, el('span', '', recipe.shortName));
      eq.append(dishChip);

      row.append(eq);
      list.append(row);
    }
    card.append(list);

    const footer = el('div', 'recipe-preview-footer');
    const countdown = el('div', 'preview-countdown-pill', countdownText);
    countdown.id = 'preview-countdown-pill';

    const skipBtn = el('button', 'tactile-btn btn-green', 'Start Cooking Now!');
    skipBtn.addEventListener('click', () => {
      soundEngine.unlock();
      this.socket.skipPreview();
    });

    footer.append(countdown, skipBtn);
    card.append(footer);
    backdrop.append(card);
    host.append(backdrop);
  }

  private renderResultModal(): void {
    const host = this.container.querySelector('#kitchen-modal-host');
    const result = this.snapshot?.result;
    if (!host || !result) return;
    host.innerHTML = '';

    const stop = STOP_BY_ID[result.stopId];
    const backdrop = el('div', 'modal-backdrop');
    const card = el('div', 'storybook-panel modal-card pop-in');

    card.append(
      el(
        'div',
        'wood-ribbon',
        result.starsEarned >= 1 ? `${stop.shortName} COMPLETE!` : 'ALMOST THERE, CHEFS!',
      ),
    );

    const starRow = el(
      'div',
      'celebration-stars',
      `${'★'.repeat(result.starsEarned)}${'☆'.repeat(3 - result.starsEarned)}`,
    );
    card.append(starRow);

    const summary = el(
      'div',
      '',
      `Customers Served: ${result.servedCount}  •  1★ Target: ${result.targets.oneStar}`,
    );
    summary.style.fontWeight = '800';
    summary.style.fontSize = '19px';
    card.append(summary);

    const totalRoadScore = this.roomState?.trip.totalScore ?? result.score;
    const scoreLine = el(
      'div',
      '',
      `Round Score: +${(result.score ?? 0).toLocaleString()} pts  •  Total Road Trip: ${totalRoadScore.toLocaleString()} pts`,
    );
    scoreLine.style.fontWeight = '800';
    scoreLine.style.fontSize = '19px';
    scoreLine.style.color = '#6d28d9';
    card.append(scoreLine);

    if (result.unlockedNextStopId) {
      const nextStop = STOP_BY_ID[result.unlockedNextStopId];
      card.append(
        el(
          'div',
          'info-banner',
          `New Destination Unlocked: ${nextStop.name}! (Progress Auto-Saved)`,
        ),
      );
    } else if (result.starsEarned === 0) {
      const enc = el(
        'p',
        '',
        `Great teamwork! Serve ${result.targets.oneStar} customers next time to earn 1 Star and drive the purple van to the next stop!`,
      );
      enc.style.margin = '0';
      enc.style.fontSize = '17px';
      enc.style.fontWeight = '700';
      card.append(enc);
    } else {
      card.append(el('div', 'info-banner', 'Road trip stars auto-saved!'));
    }

    const btnRow = el('div', 'btn-row');
    btnRow.style.width = '100%';

    const retryBtn = el('button', 'tactile-btn btn-gold', 'Cook Again!');
    retryBtn.addEventListener('click', () => {
      void this.socket.startShift(result.stopId);
    });

    const mapBtn = el('button', 'tactile-btn btn-green', 'Back to US Map →');
    mapBtn.addEventListener('click', () => {
      this.socket.openMap();
    });

    btnRow.append(retryBtn, mapBtn);
    card.append(btnRow);
    backdrop.append(card);
    host.append(backdrop);
  }

  private getHeldItemSpritePath(item: HeldItem | null): string | null {
    if (!item) return null;
    if (item.kind === 'plated' && item.recipeId) {
      return RECIPE_BY_ID[item.recipeId]?.spritePath ?? null;
    }
    if (item.ingredientId) {
      return INGREDIENT_BY_ID[item.ingredientId]?.spritePath ?? null;
    }
    return null;
  }

  private getHeldItemLabel(item: HeldItem | null): string {
    if (!item) return 'Empty Hands';
    if (item.kind === 'plated' && item.recipeId) {
      return RECIPE_BY_ID[item.recipeId]?.shortName ?? 'Ready Dish';
    }
    if (item.kind === 'cooked' && item.ingredientId) {
      return `Cooked ${INGREDIENT_BY_ID[item.ingredientId].shortName}`;
    }
    if (item.ingredientId) {
      return INGREDIENT_BY_ID[item.ingredientId].shortName;
    }
    return 'Item';
  }

  private spawnBurst(x: number, y: number, colors: string[], count: number): void {
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const spd = 1.4 + Math.random() * 3.4;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 1.2,
        size: 4 + Math.random() * 5,
        color: colors[i % colors.length] ?? '#ffe066',
        life: 1,
        maxLife: 0.7 + Math.random() * 0.5,
      });
    }
  }

  private startLoop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    const frame = () => {
      this.draw();
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  private draw(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const snap = this.snapshot;
    if (!canvas || !ctx || !snap) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 1024;
    const h = canvas.clientHeight || 640;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    this.tick += 0.05;

    // 1. Full-Bleed Painted 2.5D Regional Kitchen Arena Backdrop
    const stop = STOP_BY_ID[snap.stopId];
    const bgImg = this.getImg(stop.sceneBgPath);
    if (bgImg) {
      const rect = getCoverImageRect(w, h, bgImg.naturalWidth / bgImg.naturalHeight);
      ctx.drawImage(bgImg, rect.ox, rect.oy, rect.rw, rect.rh);
    } else {
      ctx.fillStyle = '#c9884b';
      ctx.fillRect(0, 0, w, h);
    }

    // Interpolate chef positions smoothly at 60fps
    for (const chef of snap.chefs) {
      const prev = this.renderPos.get(chef.playerId);
      if (!prev) {
        this.renderPos.set(chef.playerId, { x: chef.x, y: chef.y });
      } else {
        prev.x += (chef.x - prev.x) * 0.28;
        prev.y += (chef.y - prev.y) * 0.28;
      }
    }

    const meChef = snap.chefs.find((c) => c.playerId === this.meId);
    const hint = meChef?.kidHelper ? computeGuidanceHint(snap, this.meId) : null;
    const targetStation = hint ? snap.stations.find((s) => s.id === hint.targetStationId) : null;

    // 2. Kid Helper Glowing Dotted Breadcrumb Trail on the Wooden Deck
    if (meChef && targetStation && snap.status === 'running') {
      const rp = this.renderPos.get(meChef.playerId) ?? { x: meChef.x, y: meChef.y };
      const fromPt = this.gridToScreen(rp.x, rp.y, w, h);
      const toPt = this.gridToScreen(targetStation.gridX, targetStation.gridY, w, h);

      ctx.save();
      ctx.strokeStyle = hint?.isParentPing ? '#c084fc' : '#ffe066';
      ctx.shadowColor = hint?.isParentPing ? '#9333ea' : '#f59e0b';
      ctx.shadowBlur = 10;
      ctx.lineWidth = 6;
      ctx.setLineDash([4, 15]);
      ctx.lineDashOffset = -this.tick * 24;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(fromPt.x, fromPt.y + 8);
      ctx.quadraticCurveTo(
        (fromPt.x + toPt.x) / 2,
        (fromPt.y + toPt.y) / 2 + 24,
        toPt.x,
        toPt.y,
      );
      ctx.stroke();
      ctx.restore();
    }

    // 3. Y-Depth Sorted Draw List (Stations + Chefs naturally overlap in true 2.5D!)
    type DrawItem = { sortY: number; draw: () => void };
    const drawList: DrawItem[] = [];

    for (const st of snap.stations) {
      const sp = this.gridToScreen(st.gridX, st.gridY, w, h);
      const isGuided = targetStation?.id === st.id;
      const isPinged = Boolean(snap.ping && snap.ping.stationId === st.id && snap.ping.expiresAtMs > snap.serverTimeMs);

      drawList.push({
        sortY: sp.y,
        draw: () => this.drawStation(ctx, st, sp.x, sp.y, isGuided, isPinged),
      });
    }

    for (const chef of snap.chefs) {
      const rp = this.renderPos.get(chef.playerId) ?? { x: chef.x, y: chef.y };
      const cp = this.gridToScreen(rp.x, rp.y, w, h);
      const isEmoting = chef.emoteUntilMs > snap.serverTimeMs;
      const emoteElapsed = Math.max(0, 1 - (chef.emoteUntilMs - snap.serverTimeMs) / ANIMAL_BY_ID[chef.animalId].emoteDurationMs);

      drawList.push({
        sortY: cp.y + 6,
        draw: () =>
          this.drawChef(
            ctx,
            chef,
            cp.x,
            cp.y,
            chef.playerId === this.meId,
            isEmoting,
            emoteElapsed,
          ),
      });
    }

    drawList.sort((a, b) => a.sortY - b.sortY);
    for (const item of drawList) {
      item.draw();
    }

    // 4. Particles (Confetti, Steam, Sparkles, Emote Bubbles)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06;
      p.life -= 0.025 / p.maxLife;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 5. Floating "+150 pts!" Score Popups
    for (let i = this.floatingPopups.length - 1; i >= 0; i--) {
      const pop = this.floatingPopups[i]!;
      pop.y -= 1.05;
      pop.life -= 0.018;
      if (pop.life <= 0) {
        this.floatingPopups.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.min(1, pop.life * 1.6);
      ctx.font = '900 22px "Fredoka", "Arial Rounded MT Bold", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#42220d';
      ctx.strokeText(pop.text, pop.x, pop.y);
      ctx.fillStyle = '#ffe066';
      ctx.fillText(pop.text, pop.x, pop.y);
      ctx.restore();
    }

    ctx.restore();
  }

  private drawStation(
    ctx: CanvasRenderingContext2D,
    st: StationState,
    x: number,
    y: number,
    isGuided: boolean,
    isPinged: boolean,
  ): void {
    ctx.save();

    // Serve Window: glowing emerald service counter aligned to the Purple Van on the right!
    if (st.kind === 'serve_window') {
      const pulse = 0.75 + Math.sin(this.tick * 3.5) * 0.25;
      ctx.save();
      ctx.shadowColor = '#22c55e';
      ctx.shadowBlur = isGuided ? 26 : 16;
      ctx.fillStyle = `rgba(74, 222, 128, ${0.26 * pulse})`;
      ctx.strokeStyle = isGuided ? '#ffe066' : '#4ade80';
      ctx.lineWidth = isGuided ? 5 : 3.5;
      this.roundRect(ctx, x - 44, y - 48, 88, 96, 18);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Label pill
      this.drawLabelPill(ctx, x, y + 54, 'SERVE HERE', isGuided ? '#42220d' : '#14532d', '#fffdf7');

      if (isGuided || isPinged) {
        this.drawBouncingStar(ctx, x, y - 62, isPinged ? '#c084fc' : '#ffe066');
      }
      ctx.restore();
      return;
    }

    // Soft grounded shadow under painted furniture
    ctx.fillStyle = 'rgba(42, 20, 6, 0.30)';
    ctx.beginPath();
    ctx.ellipse(x, y + 32, 46, 15, 0, 0, Math.PI * 2);
    ctx.fill();

    // Glowing highlight ring for Kid Helper / Adult Ping target
    if (isGuided || isPinged) {
      const pulse = Math.sin(this.tick * 4) * 4;
      ctx.save();
      ctx.strokeStyle = isPinged ? '#c084fc' : '#ffe066';
      ctx.shadowColor = isPinged ? '#9333ea' : '#f59e0b';
      ctx.shadowBlur = 16;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.ellipse(x, y + 28, 52 + pulse, 20 + pulse * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Painted 2.5D Station Sprite
    const stImg = this.getImg(STATION_SPRITE_PATHS[st.kind]);
    if (stImg) {
      const sz = st.kind === 'counter' ? 104 : 96;
      ctx.drawImage(stImg, x - sz / 2, y - sz / 2, sz, sz);
    }

    // Crate Ingredient Badge perched right on the wooden crate!
    if (st.kind === 'crate' && st.ingredientId) {
      const ingImg = this.getImg(INGREDIENT_BY_ID[st.ingredientId].spritePath);
      if (ingImg) {
        ctx.drawImage(ingImg, x - 31, y - 42, 62, 62);
      }
    }

    // Item currently sitting on cook station or pass counter
    if (st.item) {
      const itemSpritePath = this.getHeldItemSpritePath(st.item);
      const itemImg = this.getImg(itemSpritePath ?? undefined);
      if (itemImg) {
        const hover = st.item.kind === 'plated' ? Math.sin(this.tick * 4) * 3 : 0;
        if (st.item.kind === 'plated' || (st.item.kind === 'cooked' && !st.cookingActive)) {
          ctx.save();
          ctx.shadowColor = st.item.kind === 'plated' ? '#4ade80' : '#ffe066';
          ctx.shadowBlur = 14;
          ctx.drawImage(itemImg, x - 28, y - 46 + hover, 56, 56);
          ctx.restore();
        } else {
          ctx.drawImage(itemImg, x - 26, y - 44, 52, 52);
        }
      }
    }

    // Live cooking / prep progress arc + gentle steam wisps
    if (st.cookingActive) {
      ctx.save();
      ctx.fillStyle = 'rgba(66, 34, 13, 0.78)';
      ctx.beginPath();
      ctx.arc(x + 30, y - 34, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x + 30, y - 34, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * st.cookProgress);
      ctx.stroke();
      ctx.restore();

      if (Math.random() < 0.16) {
        this.particles.push({
          x: x + (Math.random() - 0.5) * 20,
          y: y - 34,
          vx: (Math.random() - 0.5) * 0.4,
          vy: -1.1 - Math.random() * 0.6,
          size: 6,
          color: 'rgba(255,255,255,0.85)',
          life: 0.75,
          maxLife: 0.8,
        });
      }
    }

    // Crisp compact label pill below station
    this.drawLabelPill(
      ctx,
      x,
      y + 42,
      st.label,
      isGuided ? '#42220d' : 'rgba(255, 253, 246, 0.92)',
      isGuided ? '#ffe066' : '#42220d',
    );

    if (isGuided || isPinged) {
      this.drawBouncingStar(ctx, x, y - 58, isPinged ? '#c084fc' : '#ffe066');
    }

    ctx.restore();
  }

  private drawChef(
    ctx: CanvasRenderingContext2D,
    chef: ChefEntity,
    x: number,
    y: number,
    isMe: boolean,
    isEmoting: boolean,
    emoteProgress: number,
  ): void {
    const animal = ANIMAL_BY_ID[chef.animalId];
    const sprite = this.getImg(animal.spritePath);
    const emoteSprite = this.getImg(animal.emoteSpritePath);

    ctx.save();

    // Grounded contact shadow (smaller & lower underneath hovering Small Cute Purple Bat!)
    const shadowScale = animal.isSmall ? 0.72 : 1.0;
    ctx.fillStyle = 'rgba(42, 20, 6, 0.34)';
    ctx.beginPath();
    ctx.ellipse(x, y + 32, 30 * shadowScale, 11 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Player ownership ring on the deck
    if (isMe) {
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.ellipse(x, y + 32, 35 * shadowScale, 13 * shadowScale, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 60fps squash-and-stretch + Purple Bat gentle hover + Animal Emote motion!
    const walkBounce = chef.moving ? Math.abs(Math.sin(this.tick * 5)) * 7 : Math.sin(this.tick * 2) * 1.5;
    const batHover = animal.hovers ? 14 + Math.sin(this.tick * 4.5) * 6 : 0;
    let rot = chef.moving ? Math.sin(this.tick * 5) * 0.08 : 0;
    let scaleX = chef.facing === 'left' ? -1 : 1;
    let scaleY = 1;

    if (isEmoting) {
      if (chef.animalId === 'orange_dog') {
        rot = emoteProgress * Math.PI * 4; // Joyful 360° spin!
      } else if (chef.animalId === 'purple_bat') {
        rot = Math.sin(emoteProgress * Math.PI * 2) * 0.65; // Cute mid-air flutter flip!
      } else if (chef.animalId === 'skunk') {
        rot = Math.sin(emoteProgress * Math.PI * 8) * 0.16; // Cheeky wiggle!
      } else if (chef.animalId === 'panda') {
        scaleY = 1 + Math.sin(emoteProgress * Math.PI * 10) * 0.08; // Happy munch bob!
      }
    }

    const baseSize = animal.isSmall ? 84 : 106;
    ctx.save();
    ctx.translate(x, y - 10 - walkBounce - batHover);
    ctx.rotate(rot);
    ctx.scale(scaleX, scaleY);
    if (sprite) {
      ctx.drawImage(sprite, -baseSize / 2, -baseSize / 2, baseSize, baseSize);
    }
    ctx.restore();

    // Signature Animal Behavior Emote Sprite Overlay!
    if (isEmoting && emoteSprite) {
      const floatUp = emoteProgress * 26;
      const popScale = 0.75 + Math.sin(Math.min(1, emoteProgress * 2) * Math.PI * 0.5) * 0.4;
      const emSize = 68 * popScale;
      // Skunk fart puff appears behind its fluffy tail; others float joyfully near head/hands!
      const ox = chef.animalId === 'skunk' ? (chef.facing === 'left' ? 42 : -42) : 28;
      const oy = chef.animalId === 'skunk' ? -4 - floatUp * 0.5 : -52 - floatUp;

      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, emoteProgress - 0.7) * 3.3);
      ctx.drawImage(emoteSprite, x + ox - emSize / 2, y + oy - emSize / 2, emSize, emSize);
      ctx.restore();
    }

    // Held Item Bubble floating cleanly in front of chef
    if (chef.holding) {
      const heldPath = this.getHeldItemSpritePath(chef.holding);
      const heldImg = this.getImg(heldPath ?? undefined);
      const hx = x + (chef.facing === 'left' ? -36 : 36);
      const hy = y - 18 - batHover;

      ctx.fillStyle = '#fffdf6';
      ctx.strokeStyle = chef.holding.kind === 'plated' ? '#22c55e' : '#7c4a26';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(hx, hy, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (heldImg) {
        ctx.drawImage(heldImg, hx - 18, hy - 18, 36, 36);
      }
    }

    // Name Tag Pill
    this.drawLabelPill(
      ctx,
      x,
      y + 46,
      isMe ? `${chef.name} (You)` : chef.name,
      isMe ? '#42220d' : 'rgba(255, 253, 246, 0.94)',
      isMe ? '#ffe066' : '#42220d',
    );

    ctx.restore();
  }

  private drawBouncingStar(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    const bounce = Math.sin(this.tick * 4.5) * 7;
    ctx.save();
    ctx.translate(x, y + bounce);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 15 : 7;
      const a = (Math.PI * i) / 5 - Math.PI / 2;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawLabelPill(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    text: string,
    bg: string,
    fg: string,
  ): void {
    ctx.save();
    ctx.font = '800 14.5px sans-serif';
    const tw = ctx.measureText(text).width + 18;
    ctx.fillStyle = bg;
    ctx.strokeStyle = '#7c4a26';
    ctx.lineWidth = 2;
    this.roundRect(ctx, cx - tw / 2, cy - 12, tw, 24, 11);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy + 0.5);
    ctx.restore();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
