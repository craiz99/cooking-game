import './styles/storybook.css';
import type { PlayerProfile, RoomStatePayload, ScreenMode } from '@shared/types';
import { musicEngine, resolveMusicThemeForScreen } from './audio/musicEngine';
import { soundEngine } from './audio/soundEngine';
import { assetUrl } from './net/assets';
import { LocalSoloTransport } from './net/localSoloTransport';
import { GameSocketClient, loadDeviceProfile } from './net/socketClient';
import type { IGameTransport } from './net/transport';
import { KitchenScreen } from './screens/KitchenScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { RoadTripMapScreen } from './screens/RoadTripMapScreen';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Missing #app root element');
}

if ('serviceWorker' in navigator && (window.isSecureContext || window.location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(assetUrl('/sw.js')).catch(() => {});
  });
}

window.addEventListener('pointerdown', () => soundEngine.unlock(), { once: true });

const isStaticSolo = import.meta.env.VITE_STATIC_SOLO === 'true';
const transport: IGameTransport = isStaticSolo
  ? new LocalSoloTransport()
  : new GameSocketClient();

let me: PlayerProfile | null = null;
let roomState: RoomStatePayload | null = null;
let activeScreen: ScreenMode | null = null;

function getTokenFromUrl(): string | null {
  if (isStaticSolo) return 'solo-github-pages';
  const match = window.location.pathname.match(/\/trip\/([A-Za-z0-9_-]{24,64})$/);
  return match?.[1] ?? null;
}

function navigateToTrip(token: string): void {
  if (isStaticSolo) return;
  window.history.pushState({}, '', `/trip/${token}`);
  renderActiveScreen();
}

const lobbyScreen = new LobbyScreen(root, {
  socket: transport,
  getTokenFromUrl,
  navigateToTrip,
  getMe: () => me,
  setMe: (p) => {
    me = p;
  },
  getRoomState: () => roomState,
  onStateChange: (state) => {
    roomState = state;
    renderActiveScreen();
  },
});

const mapScreen = new RoadTripMapScreen(root, transport);
const kitchenScreen = new KitchenScreen(root, transport);

transport.onRoomState = (state) => {
  roomState = state;
  if (me) {
    const updatedMe = state.players.find((p) => p.playerId === me?.playerId);
    if (updatedMe) me = updatedMe;
  }
  renderActiveScreen();
};

transport.onKitchenSnapshot = (snap) => {
  if (activeScreen === 'kitchen') {
    kitchenScreen.updateSnapshot(snap);
  }
};

transport.onSimEvent = (ev) => {
  if (activeScreen === 'kitchen') {
    kitchenScreen.handleSimEvent(ev);
  } else if (ev.type === 'animal_emote' && ev.animalId) {
    soundEngine.playAnimalEmote(ev.animalId);
  }
};

function renderActiveScreen(): void {
  const desired: ScreenMode =
    roomState && me
      ? roomState.screen === 'kitchen' && roomState.kitchen
        ? 'kitchen'
        : roomState.screen === 'map'
          ? 'map'
          : 'lobby'
      : 'lobby';

  musicEngine.setTheme(resolveMusicThemeForScreen(desired, roomState?.kitchen?.stopId));

  if (desired === 'kitchen' && roomState && me) {
    if (activeScreen === 'map') mapScreen.unmount();
    if (activeScreen !== 'kitchen') {
      activeScreen = 'kitchen';
      kitchenScreen.mount(roomState, me);
    } else {
      kitchenScreen.updateRoom(roomState, me);
    }
    return;
  }

  if (desired === 'map' && roomState) {
    if (activeScreen === 'kitchen') kitchenScreen.unmount();
    if (activeScreen !== 'map') {
      activeScreen = 'map';
      mapScreen.mount(roomState);
    } else {
      mapScreen.update(roomState);
    }
    return;
  }

  if (activeScreen === 'map') mapScreen.unmount();
  if (activeScreen === 'kitchen') kitchenScreen.unmount();
  activeScreen = 'lobby';
  lobbyScreen.render();
}

window.addEventListener('popstate', () => renderActiveScreen());

if (isStaticSolo) {
  const saved = loadDeviceProfile();
  void transport
    .joinTrip({
      token: 'solo-github-pages',
      name: saved.name.trim() || 'Chef',
      preferredAnimalId: saved.preferredAnimalId ?? 'purple_bat',
      kidHelper: saved.kidHelper,
    })
    .then((res) => {
      if (res.ok) {
        me = res.player;
        roomState = res.state;
        renderActiveScreen();
      }
    });
} else {
  renderActiveScreen();
}
