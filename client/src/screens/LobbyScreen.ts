import { ANIMALS, ANIMAL_BY_ID } from '@shared/animals';
import { STOP_BY_ID } from '@shared/stops';
import type { AnimalId, PlayerProfile, RoomStatePayload } from '@shared/types';
import { soundEngine } from '../audio/soundEngine';
import { assetUrl } from '../net/assets';
import { loadDeviceProfile, saveDeviceProfile } from '../net/socketClient';
import type { IGameTransport } from '../net/transport';

export interface LobbyHooks {
  socket: IGameTransport;
  getTokenFromUrl: () => string | null;
  navigateToTrip: (token: string) => void;
  getMe: () => PlayerProfile | null;
  setMe: (player: PlayerProfile | null) => void;
  getRoomState: () => RoomStatePayload | null;
  onStateChange: (state: RoomStatePayload) => void;
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

export class LobbyScreen {
  private container: HTMLElement;
  private hooks: LobbyHooks;
  private requiresHostSecret = false;
  private errorMsg = '';
  private infoMsg = '';
  private qrModalData: { inviteUrl: string; dataUrl: string } | null = null;
  private busy = false;
  private draftName = '';
  private draftKidHelper = true;
  private draftHostSecret = '';
  private draftJoinLink = '';

  constructor(container: HTMLElement, hooks: LobbyHooks) {
    this.container = container;
    this.hooks = hooks;
    const saved = loadDeviceProfile();
    this.draftName = saved.name;
    this.draftKidHelper = saved.kidHelper;
    if (!hooks.socket.isStaticSolo) {
      void this.fetchServerConfig();
    }
  }

  private async fetchServerConfig(): Promise<void> {
    try {
      const resp = await fetch('/api/config');
      if (resp.ok) {
        const data = (await resp.json()) as { requiresHostSecret?: boolean };
        this.requiresHostSecret = Boolean(data.requiresHostSecret);
        this.render();
      }
    } catch {
      // ignore offline
    }
  }

