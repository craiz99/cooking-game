import { ANIMAL_BY_ID, INGREDIENT_BY_ID } from '@shared/animals';
import { STOPS, STOP_BY_ID } from '@shared/stops';
import type { RoomStatePayload, StopId } from '@shared/types';
import { musicEngine } from '../audio/musicEngine';
import { soundEngine } from '../audio/soundEngine';
import { assetUrl } from '../net/assets';
import type { IGameTransport } from '../net/transport';
import { isMapWater } from './mapWaterMask';
import {
  SILLY_ROAD_TRIP_EVENTS,
  type SillyRoadTripEvent,
  canPlayStop,
  clampMapPos,
  pickSillyRoadTripEvent,
} from './roadTripEvents';

/**
 * Calibrated normalized positions matching our painted art_us_map_bg.webp so:
 * - Sharon, MA sits in Massachusetts, NYC on the coast, Chicago at Lake Michigan
 * - Austin sits in central Texas, Denver sits squarely in Colorado Rockies
 * - Yosemite (#6), Lake Tahoe (#7), and Mountain View (#8) ALL sit accurately inside California!
 */
export const MAP_PIN_COORDS: Record<StopId, { nx: number; ny: number }> = {
  sharon: { nx: 0.858, ny: 0.305 },
  nyc: { nx: 0.832, ny: 0.365 },
  chicago: { nx: 0.638, ny: 0.375 },
  austin: { nx: 0.495, ny: 0.768 },
  denver: { nx: 0.362, ny: 0.470 },
  yosemite: { nx: 0.165, ny: 0.502 },
  tahoe: { nx: 0.160, ny: 0.405 },
  mountainview: { nx: 0.121, ny: 0.486 },
};

const STATION_ICONS: Record<string, string> = {
  prep_board: '/assets/stations/station_prep_board.png',
  stove_pot: '/assets/stations/station_stove_pot.png',
  grill_fryer: '/assets/stations/station_grill_fryer.png',
};

const RAFT_DEPLOY_EVENT: SillyRoadTripEvent = {
  id: 'water_raft_deploy',
  headline: 'SPLASH! Inflatable Life Raft Deployed!',
  spritePath: '/assets/chefs/purple_van_raft.png',
  sound: 'pickup',
  colors: ['#38bdf8', '#7dd3fc', '#ffffff', '#fb923c'],
};

interface MapSparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  life: number;
}

interface WaterRipple {
  x: number;
  y: number;
  rx: number;
  ry: number;
  life: number;
}

interface ActiveSillyEvent {
  event: SillyRoadTripEvent;
  startedAtMs: number;
  durationMs: number;
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

export class RoadTripMapScreen {
  private container: HTMLElement;
  private socket: IGameTransport;
  private roomState: RoomStatePayload | null = null;
  private inspectedStopId: StopId = 'sharon';
  private rafId: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private mapImg = new Image();
  private vanImg = new Image();
  private raftImg = new Image();
  private dishImgs = new Map<string, HTMLImageElement>();
  private eventImgs = new Map<string, HTMLImageElement>();

  // Free-roam Purple Van coordinates across the entire US map!
  private vanPos = { nx: MAP_PIN_COORDS.sharon.nx, ny: MAP_PIN_COORDS.sharon.ny };
  private vanTarget = { nx: MAP_PIN_COORDS.sharon.nx, ny: MAP_PIN_COORDS.sharon.ny };
  private vanFacingEast = false;
  private wasOnWater = false;
  private raftInflate = 0; // 0 = dry land, 1 = fully inflated floating life raft
  private roamDistance = 0;
  private lastEventId: string | null = null;
  private lastEventAtMs = 0;
  private activeSilly: ActiveSillyEvent | null = null;
  private keys = new Set<string>();
  private tick = 0;
  private dustPuffs: Array<{ x: number; y: number; r: number; life: number }> = [];
  private waterRipples: WaterRipple[] = [];
  private sparkles: MapSparkle[] = [];

