import './styles/storybook.css';
import type { PlayerProfile, RoomStatePayload, ScreenMode } from '@shared/types';
import { soundEngine } from './audio/soundEngine';
import { GameSocketClient } from './net/socketClient';
import { LobbyScreen } from './screens/LobbyScreen';
import { RoadTripMapScreen } from './screens/RoadTripMapScreen';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Missing #app root element');
}

if ('serviceWorker' in navigator && (window.isSecureContext || window.location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

window.addEventListener('pointerdown', () => soundEngine.unlock(), { once: true });

const socket = new GameSocketClient();
let me: PlayerProfile | null = null;
let roomState: RoomStatePayload | null = null;
let activeScreen: ScreenMode | null = null;

function getTokenFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/trip\/([A-Za-z0-9_-]{24,64})$/);
  return match?.[1] ?? null;
}

function navigateToTrip(token: string): void {
  window.history.pushState({}, '', `/trip/${token}`);
  renderActiveScreen();
}

const lobbyScreen = new LobbyScreen(root, {
  socket,
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

const mapScreen = new RoadTripMapScreen(root, socket);

socket.onRoomState = (state) => {
  roomState = state;
  if (me) {
    const updatedMe = state.players.find((p) => p.playerId === me?.playerId);
    if (updatedMe) me = updatedMe;
  }
  renderActiveScreen();
};

socket.onSimEvent = (ev) => {
  if (ev.type === 'animal_emote' && ev.animalId) {
    soundEngine.playAnimalEmote(ev.animalId);
  }
};

function renderActiveScreen(): void {
  const desired: ScreenMode =
    roomState && me && roomState.screen === 'map' ? 'map' : 'lobby';

  if (desired === 'map' && roomState) {
    if (activeScreen !== 'map') {
      activeScreen = 'map';
      mapScreen.mount(roomState);
    } else {
      mapScreen.update(roomState);
    }
    return;
  }

  if (activeScreen === 'map') {
    mapScreen.unmount();
  }
  activeScreen = 'lobby';
  lobbyScreen.render();
}

window.addEventListener('popstate', () => renderActiveScreen());
renderActiveScreen();