  private async createTrip(soloMode: boolean): Promise<void> {
    if (this.busy) return;
    soundEngine.unlock();
    this.busy = true;
    this.errorMsg = '';
    this.render();

    try {
      const resp = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          soloMode,
          hostSecret: this.draftHostSecret || undefined,
        }),
      });
      const data = (await resp.json()) as { token?: string; error?: string };
      if (!resp.ok || !data.token) {
        this.errorMsg = data.error ?? 'Could not create road trip.';
        return;
      }
      soundEngine.playVanHonk();
      this.hooks.navigateToTrip(data.token);
      if (soloMode) {
        this.busy = false;
        const nameToUse = this.draftName.trim() || 'Chef';
        this.draftName = nameToUse;
        await this.joinCurrentTrip(data.token);
      }
    } catch {
      this.errorMsg = 'Unable to reach server. Make sure the Purple Van server is running.';
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private parseTokenFromInput(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/\/trip\/([A-Za-z0-9_-]{24,64})/);
    if (match?.[1]) return match[1];
    if (/^[A-Za-z0-9_-]{24,64}$/.test(trimmed)) return trimmed;
    return null;
  }

  async joinCurrentTrip(explicitToken?: string): Promise<void> {
    const token = explicitToken ?? this.hooks.getTokenFromUrl();
    if (!token || this.busy) return;
    soundEngine.unlock();

    const cleanName = this.draftName.trim();
    if (!cleanName) {
      this.errorMsg = 'Type your name first so your crew knows who you are!';
      this.render();
      return;
    }

    this.busy = true;
    this.errorMsg = '';
    this.render();

    const saved = loadDeviceProfile();
    const res = await this.hooks.socket.joinTrip({
      token,
      name: cleanName,
      playerId: saved.playerId,
      preferredAnimalId: saved.preferredAnimalId,
      kidHelper: this.draftKidHelper,
    });

    this.busy = false;
    if (!res.ok) {
      this.errorMsg = res.error;
      this.render();
      return;
    }

    this.hooks.setMe(res.player);
    saveDeviceProfile({
      name: res.player.name,
      playerId: res.player.playerId,
      preferredAnimalId: res.player.animalId,
      kidHelper: res.player.kidHelper,
    });
    soundEngine.playAnimalEmote(res.player.animalId);
    this.hooks.onStateChange(res.state);
  }

  private async handlePickAnimal(animalId: AnimalId): Promise<void> {
    soundEngine.unlock();
    const res = await this.hooks.socket.selectAnimal(animalId);
    if (!res.ok) {
      this.errorMsg = res.error ?? 'Another chef already picked that animal!';
      this.render();
      return;
    }
    this.errorMsg = '';
    const me = this.hooks.getMe();
    if (me) {
      me.animalId = animalId;
      saveDeviceProfile({
        name: me.name,
        playerId: me.playerId,
        preferredAnimalId: animalId,
        kidHelper: me.kidHelper,
      });
    }
    soundEngine.playAnimalEmote(animalId);
    this.hooks.socket.triggerEmote();
  }

  private async showQrModal(token: string): Promise<void> {
    soundEngine.unlock();
    try {
      const resp = await fetch(`/api/trips/${encodeURIComponent(token)}/qr`);
      if (!resp.ok) return;
      this.qrModalData = (await resp.json()) as { inviteUrl: string; dataUrl: string };
      this.render();
    } catch {
      this.errorMsg = 'Could not load QR code.';
      this.render();
    }
  }

  private async copyInviteLink(token: string): Promise<void> {
    const url = `${window.location.origin}/trip/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      this.infoMsg = 'Invite link copied! Send it to your family.';
    } catch {
      this.infoMsg = `Share this link: ${url}`;
    }
    this.render();
    setTimeout(() => {
      this.infoMsg = '';
      this.render();
    }, 3500);
  }

  render(): void {
    const token = this.hooks.getTokenFromUrl();
    const me = this.hooks.getMe();
    const room = this.hooks.getRoomState();

    this.container.innerHTML = '';

    const screen = el('div', 'lobby-screen');
    screen.style.backgroundImage = `url("${assetUrl('/assets/scenes/sharon_lobby_bg.webp')}")`;

    // Top-left Sharon Seaweed Stand brand sign
    const brand = el('div', 'lobby-brand-badge');
    brand.append(
      el('div', 'wood-ribbon lobby-title-pill', 'PURPLE VAN ROAD TRIP'),
      el('div', 'lobby-subtitle-pill', 'Memorial Park Beach • Sharon, MA → San Jose, CA'),
    );
    screen.append(brand);

    // Bottom-left peeking illustrated animal chefs!
    const peeking = el('div', 'lobby-peeking-crew');
    const previewAnimals: AnimalId[] =
      room && room.players.length > 0
        ? room.players.map((p) => p.animalId)
        : ['purple_cat', 'panda', 'purple_bat'];
    previewAnimals.forEach((aid, idx) => {
      const a = ANIMAL_BY_ID[aid];
      const img = el('img', `peeking-animal ${a.isSmall ? 'bat' : ''}`);
      img.src = assetUrl(a.spritePath);
      img.alt = a.name;
      img.style.animationDelay = `${idx * 0.45}s`;
      peeking.append(img);
    });
    screen.append(peeking);

    // Right Storybook Card
    const card = el('div', 'storybook-panel lobby-card pop-in');

    // Header + Audio mute button
    const headerRow = el('div', 'lobby-card-header');
    const ribbonText = !token
      ? 'SHARON SEAWEED STAND'
      : me
        ? 'PICK YOUR ANIMAL CHEF'
        : 'JOIN THE CREW';
    headerRow.append(el('div', 'wood-ribbon', ribbonText));

    const soundBtn = el(
      'button',
      'tactile-btn btn-cream',
      soundEngine.muted ? 'Muted' : 'Sound ON',
    );
    soundBtn.style.padding = '7px 11px';
    soundBtn.style.fontSize = '12px';
    soundBtn.addEventListener('click', () => {
      soundEngine.muted = !soundEngine.muted;
      if (!soundEngine.muted) soundEngine.playPickup();
      this.render();
    });
    headerRow.append(soundBtn);
    card.append(headerRow);

    if (this.errorMsg) {
      card.append(el('div', 'error-banner', this.errorMsg));
    }
    if (this.infoMsg) {
      card.append(el('div', 'info-banner', this.infoMsg));
    }

    if (!token) {
      this.renderLandingCard(card);
    } else if (!me || !room) {
      this.renderJoinByTokenCard(card, token);
    } else {
      this.renderJoinedCrewCard(card, token, me, room);
    }

    screen.append(card);

    // Optional QR Code Modal for instant iPad Wi-Fi join
    if (this.qrModalData) {
      const backdrop = el('div', 'modal-backdrop');
      const modal = el('div', 'storybook-panel modal-card pop-in');
      modal.append(el('div', 'wood-ribbon', 'SCAN WITH IPAD CAMERA'));
      const img = el('img', 'qr-image');
      img.src = this.qrModalData.dataUrl;
      img.alt = 'Invite QR Code';
      modal.append(img);
      const urlCode = el('div', '', this.qrModalData.inviteUrl);
      urlCode.style.fontSize = '11px';
      urlCode.style.fontFamily = 'monospace';
      urlCode.style.wordBreak = 'break-all';
      urlCode.style.color = '#5b21b6';
      modal.append(urlCode);

      const closeBtn = el('button', 'tactile-btn btn-gold', 'Done');
      closeBtn.addEventListener('click', () => {
        this.qrModalData = null;
        this.render();
      });
      modal.append(closeBtn);
      backdrop.append(modal);
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          this.qrModalData = null;
          this.render();
        }
      });
      screen.append(backdrop);
    }

    this.container.append(screen);
  }

  private renderLandingCard(card: HTMLElement): void {
    const intro = el(
      'p',
      '',
      'Cook together across 8 US stops in your purple food-truck van — no accounts needed! Start a private family trip or hop into Solo Mode to test and play right away.',
    );
    intro.style.margin = '0';
    intro.style.fontSize = '13.5px';
    intro.style.lineHeight = '1.42';
    intro.style.fontWeight = '700';
    card.append(intro);

    if (this.requiresHostSecret) {
      const secretWrap = el('div');
      secretWrap.append(el('label', 'field-label', 'Family Host Passphrase (to start a new trip)'));
      const secretInput = el('input', 'storybook-input');
      secretInput.type = 'password';
      secretInput.placeholder = 'Enter host passphrase...';
      secretInput.value = this.draftHostSecret;
      secretInput.addEventListener('input', () => {
        this.draftHostSecret = secretInput.value;
      });
      secretWrap.append(secretInput);
      card.append(secretWrap);
    }

    const createFamilyBtn = el(
      'button',
      'tactile-btn btn-green',
      this.busy ? 'Starting Purple Van...' : 'Start Family Road Trip (1–3 Players)',
    );
    createFamilyBtn.disabled = this.busy;
    createFamilyBtn.addEventListener('click', () => void this.createTrip(false));
    card.append(createFamilyBtn);

    const createSoloBtn = el(
      'button',
      'tactile-btn btn-gold',
      'Play Solo (1-Player Practice / Test)',
    );
    createSoloBtn.disabled = this.busy;
    createSoloBtn.addEventListener('click', () => void this.createTrip(true));
    card.append(createSoloBtn);

    // Paste existing invite link section
    const divider = el('div', 'field-label', 'Have a family invite link? Paste it below:');
    divider.style.marginTop = '4px';
    card.append(divider);

    const joinRow = el('div');
    joinRow.style.display = 'flex';
    joinRow.style.gap = '8px';

    const linkInput = el('input', 'storybook-input');
    linkInput.placeholder = 'https://.../trip/...';
    linkInput.style.fontSize = '13px';
    linkInput.value = this.draftJoinLink;
    linkInput.addEventListener('input', () => {
      this.draftJoinLink = linkInput.value;
    });

    const goBtn = el('button', 'tactile-btn btn-purple', 'Join');
    goBtn.addEventListener('click', () => {
      const parsed = this.parseTokenFromInput(this.draftJoinLink);
      if (!parsed) {
        this.errorMsg = 'Please paste a valid Purple Van invite link.';
        this.render();
        return;
      }
      this.errorMsg = '';
      this.hooks.navigateToTrip(parsed);
    });

    joinRow.append(linkInput, goBtn);
    card.append(joinRow);
  }

  private renderJoinByTokenCard(card: HTMLElement, token: string): void {
    const nameWrap = el('div');
    nameWrap.append(el('label', 'field-label', 'Your Chef Name (No Account Needed)'));
    const nameInput = el('input', 'storybook-input');
    nameInput.maxLength = 16;
    nameInput.placeholder = 'e.g. Leo, Maya, Ben';
    nameInput.value = this.draftName;
    nameInput.addEventListener('input', () => {
      this.draftName = nameInput.value;
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.joinCurrentTrip(token);
    });
    nameWrap.append(nameInput);
    card.append(nameWrap);

    const helperRow = el('div', 'toggle-row');
    const helperText = el('div');
    const hTitle = el('div', '', 'Kid Helper Mode (For iPad / 5-Year-Old)');
    hTitle.style.fontSize = '13px';
    hTitle.style.fontWeight = '800';
    const hSub = el('div', '', 'Glowing golden path, bouncing star & tap-to-walk');
    hSub.style.fontSize = '11px';
    hSub.style.color = '#764c29';
    helperText.append(hTitle, hSub);

    const helperBtn = el(
      'button',
      `toggle-pill ${this.draftKidHelper ? '' : 'off'}`,
      this.draftKidHelper ? 'ON' : 'OFF',
    );
    helperBtn.addEventListener('click', () => {
      this.draftKidHelper = !this.draftKidHelper;
      this.render();
    });
    helperRow.append(helperText, helperBtn);
    card.append(helperRow);

    const joinBtn = el(
      'button',
      'tactile-btn btn-green',
      this.busy ? 'Joining...' : 'Hop in the Purple Van!',
    );
    joinBtn.disabled = this.busy;
    joinBtn.addEventListener('click', () => void this.joinCurrentTrip(token));
    card.append(joinBtn);
  }

  private renderJoinedCrewCard(
    card: HTMLElement,
    token: string,
    me: PlayerProfile,
    room: RoomStatePayload,
  ): void {
    const liveMe = room.players.find((p) => p.playerId === me.playerId) ?? me;
    const isStaticSolo = this.hooks.socket.isStaticSolo;

    if (isStaticSolo) {
      const soloBadge = el('div', 'info-banner', 'Solo Edition (GitHub Pages) • Progress Auto-Saved in Browser');
      soloBadge.style.textAlign = 'center';
      card.append(soloBadge);

      const nameRow = el('div');
      nameRow.style.display = 'flex';
      nameRow.style.gap = '8px';
      nameRow.style.alignItems = 'center';
      const nameInput = el('input', 'storybook-input');
      nameInput.maxLength = 16;
      nameInput.placeholder = 'Your chef name...';
      nameInput.value = liveMe.name;
      nameInput.style.padding = '8px 12px';
      nameInput.style.fontSize = '14px';
      nameInput.addEventListener('change', () => {
        const clean = nameInput.value.trim().slice(0, 16) || 'Chef';
        saveDeviceProfile({
          name: clean,
          playerId: liveMe.playerId,
          preferredAnimalId: liveMe.animalId,
          kidHelper: liveMe.kidHelper,
        });
        void this.hooks.socket.joinTrip({
          token,
          name: clean,
          preferredAnimalId: liveMe.animalId,
          kidHelper: liveMe.kidHelper,
        });
      });
      nameRow.append(nameInput);
      card.append(nameRow);
    }

    // 6-Animal Picker Grid (Unique per player!)
    const pickLabel = el('div', 'field-label', 'Choose Your Animal Chef (Tap to hear them!)');
    card.append(pickLabel);

    const grid = el('div', 'animal-grid');
    for (const animal of ANIMALS) {
      const owner = room.players.find((p) => p.animalId === animal.id);
      const isMine = owner?.playerId === liveMe.playerId;
      const isTakenByOther = Boolean(owner && !isMine);

      const tile = el(
        'button',
        `animal-card ${isMine ? 'selected' : ''} ${isTakenByOther ? 'taken' : ''} ${animal.isSmall ? 'is-bat' : ''}`,
      );
      tile.type = 'button';
      tile.disabled = isTakenByOther;

      const img = el('img');
      img.src = assetUrl(animal.spritePath);
      img.alt = animal.name;
      tile.append(img);
      tile.append(el('div', 'animal-name', animal.name));
      tile.append(el('div', 'animal-behavior', animal.behaviorName));

      if (isTakenByOther && owner) {
        tile.append(el('span', 'taken-badge', owner.name));
      } else if (isMine) {
        tile.append(el('span', 'taken-badge', 'YOU'));
      }

      tile.addEventListener('click', () => {
        if (isMine) {
          soundEngine.playAnimalEmote(animal.id);
          this.hooks.socket.triggerEmote();
        } else {
          void this.handlePickAnimal(animal.id);
        }
      });
      grid.append(tile);
    }
    card.append(grid);

    // Kid Helper toggle
    const helperRow = el('div', 'toggle-row');
    const helperText = el('div');
    const hTitle = el('div', '', 'Kid Helper Mode');
    hTitle.style.fontSize = '13px';
    hTitle.style.fontWeight = '800';
    const hSub = el('div', '', 'Golden guide trail & picture hints for your device');
    hSub.style.fontSize = '11px';
    hSub.style.color = '#764c29';
    helperText.append(hTitle, hSub);

    const helperBtn = el(
      'button',
      `toggle-pill ${liveMe.kidHelper ? '' : 'off'}`,
      liveMe.kidHelper ? 'ON' : 'OFF',
    );
    helperBtn.addEventListener('click', () => {
      const next = !liveMe.kidHelper;
      this.hooks.socket.setKidHelper(next);
      saveDeviceProfile({
        name: liveMe.name,
        playerId: liveMe.playerId,
        preferredAnimalId: liveMe.animalId,
        kidHelper: next,
      });
    });
    helperRow.append(helperText, helperBtn);
    card.append(helperRow);

    // Optional Solo AI Helper toggle when playing solo (1 player connected)
    if (room.players.length === 1) {
      const aiRow = el('div', 'toggle-row');
      aiRow.style.background = '#f3e8ff';
      aiRow.style.borderColor = '#a855f7';
      const aiText = el('div');
      const aTitle = el('div', '', 'Solo Mode AI Sous-Chef');
      aTitle.style.fontSize = '12.5px';
      aTitle.style.fontWeight = '800';
      const aSub = el('div', '', 'Waits out of your way and helps finish dishes you start');
      aSub.style.fontSize = '11px';
      aSub.style.color = '#581c87';
      aiText.append(aTitle, aSub);

      const aiBtn = el(
        'button',
        `toggle-pill ${room.trip.soloAiHelper ? '' : 'off'}`,
        room.trip.soloAiHelper ? 'ON' : 'OFF',
      );
      aiBtn.addEventListener('click', () => {
        this.hooks.socket.setSoloAiHelper(!room.trip.soloAiHelper);
      });
      aiRow.append(aiText, aiBtn);
      card.append(aiRow);
    }

    const totalStars = Object.values(room.trip.starsByStop).reduce((a, b) => a + (b ?? 0), 0);
    const currentStop = STOP_BY_ID[room.trip.currentStopId];

    // Connected Crew + Saved Progress + Crew Lock (or Solo Reset button)
    const crewStrip = el('div', 'crew-strip');
    const crewHeader = el('div');
    crewHeader.style.display = 'flex';
    crewHeader.style.justifyContent = 'space-between';
    crewHeader.style.alignItems = 'center';
    crewHeader.style.fontSize = '12px';
    crewHeader.style.fontWeight = '800';

    const totalScore = room.trip.totalScore ?? 0;
    crewHeader.append(
      el(
        'span',
        '',
        isStaticSolo
          ? `Progress: ${room.trip.unlockedStopIds.length}/8 Stops • ${totalStars}/24 ★ • ${totalScore.toLocaleString()} pts`
          : `Crew Ready (${room.players.length}/3) • ${totalStars}/24 ★ • ${totalScore.toLocaleString()} pts`,
      ),
    );

    if (isStaticSolo && this.hooks.socket.resetSoloProgress) {
      const resetBtn = el('button', 'tactile-btn btn-cream', 'Reset Save');
      resetBtn.style.padding = '3px 9px';
      resetBtn.style.fontSize = '11px';
      resetBtn.addEventListener('click', () => {
        this.hooks.socket.resetSoloProgress?.();
        this.infoMsg = 'Solo road trip reset back to Sharon, MA!';
        this.render();
      });
      crewHeader.append(resetBtn);
    } else {
      const lockBtn = el(
        'button',
        'tactile-btn btn-cream',
        room.trip.crewLocked ? 'Locked' : 'Lock Crew',
      );
      lockBtn.style.padding = '3px 9px';
      lockBtn.style.fontSize = '11px';
      lockBtn.addEventListener('click', () => {
        this.hooks.socket.setCrewLocked(!room.trip.crewLocked);
      });
      crewHeader.append(lockBtn);
    }
    crewStrip.append(crewHeader);

    if (!isStaticSolo) {
      const avatars = el('div', 'crew-avatars');
      for (const p of room.players) {
        const chip = el('div', 'crew-chip');
        const img = el('img');
        img.src = assetUrl(ANIMAL_BY_ID[p.animalId].spritePath);
        img.alt = p.name;
        chip.append(img, el('span', '', `${p.name}${p.connected ? '' : ' (away)'}`));
        avatars.append(chip);
      }
      crewStrip.append(avatars);
    }
    card.append(crewStrip);

    // Invite Link + Wi-Fi QR Code buttons (Multiplayer Server Mode only)
    if (!isStaticSolo) {
      const inviteRow = el('div', 'btn-row');
      const copyBtn = el('button', 'tactile-btn btn-purple', 'Copy Invite Link');
      copyBtn.addEventListener('click', () => void this.copyInviteLink(token));
      const qrBtn = el('button', 'tactile-btn btn-gold', 'iPad QR Code');
      qrBtn.addEventListener('click', () => void this.showQrModal(token));
      inviteRow.append(copyBtn, qrBtn);
      card.append(inviteRow);
    }

    // Main Start / Resume Road Trip CTA
    const hasProgress = room.trip.unlockedStopIds.length > 1 || totalStars > 0;
    const startBtn = el(
      'button',
      'tactile-btn btn-green',
      hasProgress
        ? `Resume Road Trip (${currentStop.shortName})`
        : 'Start Road Trip from Sharon, MA!',
    );
    startBtn.style.fontSize = '16px';
    startBtn.style.padding = '13px 18px';
    startBtn.addEventListener('click', () => {
      soundEngine.playVanHonk();
      this.hooks.socket.openMap();
    });
    card.append(startBtn);
  }
}
