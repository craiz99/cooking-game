import { ANIMAL_BY_ID, INGREDIENT_BY_ID } from '@shared/animals';
import { STOPS, STOP_BY_ID, getStarTargets } from '@shared/stops';
import type { RoomStatePayload, StopId } from '@shared/types';
import { soundEngine } from '../audio/soundEngine';
import { assetUrl } from '../net/assets';
import type { IGameTransport } from '../net/transport';

/**
 * Calibrated normalized positions matching our painted art_us_map_bg.webp so:
 * - Sharon, MA sits in Massachusetts, NYC on the coast, Chicago at Lake Michigan
 * - Austin sits in central Texas, Denver sits squarely in Colorado Rockies
 * - Yosemite (#6), Lake Tahoe (#7), and San Jose (#8) ALL sit accurately inside California!
 */
export const MAP_PIN_COORDS: Record<StopId, { nx: number; ny: number }> = {
  sharon: { nx: 0.858, ny: 0.305 },
  nyc: { nx: 0.832, ny: 0.365 },
  chicago: { nx: 0.638, ny: 0.375 },
  austin: { nx: 0.495, ny: 0.768 },
  denver: { nx: 0.362, ny: 0.470 },
  yosemite: { nx: 0.165, ny: 0.502 },
  tahoe: { nx: 0.160, ny: 0.405 },
  sanjose: { nx: 0.123, ny: 0.492 },
};