  constructor(container: HTMLElement, socket: IGameTransport) {
    this.container = container;
    this.socket = socket;
    this.mapImg.src = assetUrl('/assets/scenes/us_map_bg.webp');
    this.vanImg.src = assetUrl('/assets/chefs/purple_van.png');
    this.raftImg.src = assetUrl('/assets/chefs/purple_van_raft.png');
    this.eventImgs.set(RAFT_DEPLOY_EVENT.id, this.raftImg);

    for (const stop of STOPS) {
      const firstDish = stop.recipes[0];
      if (firstDish) {
        const img = new Image();
        img.src = assetUrl(firstDish.spritePath);
        this.dishImgs.set(stop.id, img);
      }
    }
    for (const ev of SILLY_ROAD_TRIP_EVENTS) {
      const img = new Image();
      img.src = assetUrl(ev.spritePath);
      this.eventImgs.set(ev.id, img);
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      this.keys.add(k);
    } else if (k === ' ') {
      e.preventDefault();
      this.triggerSillyRoadTripEvent();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  mount(state: RoomStatePayload): void {
    const prevStop = this.roomState?.vanStopId;
    this.roomState = state;
    const pin = MAP_PIN_COORDS[state.vanStopId] ?? MAP_PIN_COORDS.sharon;
    if (!prevStop) {
      this.vanPos = { nx: pin.nx, ny: pin.ny };
      this.vanTarget = { nx: pin.nx, ny: pin.ny };
      this.inspectedStopId = state.vanStopId;
    } else if (prevStop !== state.vanStopId) {
      this.vanTarget = { nx: pin.nx, ny: pin.ny };
      this.inspectedStopId = state.vanStopId;
    }

    this.renderShell();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.startLoop();
  }

  update(state: RoomStatePayload): void {
    const vanChanged = this.roomState?.vanStopId !== state.vanStopId;
    this.roomState = state;
    if (vanChanged) {
      const pin = MAP_PIN_COORDS[state.vanStopId] ?? MAP_PIN_COORDS.sharon;
      this.vanTarget = { nx: pin.nx, ny: pin.ny };
      this.inspectedStopId = state.vanStopId;
    }
    this.renderDrawer();
    this.renderTopBar();
  }

  unmount(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.keys.clear();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private renderShell(): void {
    this.container.innerHTML = '';
    const screen = el('div', 'map-screen');

    const topbar = el('div', 'map-topbar');
    topbar.id = 'map-topbar';
    screen.append(topbar);

    const canvasWrap = el('div', 'map-canvas-wrap');
    const canvas = el('canvas', 'map-canvas');
    canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
    canvasWrap.append(canvas);
    screen.append(canvasWrap);

    const drawer = el('div', 'storybook-panel map-bottom-drawer');
    drawer.id = 'map-bottom-drawer';
    screen.append(drawer);

    this.container.append(screen);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.renderTopBar();
    this.renderDrawer();
  }

  private renderTopBar(): void {
    const topbar = this.container.querySelector('#map-topbar');
    const state = this.roomState;
    if (!topbar || !state) return;
    topbar.innerHTML = '';

    const leftNav = el('div');
    leftNav.style.display = 'flex';
    leftNav.style.alignItems = 'center';
    leftNav.style.gap = '8px';

    const backBtn = el('button', 'tactile-btn btn-cream', '← Chefs');
    backBtn.style.padding = '7px 13px';
    backBtn.style.fontSize = '16px';
    backBtn.addEventListener('click', () => this.socket.returnToLobby());

    const musicOn = musicEngine.isEnabled && !soundEngine.muted;
    const musicBtn = el(
      'button',
      `tactile-btn ${musicOn ? 'btn-green' : 'btn-cream'}`,
      'Music',
    );
    musicBtn.style.padding = '7px 12px';
    musicBtn.style.fontSize = '16px';
    musicBtn.addEventListener('click', () => {
      soundEngine.unlock();
      musicEngine.toggle();
      this.renderTopBar();
    });

    leftNav.append(backBtn, musicBtn);
    topbar.append(leftNav);

    topbar.append(el('div', 'wood-ribbon', 'USA ROAD TRIP'));

    const right = el('div', 'map-crew-bar');
    const totalStars = Object.values(state.trip.starsByStop).reduce((a, b) => a + (b ?? 0), 0);
    right.append(
      el('div', 'map-star-pill', `★ ${totalStars}/24`),
      el('div', 'map-star-pill', `${(state.trip.totalScore ?? 0).toLocaleString()} pts`),
    );

    for (const p of state.players) {
      const chip = el('div', 'crew-chip');
      const img = el('img');
      img.src = assetUrl(ANIMAL_BY_ID[p.animalId].spritePath);
      img.alt = p.name;
      chip.append(img, el('span', '', p.name));
      right.append(chip);
    }
    topbar.append(right);
  }

  private renderDrawer(): void {
    const drawer = this.container.querySelector('#map-bottom-drawer');
    const state = this.roomState;
    if (!drawer || !state) return;
    drawer.innerHTML = '';

    const stop = STOP_BY_ID[this.inspectedStopId];
    const isUnlocked = canPlayStop(state.trip.unlockedStopIds, stop.id);
    const stars = state.trip.starsByStop[stop.id] ?? 0;

    const topRow = el('div', 'map-drawer-top');
    const titleRow = el('div', 'map-stop-title-row');
    titleRow.append(
      el('span', 'stop-num-badge', `STOP ${stop.index}/8`),
      el('span', 'map-stop-title', stop.shortName),
      el(
        'span',
        'map-stop-stars',
        isUnlocked ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}` : 'Locked',
      ),
    );
    topRow.append(titleRow);

    const actions = el('div', 'map-actions-row');
    const sillyBtn = el('button', 'tactile-btn btn-purple', 'Honk!');
    sillyBtn.style.fontSize = '16px';
    sillyBtn.style.padding = '8px 13px';
    sillyBtn.addEventListener('click', () => {
      soundEngine.unlock();
      this.triggerSillyRoadTripEvent();
    });
    actions.append(sillyBtn);

    const paceBtn = el(
      'button',
      'tactile-btn btn-cream',
      state.trip.pace === 'cozy' ? 'Cozy' : 'Fast',
    );
    paceBtn.style.fontSize = '16px';
    paceBtn.style.padding = '8px 13px';
    paceBtn.addEventListener('click', () => {
      this.socket.setPace(state.trip.pace === 'cozy' ? 'rush' : 'cozy');
    });
    actions.append(paceBtn);

    const cookBtn = el(
      'button',
      `tactile-btn ${isUnlocked ? 'btn-green' : 'btn-cream'}`,
      isUnlocked ? 'Cook!' : `Win Stop ${stop.index - 1}`,
    );
    cookBtn.style.fontSize = '19px';
    cookBtn.style.padding = '9px 22px';
    cookBtn.disabled = !isUnlocked;
    cookBtn.addEventListener('click', () => {
      soundEngine.unlock();
      soundEngine.playVanHonk();
      void this.socket.startShift(stop.id);
    });
    actions.append(cookBtn);

    topRow.append(actions);
    drawer.append(topRow);

    // Picture-first menu cards (short 1-2 word names + illustrated step equations)
    const menuGrid = el('div', 'map-menu-grid');
    for (const recipe of stop.recipes) {
      const card = el('div', 'menu-dish-card');
      const dishImg = el('img', 'menu-dish-img');
      dishImg.src = assetUrl(recipe.spritePath);
      dishImg.alt = recipe.shortName;
      card.append(dishImg);

      const info = el('div', 'menu-dish-info');
      info.append(el('div', 'menu-dish-name', recipe.shortName));

      const steps = el('div', 'menu-step-icons');
      const baseImg = el('img');
      baseImg.src = assetUrl(INGREDIENT_BY_ID[recipe.baseIngredient].spritePath);
      baseImg.alt = INGREDIENT_BY_ID[recipe.baseIngredient].shortName;
      steps.append(baseImg, el('span', '', '→'));

      const stImg = el('img');
      stImg.src = assetUrl(STATION_ICONS[recipe.cookStation] ?? '/assets/stations/station_stove_pot.png');
      stImg.alt = recipe.cookStation;
      steps.append(stImg);

      if (recipe.toppingIngredient) {
        const topImg = el('img');
        topImg.src = assetUrl(INGREDIENT_BY_ID[recipe.toppingIngredient].spritePath);
        topImg.alt = INGREDIENT_BY_ID[recipe.toppingIngredient].shortName;
        steps.append(el('span', '', '+'), topImg);
      }
      info.append(steps);
      card.append(info);
      menuGrid.append(card);
    }
    drawer.append(menuGrid);
  }

  private getMapDrawRect(w: number, h: number): { ox: number; oy: number; rw: number; rh: number } {
    const aspect = 1376 / 768;
    let rw = w;
    let rh = w / aspect;
    if (rh < h) {
      rh = h;
      rw = h * aspect;
    }
    return { ox: (w - rw) / 2, oy: (h - rh) / 2, rw, rh };
  }

  private getPinScreenPos(stopId: StopId, w: number, h: number): { x: number; y: number } {
    const rect = this.getMapDrawRect(w, h);
    const pt = MAP_PIN_COORDS[stopId];
    return {
      x: rect.ox + pt.nx * rect.rw,
      y: rect.oy + pt.ny * rect.rh,
    };
  }

  private getRoutePoint(t: number, w: number, h: number): { x: number; y: number } {
    const clamped = Math.max(0, Math.min(STOPS.length - 1, t));
    const idx = Math.min(Math.floor(clamped), STOPS.length - 2);
    const frac = clamped - idx;
    const a = this.getPinScreenPos(STOPS[idx]!.id, w, h);
    const b = this.getPinScreenPos(STOPS[idx + 1]!.id, w, h);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 - 26;
    const inv = 1 - frac;
    return {
      x: inv * inv * a.x + 2 * inv * frac * mx + frac * frac * b.x,
      y: inv * inv * a.y + 2 * inv * frac * my + frac * frac * b.y,
    };
  }

  private getVanScreenPos(w: number, h: number): { x: number; y: number } {
    const rect = this.getMapDrawRect(w, h);
    return {
      x: rect.ox + this.vanPos.nx * rect.rw,
      y: rect.oy + this.vanPos.ny * rect.rh,
    };
  }

  private triggerSillyRoadTripEvent(): void {
    const now = Date.now();
    const ev = pickSillyRoadTripEvent(this.vanPos.nx, this.vanPos.ny, this.lastEventId);
    this.lastEventId = ev.id;
    this.lastEventAtMs = now;
    this.activeSilly = {
      event: ev,
      startedAtMs: now,
      durationMs: 3600,
    };

    if (ev.sound === 'honk') {
      soundEngine.playVanHonk();
    } else if (ev.sound === 'serve') {
      soundEngine.playServe();
    } else if (ev.sound === 'combine') {
      soundEngine.playCombine();
    } else if (ev.sound === 'pickup') {
      soundEngine.playPickup();
    } else {
      soundEngine.playAnimalEmote(ev.sound);
    }

    const canvas = this.canvas;
    const cssW = canvas?.clientWidth || 1000;
    const cssH = canvas?.clientHeight || 500;
    const pt = this.getVanScreenPos(cssW, cssH);
    for (let i = 0; i < 20; i++) {
      const ang = (Math.PI * 2 * i) / 20 + Math.random() * 0.3;
      const spd = 1.4 + Math.random() * 2.8;
      this.sparkles.push({
        x: pt.x,
        y: pt.y - 16,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 1.1,
        r: 4 + Math.random() * 4,
        color: ev.colors[i % ev.colors.length] ?? '#ffe066',
        life: 1,
      });
    }
  }

  private handleCanvasClick(e: MouseEvent): void {
    if (!this.canvas || !this.roomState) return;
    soundEngine.unlock();
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // 1) Tapping directly on the Purple Van triggers a silly road-trip surprise!
    const vanScreen = this.getVanScreenPos(rect.width, rect.height);
    if (Math.hypot(cx - vanScreen.x, cy - (vanScreen.y - 14)) <= 40) {
      this.triggerSillyRoadTripEvent();
      return;
    }

    // 2) Tapping any of the 8 city pins drives the Purple Van over to inspect it
    // (sequential 1-star unlocking is still enforced on the Cook button!)
    for (const stop of STOPS) {
      const pos = this.getPinScreenPos(stop.id, rect.width, rect.height);
      if (Math.hypot(cx - pos.x, cy - pos.y) <= 38) {
        this.inspectedStopId = stop.id;
        const pin = MAP_PIN_COORDS[stop.id];
        this.vanTarget = { nx: pin.nx, ny: pin.ny };
        if (canPlayStop(this.roomState.trip.unlockedStopIds, stop.id)) {
          soundEngine.playVanHonk();
          void this.socket.driveVan(stop.id);
        } else {
          soundEngine.playPickup();
        }
        this.renderDrawer();
        return;
      }
    }

    // 3) Free-roam driving: tap ANYWHERE on the US map to cruise there!
    const mapRect = this.getMapDrawRect(rect.width, rect.height);
    const nx = (cx - mapRect.ox) / mapRect.rw;
    const ny = (cy - mapRect.oy) / mapRect.rh;
    this.vanTarget = clampMapPos(nx, ny);
    soundEngine.playPickup();
  }

  private startLoop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    const step = () => {
      this.draw();
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  private draw(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const state = this.roomState;
    if (!canvas || !ctx || !state) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || 1000;
    const cssH = canvas.clientHeight || 500;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    this.tick += 0.04;

    // Keyboard free-roam steering (WASD / Arrow keys)
    let kdx = 0;
    let kdy = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) kdy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) kdy += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) kdx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) kdx += 1;
    if (kdx !== 0 || kdy !== 0) {
      const klen = Math.hypot(kdx, kdy);
      const next = clampMapPos(
        this.vanPos.nx + (kdx / klen) * 0.0045,
        this.vanPos.ny + (kdy / klen) * 0.0055,
      );
      this.vanTarget = next;
    }

    // Advance purple van freely across the entire US map!
    const nowMs = Date.now();
    if (this.activeSilly && nowMs - this.activeSilly.startedAtMs > this.activeSilly.durationMs) {
      this.activeSilly = null;
    }

    const dx = this.vanTarget.nx - this.vanPos.nx;
    const dy = this.vanTarget.ny - this.vanPos.ny;
    const dist = Math.hypot(dx, dy);
    const isDriving = dist > 0.003;
    if (isDriving) {
      const turbo = this.activeSilly?.event.turboBoost ? 1.55 : 1.0;
      const step = Math.min(dist, 0.0052 * turbo);
      if (Math.abs(dx) > 0.001) {
        this.vanFacingEast = dx > 0;
      }
      this.vanPos.nx += (dx / dist) * step;
      this.vanPos.ny += (dy / dist) * step;
      this.roamDistance += step;

      // Trigger a fun random silly road-trip surprise as the player explores the US!
      if (this.roamDistance >= 0.24 && nowMs - this.lastEventAtMs >= 4500) {
        this.roamDistance = 0;
        this.triggerSillyRoadTripEvent();
      }
    } else {
      this.vanPos.nx = this.vanTarget.nx;
      this.vanPos.ny = this.vanTarget.ny;
    }

    // 1. Painted US Storybook Map Backdrop
    const rect = this.getMapDrawRect(cssW, cssH);
    if (this.mapImg.complete && this.mapImg.naturalWidth > 0) {
      ctx.drawImage(this.mapImg, rect.ox, rect.oy, rect.rw, rect.rh);
    } else {
      ctx.fillStyle = '#8cc7e8';
      ctx.fillRect(0, 0, cssW, cssH);
    }

    // 2. Golden Highway Route (unlocked glowing gold vs locked misty trail)
    const maxUnlockedIdx = STOPS.reduce(
      (acc, s, idx) => (state.trip.unlockedStopIds.includes(s.id) ? Math.max(acc, idx) : acc),
      0,
    );

    for (let seg = 0; seg < STOPS.length - 1; seg++) {
      const segUnlocked = seg < maxUnlockedIdx;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= 28; i++) {
        const pt = this.getRoutePoint(seg + i / 28, cssW, cssH);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = segUnlocked ? '#7c450d' : 'rgba(72, 54, 38, 0.35)';
      ctx.lineWidth = 11;
      ctx.stroke();

      ctx.strokeStyle = segUnlocked ? '#ffd24d' : 'rgba(235, 224, 200, 0.55)';
      ctx.lineWidth = 6.5;
      ctx.stroke();

      ctx.setLineDash([8, 9]);
      ctx.lineDashOffset = segUnlocked ? -this.tick * 14 : 0;
      ctx.strokeStyle = segUnlocked ? '#fffbe0' : 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // 3. Stop Pins (Accurate California & Colorado placement!)
    for (const stop of STOPS) {
      const pos = this.getPinScreenPos(stop.id, cssW, cssH);
      const isUnlocked = state.trip.unlockedStopIds.includes(stop.id);
      const isSelected = this.inspectedStopId === stop.id;
      const stars = state.trip.starsByStop[stop.id] ?? 0;

      if (isSelected) {
        const pulse = Math.sin(this.tick * 3.5) * 4;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 23 + pulse, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 224, 102, 0.55)';
        ctx.fill();
      }

      // Pin base circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 18, 0, Math.PI * 2);
      ctx.fillStyle = isSelected
        ? '#7c3aed'
        : isUnlocked
          ? stars > 0
            ? '#2ca825'
            : '#ea580c'
          : '#78716c';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fffdf7';
      ctx.stroke();

      // Number or lock
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isUnlocked ? String(stop.index) : '×', pos.x, pos.y + 0.5);

      // Tiny signature dish badge peeking upper-right of pin
      const dishImg = this.dishImgs.get(stop.id);
      if (dishImg?.complete && dishImg.naturalWidth > 0) {
        ctx.save();
        ctx.globalAlpha = isUnlocked ? 1 : 0.45;
        ctx.drawImage(dishImg, pos.x + 10, pos.y - 34, 30, 30);
        ctx.restore();
      }

      // Label Pill (offset slightly for tight California stops so labels NEVER overlap!)
      let labelOffsetY = 23;
      let labelOffsetX = 0;
      if (stop.id === 'tahoe') {
        labelOffsetY = -30;
      } else if (stop.id === 'mountainview') {
        labelOffsetX = -56;
        labelOffsetY = 28;
      } else if (stop.id === 'yosemite') {
        labelOffsetX = 50;
        labelOffsetY = 28;
      } else if (stop.id === 'sharon') {
        labelOffsetX = 36;
        labelOffsetY = 26;
      }

      const labelText = stars > 0 ? `${stop.shortName} ${'★'.repeat(stars)}` : stop.shortName;
      ctx.font = '800 15px sans-serif';
      const tw = ctx.measureText(labelText).width + 18;
      const lx = Math.max(8, Math.min(cssW - tw - 8, pos.x + labelOffsetX - tw / 2));
      const ly = pos.y + labelOffsetY - 13;

      ctx.fillStyle = isSelected ? '#42220d' : 'rgba(255, 253, 246, 0.96)';
      ctx.strokeStyle = '#7c4a26';
      ctx.lineWidth = 2.2;
      this.roundRect(ctx, lx, ly, tw, 26, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isSelected ? '#ffe066' : isUnlocked ? '#42220d' : '#78716c';
      ctx.fillText(labelText, lx + tw / 2, ly + 13.5);
    }

    // 4. Cute Free-Roaming Purple Van driving anywhere across the US (with inflatable life raft on water!)
    const vanPt = this.getVanScreenPos(cssW, cssH);
    const onWater = isMapWater(this.vanPos.nx, this.vanPos.ny);

    // Land -> Water transition: splash SFX, droplets, wake burst & joyful raft bubble!
    if (onWater && !this.wasOnWater) {
      soundEngine.playSplash();
      this.waterRipples.push(
        { x: vanPt.x, y: vanPt.y + 4, rx: 24, ry: 11, life: 1 },
        { x: vanPt.x, y: vanPt.y + 4, rx: 14, ry: 6, life: 0.9 },
      );
      for (let i = 0; i < 18; i++) {
        const ang = (Math.PI * 2 * i) / 18 + Math.random() * 0.25;
        const spd = 1.3 + Math.random() * 2.5;
        this.sparkles.push({
          x: vanPt.x,
          y: vanPt.y - 4,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 1.6,
          r: 3.5 + Math.random() * 3.5,
          color: RAFT_DEPLOY_EVENT.colors[i % RAFT_DEPLOY_EVENT.colors.length] ?? '#38bdf8',
          life: 1,
        });
      }
      this.activeSilly = {
        event: RAFT_DEPLOY_EVENT,
        startedAtMs: nowMs,
        durationMs: 2600,
      };
    }
    this.wasOnWater = onWater;

    // Smooth bouncy inflate on water / quick deflate back on dry land
    if (onWater) {
      this.raftInflate = Math.min(1, this.raftInflate + 0.14);
    } else {
      this.raftInflate = Math.max(0, this.raftInflate - 0.12);
    }
    const isFloating = this.raftInflate > 0.05;

    // Emit water wake ripples on water, or dust puffs on dry land
    if (isFloating) {
      const rippleChance = isDriving ? 0.34 : 0.08;
      if (Math.random() < rippleChance) {
        const wakeX = isDriving ? vanPt.x + (this.vanFacingEast ? -16 : 16) : vanPt.x;
        this.waterRipples.push({ x: wakeX, y: vanPt.y + 6, rx: 22, ry: 10, life: 1 });
      }
    } else if (isDriving && Math.random() < 0.38) {
      const exhaustX = vanPt.x + (this.vanFacingEast ? -20 : 20);
      this.dustPuffs.push({ x: exhaustX, y: vanPt.y + 4, r: 5, life: 1 });
    }

    // Draw expanding white/turquoise water wake rings
    for (let i = this.waterRipples.length - 1; i >= 0; i--) {
      const rip = this.waterRipples[i]!;
      rip.life -= 0.028;
      rip.rx += 0.95;
      rip.ry += 0.45;
      if (rip.life <= 0) {
        this.waterRipples.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = rip.life * 0.78;
      ctx.strokeStyle = rip.life > 0.5 ? '#ffffff' : '#bae6fd';
      ctx.lineWidth = 2.4 * rip.life + 0.8;
      ctx.beginPath();
      ctx.ellipse(rip.x, rip.y, rip.rx, rip.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Draw road dust puffs
    for (let i = this.dustPuffs.length - 1; i >= 0; i--) {
      const puff = this.dustPuffs[i]!;
      puff.life -= 0.04;
      puff.r += 0.35;
      puff.y -= 0.4;
      if (puff.life <= 0) {
        this.dustPuffs.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = puff.life * 0.65;
      ctx.fillStyle = this.activeSilly?.event.turboBoost ? '#bef264' : '#fffdf7';
      ctx.beginPath();
      ctx.arc(puff.x, puff.y, puff.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Destination target ripple when cruising off-route
    if (isDriving) {
      const targetPt = {
        x: rect.ox + this.vanTarget.nx * rect.rw,
        y: rect.oy + this.vanTarget.ny * rect.rh,
      };
      ctx.save();
      ctx.strokeStyle = isMapWater(this.vanTarget.nx, this.vanTarget.ny)
        ? 'rgba(186, 230, 253, 0.92)'
        : 'rgba(255, 224, 102, 0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(targetPt.x, targetPt.y, 10 + Math.sin(this.tick * 5) * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const turboWiggle = this.activeSilly?.event.turboBoost ? Math.sin(this.tick * 18) * 0.14 : 0;
    const landBounce = Math.sin(this.tick * (isDriving ? 10 : 3)) * (isDriving ? 2.5 : 1.2);
    const waveBob = Math.sin(this.tick * 4.2) * 3.4;
    const waveRoll = Math.sin(this.tick * 2.8) * 0.065;
    const bounce = landBounce * (1 - this.raftInflate) + waveBob * this.raftInflate;
    const roll = turboWiggle + waveRoll * this.raftInflate;

    // Ground shadow on land vs deep-blue water reflection under floating raft
    ctx.fillStyle = isFloating ? 'rgba(12, 74, 110, 0.34)' : 'rgba(42, 22, 8, 0.28)';
    ctx.beginPath();
    ctx.ellipse(
      vanPt.x,
      vanPt.y + 8,
      28 + this.raftInflate * 16,
      9 + this.raftInflate * 5,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Deployed orange-and-yellow inflatable life raft underneath the Purple Van!
    if (isFloating && this.raftImg.complete && this.raftImg.naturalWidth > 0) {
      const popScale =
        this.raftInflate < 0.85
          ? this.raftInflate * 1.18
          : 1.0 + Math.sin(((this.raftInflate - 0.85) / 0.15) * Math.PI) * 0.08;
      const rw = 108 * popScale;
      const rh = 108 * popScale;
      ctx.save();
      ctx.translate(vanPt.x, vanPt.y - 6 + bounce);
      ctx.rotate(roll);
      ctx.drawImage(this.raftImg, -rw / 2, -rh / 2, rw, rh);
      ctx.restore();
    }

    if (this.vanImg.complete && this.vanImg.naturalWidth > 0) {
      const vw = 78;
      const vh = 78;
      const raftLift = this.raftInflate * 7; // cozy lift so tires nestle inside the raft deck!
      ctx.save();
      ctx.translate(vanPt.x, vanPt.y - 18 - raftLift + bounce);
      ctx.rotate(roll);
      if (this.vanFacingEast) {
        ctx.scale(-1, 1); // flip gently when driving east
      }
      ctx.drawImage(this.vanImg, -vw / 2, -vh / 2, vw, vh);
      ctx.restore();
    }

    // 5. Silly Road-Trip Event Sparkles + Speech Bubble!
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const sp = this.sparkles[i]!;
      sp.x += sp.vx;
      sp.y += sp.vy;
      sp.vy += 0.05;
      sp.life -= 0.022;
      if (sp.life <= 0) {
        this.sparkles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, sp.life);
      ctx.fillStyle = sp.color;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.r * sp.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (this.activeSilly) {
      const elapsed = nowMs - this.activeSilly.startedAtMs;
      const progress = elapsed / this.activeSilly.durationMs;
      const alpha = progress > 0.8 ? Math.max(0, (1 - progress) * 5) : 1;
      const floatY = Math.sin(this.tick * 5) * 4;
      const ev = this.activeSilly.event;
      const evImg = this.eventImgs.get(ev.id);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = '800 17px "Fredoka", "Nunito", sans-serif';
      const textW = ctx.measureText(ev.headline).width;
      const bubbleW = textW + 66;
      const bubbleH = 44;
      const bx = Math.max(12, Math.min(cssW - bubbleW - 12, vanPt.x - bubbleW / 2));
      const by = Math.max(12, vanPt.y - 98 + floatY);

      ctx.fillStyle = '#fffdf6';
      ctx.strokeStyle = '#7339c9';
      ctx.lineWidth = 3;
      this.roundRect(ctx, bx, by, bubbleW, bubbleH, 18);
      ctx.fill();
      ctx.stroke();

      if (evImg?.complete && evImg.naturalWidth > 0) {
        ctx.drawImage(evImg, bx + 8, by + 4, 36, 36);
      }

      ctx.fillStyle = '#42220d';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(ev.headline, bx + 50, by + bubbleH / 2 + 1);
      ctx.restore();
    }

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
