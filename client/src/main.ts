import './styles/storybook.css';
import type { PlayerProfile, RoomStatePayload } from '@shared/types';
import { soundEngine } from './audio/soundEngine';
import { GameSocketClient } from './net/socketClient';
import { LobbyScreen } from './screens/LobbyScreen';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Missing #app root element');
}

// Register PWA Service Worker when supported over HTTPS or localhost
if ('serviceWorker' in navigator && (window.isSecureContext || window.location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Unlock Web Audio cleanly on first iPad touch / click
window.addEventListener('pointerdown', () => soundEngine.unlock(), { once: true });

const socket = new GameSocketClient();
let me: PlayerProfile | null = null;
let roomState: RoomStatePayload | null = null;

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
  // PR #7 and PR #8 will plug in RoadTripMapScreen and KitchenScreen here
  lobbyScreen.render();
}

window.addEventListener('popstate', () => renderActiveScreen());
renderActiveScreen();