const STATION_ICONS: Record<string, string> = {
  prep_board: '/assets/stations/station_prep_board.png',
  stove_pot: '/assets/stations/station_stove_pot.png',
  grill_fryer: '/assets/stations/station_grill_fryer.png',
};

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
  private dishImgs = new Map<string, HTMLImageElement>();

  // Smooth animated van progress (0..7 along STOPS)
  private vanProgress = 0;
  private targetProgress = 0;
  private tick = 0;
  private dustPuffs: Array<{ x: number; y: number; r: number; life: number }> = [];

  constructor(container: HTMLElement, socket: IGameTransport) {
    this.container = container;
    this.socket = socket;
    this.mapImg.src = assetUrl('/assets/scenes/us_map_bg.webp');
    this.vanImg.src = assetUrl('/assets/chefs/purple_van.png');

    for (const stop of STOPS) {
      const firstDish = stop.recipes[0];
      if (firstDish) {
        const img = new Image();
        img.src = assetUrl(firstDish.spritePath);
        this.dishImgs.set(stop.id, img);
      }
    }
  }

  mount(state: RoomStatePayload): void {
    const prevStop = this.roomState?.vanStopId;
    this.roomState = state;
    const stopIdx = STOPS.findIndex((s) => s.id === state.vanStopId);
    if (stopIdx >= 0) {
      this.targetProgress = stopIdx;
      if (!prevStop) {
        this.vanProgress = stopIdx;
        this.inspectedStopId = state.vanStopId;
      } else if (prevStop !== state.vanStopId) {
        this.inspectedStopId = state.vanStopId;
      }
    }

    this.renderShell();
    this.startLoop();
  }

  update(state: RoomStatePayload): void {
    const vanChanged = this.roomState?.vanStopId !== state.vanStopId;
    this.roomState = state;
    if (vanChanged) {
      const stopIdx = STOPS.findIndex((s) => s.id === state.vanStopId);
      if (stopIdx >= 0) {
        this.targetProgress = stopIdx;
        this.inspectedStopId = state.vanStopId;
      }
    }
    this.renderDrawer();
    this.renderTopBar();
  }

  unmount(): void {
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

    const backBtn = el('button', 'tactile-btn btn-cream', '← Crew & Van');
    backBtn.style.padding = '7px 13px';
    backBtn.style.fontSize = '13px';
    backBtn.addEventListener('click', () => this.socket.returnToLobby());
    topbar.append(backBtn);

    topbar.append(
      el('div', 'wood-ribbon', 'PURPLE VAN ROAD TRIP • SHARON, MA → SAN JOSE, CA'),
    );

    const right = el('div', 'map-crew-bar');
    const totalStars = Object.values(state.trip.starsByStop).reduce((a, b) => a + (b ?? 0), 0);
    right.append(
      el('div', 'map-star-pill', `★ ${totalStars} / 24 Stars`),
      el('div', 'map-star-pill', `Score: ${(state.trip.totalScore ?? 0).toLocaleString()} pts`),
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
    const isUnlocked = state.trip.unlockedStopIds.includes(stop.id);
    const stars = state.trip.starsByStop[stop.id] ?? 0;
    const targets = getStarTargets(stop.id, Math.max(1, state.players.length), state.trip.pace);

    const topRow = el('div', 'map-drawer-top');
    const meta = el('div', 'map-stop-meta');

    const titleRow = el('div', 'map-stop-title-row');
    titleRow.append(
      el('span', 'stop-num-badge', `STOP ${stop.index} OF 8 • ${stop.stateCode}`),
      el('span', 'map-stop-title', stop.name),
      el(
        'span',
        '',
        isUnlocked
          ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  •  Targets: ${targets.oneStar}★ / ${targets.twoStar}★★ / ${targets.threeStar}★★★ (${Math.floor(targets.shiftSeconds / 60)}:${String(targets.shiftSeconds % 60).padStart(2, '0')})`
          : 'Locked — Earn 1 Star on previous stop!',
      ),
    );
    meta.append(titleRow, el('div', 'map-stop-vibe', stop.vibe));
    topRow.append(meta);

    const actions = el('div', 'map-actions-row');
    const paceBtn = el(
      'button',
      'tactile-btn btn-cream',
      state.trip.pace === 'cozy' ? 'Pace: Cozy Cruise' : 'Pace: Dinner Rush',
    );
    paceBtn.style.fontSize = '12.5px';
    paceBtn.style.padding = '8px 12px';
    paceBtn.addEventListener('click', () => {
      this.socket.setPace(state.trip.pace === 'cozy' ? 'rush' : 'cozy');
    });
    actions.append(paceBtn);

    const cookBtn = el(
      'button',
      `tactile-btn ${isUnlocked ? 'btn-green' : 'btn-cream'}`,
      isUnlocked ? `Cook at ${stop.shortName}!` : 'Earn 1 ★ at Previous Stop First',
    );
    cookBtn.disabled = !isUnlocked;
    cookBtn.addEventListener('click', () => {
      soundEngine.unlock();
      soundEngine.playVanHonk();
      void this.socket.startShift(stop.id);
    });
    actions.append(cookBtn);

    topRow.append(actions);
    drawer.append(topRow);

    // Pictorial zero-spice fixed menu cards (real illustrated sprites, zero emojis!)
    const menuGrid = el('div', 'map-menu-grid');
    for (const recipe of stop.recipes) {
      const card = el('div', 'menu-dish-card');
      const dishImg = el('img', 'menu-dish-img');
      dishImg.src = assetUrl(recipe.spritePath);
      dishImg.alt = recipe.name;
      card.append(dishImg);

      const info = el('div', 'menu-dish-info');
      info.append(el('div', 'menu-dish-name', recipe.name));

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

  private handleCanvasClick(e: MouseEvent): void {
    if (!this.canvas || !this.roomState) return;
    soundEngine.unlock();
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    for (const stop of STOPS) {
      const pos = this.getPinScreenPos(stop.id, rect.width, rect.height);
      if (Math.hypot(cx - pos.x, cy - pos.y) <= 36) {
        this.inspectedStopId = stop.id;
        if (this.roomState.trip.unlockedStopIds.includes(stop.id)) {
          soundEngine.playVanHonk();
          void this.socket.driveVan(stop.id);
        } else {
          soundEngine.playPickup();
        }
        this.renderDrawer();
        return;
      }
    }
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

    // Advance purple van smoothly along route spline
    const diff = this.targetProgress - this.vanProgress;
    const isDriving = Math.abs(diff) > 0.008;
    if (isDriving) {
      this.vanProgress += Math.sign(diff) * Math.min(Math.abs(diff), 0.035);
    } else {
      this.vanProgress = this.targetProgress;
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
      ctx.arc(pos.x, pos.y, 15, 0, Math.PI * 2);
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
      ctx.font = '800 13px sans-serif';
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
        labelOffsetY = -26;
      } else if (stop.id === 'sanjose') {
        labelOffsetX = -26;
        labelOffsetY = 25;
      } else if (stop.id === 'yosemite') {
        labelOffsetX = 34;
        labelOffsetY = 25;
      } else if (stop.id === 'sharon') {
        labelOffsetX = 32;
        labelOffsetY = 22;
      }

      const labelText = stars > 0 ? `${stop.shortName} ${'★'.repeat(stars)}` : stop.shortName;
      ctx.font = '800 11.5px sans-serif';
      const tw = ctx.measureText(labelText).width + 14;
      const lx = pos.x + labelOffsetX - tw / 2;
      const ly = pos.y + labelOffsetY - 10;

      ctx.fillStyle = isSelected ? '#42220d' : 'rgba(255, 253, 246, 0.94)';
      ctx.strokeStyle = '#7c4a26';
      ctx.lineWidth = 2;
      this.roundRect(ctx, lx, ly, tw, 20, 9);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isSelected ? '#ffe066' : isUnlocked ? '#42220d' : '#78716c';
      ctx.fillText(labelText, pos.x + labelOffsetX, ly + 10.5);
    }

    // 4. Cute Purple Van driving along the highway!
    const vanPt = this.getRoutePoint(this.vanProgress, cssW, cssH);
    if (isDriving && Math.random() < 0.35) {
      this.dustPuffs.push({ x: vanPt.x + 14, y: vanPt.y + 4, r: 5, life: 1 });
    }
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
      ctx.globalAlpha = puff.life * 0.6;
      ctx.fillStyle = '#fffdf7';
      ctx.beginPath();
      ctx.arc(puff.x, puff.y, puff.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const bounce = Math.sin(this.tick * (isDriving ? 10 : 3)) * (isDriving ? 2.5 : 1.2);
    // Soft ground shadow under van
    ctx.fillStyle = 'rgba(42, 22, 8, 0.28)';
    ctx.beginPath();
    ctx.ellipse(vanPt.x, vanPt.y + 8, 28, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    if (this.vanImg.complete && this.vanImg.naturalWidth > 0) {
      const vw = 76;
      const vh = 76;
      ctx.save();
      ctx.translate(vanPt.x, vanPt.y - 18 + bounce);
      if (diff < -0.01) {
        ctx.scale(-1, 1); // flip gently when driving east
      }
      ctx.drawImage(this.vanImg, -vw / 2, -vh / 2, vw, vh);
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
