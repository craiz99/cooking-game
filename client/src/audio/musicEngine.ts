import type { ScreenMode, StopId } from '@shared/types';

export type MusicThemeId = 'lobby' | 'map' | StopId;

export interface MusicTheme {
  id: MusicThemeId;
  title: string;
  style: string;
  keySignature: string;
  bpm: number;
  stepsPerBar: number;
  swing: number; // 0..0.3 subtle swing on odd eighth/sixteenth steps
  leadWave: OscillatorType;
  chordWave: OscillatorType;
  filterHz: number;
  /** MIDI note numbers (null = rest) across a 16-step or 12-step loop */
  melody: ReadonlyArray<number | null>;
  /** Warm bass MIDI notes (null = rest) */
  bass: ReadonlyArray<number | null>;
  /** Optional lush harmony chord hits (MIDI triad arrays) */
  chords: ReadonlyArray<ReadonlyArray<number> | null>;
  /** Subtle brushed percussion pattern ('k' = soft kick, 's' = soft brush/shaker, null = rest) */
  perc: ReadonlyArray<'k' | 's' | null>;
}

const MUSIC_PREF_KEY = 'purple_van_music_enabled_v1';

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * 10 bespoke, warm, kid-friendly procedural Web Audio musical themes tailored
 * to each screen and US destination from Sharon, MA to San Jose, CA.
 */
export const MUSIC_THEMES: Record<MusicThemeId, MusicTheme> = {
  lobby: {
    id: 'lobby',
    title: 'Lake Massapoag Morning',
    style: 'Cozy New England Lakeside Acoustic',
    keySignature: 'G major',
    bpm: 96,
    stepsPerBar: 16,
    swing: 0.04,
    leadWave: 'triangle',
    chordWave: 'sine',
    filterHz: 2100,
    melody: [67, null, 71, 74, 76, null, 74, 71, 69, null, 71, 74, 71, null, 67, null],
    bass: [43, null, null, null, 48, null, null, null, 50, null, null, null, 43, null, 50, null],
    chords: [
      [55, 59, 62], null, null, null,
      [60, 64, 67], null, null, null,
      [57, 62, 66], null, null, null,
      [55, 59, 62], null, null, null,
    ],
    perc: ['k', null, 's', null, null, null, 's', null, 'k', null, 's', null, null, null, 's', null],
  },
  map: {
    id: 'map',
    title: 'Purple Van Highway Cruise',
    style: 'Upbeat Acoustic Road-Trip Cruise',
    keySignature: 'C major',
    bpm: 114,
    stepsPerBar: 16,
    swing: 0.06,
    leadWave: 'triangle',
    chordWave: 'triangle',
    filterHz: 2400,
    melody: [72, null, 76, 79, 81, 79, 76, null, 74, null, 77, 79, 76, null, 72, null],
    bass: [48, null, 55, null, 53, null, 48, null, 50, null, 55, null, 48, null, 55, null],
    chords: [
      [60, 64, 67], null, [60, 64, 67], null,
      [65, 69, 72], null, [60, 64, 67], null,
      [62, 65, 69], null, [67, 71, 74], null,
      [60, 64, 67], null, [67, 71, 74], null,
    ],
    perc: ['k', null, 's', null, 'k', null, 's', null, 'k', null, 's', null, 'k', 's', 's', null],
  },
  sharon: {
    id: 'sharon',
    title: 'Sharon Seaweed Stand Waltz',
    style: 'New England Autumn 6/8 Folk Waltz',
    keySignature: 'D major',
    bpm: 108,
    stepsPerBar: 12,
    swing: 0,
    leadWave: 'triangle',
    chordWave: 'sine',
    filterHz: 2000,
    // Lilting 6/8 compound meter (2 groups of 6 eighth notes)
    melody: [74, 76, 78, 81, null, 78, 76, 74, 71, 74, null, 69],
    bass: [50, null, null, 57, null, null, 55, null, null, 50, null, null],
    chords: [
      [62, 66, 69], null, null, [62, 66, 69], null, null,
      [59, 62, 67], null, null, [57, 61, 64], null, null,
    ],
    perc: ['k', null, 's', 'k', null, 's', 'k', null, 's', 'k', null, 's'],
  },
  nyc: {
    id: 'nyc',
    title: 'Central Park Ragtime Swing',
    style: 'Sunny Park Light Swing Jazz',
    keySignature: 'F major',
    bpm: 118,
    stepsPerBar: 16,
    swing: 0.18,
    leadWave: 'triangle',
    chordWave: 'sine',
    filterHz: 2300,
    melody: [69, 72, 74, 77, 76, null, 74, 72, 70, 72, 74, 76, 77, null, 72, null],
    bass: [41, null, 45, null, 46, null, 48, null, 43, null, 48, null, 41, null, 48, null],
    chords: [
      [60, 64, 69], null, null, [60, 64, 69],
      [62, 65, 70], null, null, [60, 64, 67],
      [62, 65, 69], null, [60, 64, 70], null,
      [60, 65, 69], null, null, null,
    ],
    perc: ['k', null, 's', 's', 'k', null, 's', null, 'k', null, 's', 's', 'k', null, 's', null],
  },
  chicago: {
    id: 'chicago',
    title: 'Lakefront Diner Shuffle',
    style: 'Cheerful Retro Diner Major Shuffle Blues',
    keySignature: 'A major',
    bpm: 112,
    stepsPerBar: 16,
    swing: 0.22,
    leadWave: 'triangle',
    chordWave: 'triangle',
    filterHz: 1950,
    melody: [69, null, 73, 76, 78, 76, 73, null, 74, null, 78, 81, 76, 73, 69, null],
    bass: [45, null, 49, null, 52, null, 54, null, 50, null, 54, null, 52, null, 49, null],
    chords: [
      [57, 61, 64], null, null, [57, 61, 64],
      [57, 61, 64], null, null, null,
      [62, 66, 69], null, null, [62, 66, 69],
      [64, 68, 71], null, [57, 61, 64], null,
    ],
    perc: ['k', null, 's', null, 'k', 's', 's', null, 'k', null, 's', null, 'k', 's', 's', null],
  },
  austin: {
    id: 'austin',
    title: 'Lake Travis Sunset Two-Step',
    style: 'Golden Texas Oasis Tex-Mex & Acoustic Country',
    keySignature: 'G major',
    bpm: 116,
    stepsPerBar: 16,
    swing: 0.05,
    leadWave: 'triangle',
    chordWave: 'triangle',
    filterHz: 2500,
    melody: [71, 74, 79, null, 78, 76, 74, null, 72, 76, 79, 76, 74, null, 71, null],
    bass: [43, null, 50, null, 43, null, 50, null, 48, null, 55, null, 50, null, 43, null],
    chords: [
      null, [62, 67, 71], null, [62, 67, 71],
      null, [62, 67, 71], null, [62, 67, 71],
      null, [60, 64, 67], null, [60, 64, 67],
      null, [62, 66, 69], null, [62, 67, 71],
    ],
    perc: ['k', 's', 'k', 's', 'k', 's', 'k', 's', 'k', 's', 'k', 's', 'k', 's', 'k', 's'],
  },
  denver: {
    id: 'denver',
    title: 'Rocky Mountain Pine Campfire',
    style: 'Mile High Lodge Bluegrass Folk',
    keySignature: 'D major',
    bpm: 122,
    stepsPerBar: 16,
    swing: 0.04,
    leadWave: 'triangle',
    chordWave: 'triangle',
    filterHz: 2600,
    // Crisp banjo/fiddle-style rolling bluegrass arpeggio
    melody: [74, 78, 81, 78, 74, 76, 78, 81, 79, 76, 74, 71, 73, 76, 74, null],
    bass: [50, null, 57, null, 50, null, 57, null, 55, null, 50, null, 57, null, 50, null],
    chords: [
      null, [62, 66, 69], null, [62, 66, 69],
      null, [62, 66, 69], null, [62, 66, 69],
      null, [59, 62, 67], null, [59, 62, 67],
      null, [61, 64, 69], null, [62, 66, 69],
    ],
    perc: ['k', null, 's', null, 'k', null, 's', null, 'k', null, 's', null, 'k', null, 's', null],
  },
  yosemite: {
    id: 'yosemite',
    title: 'Half Dome Sequoia Meadow',
    style: 'Peaceful Majestic Sierra Harp & Flute',
    keySignature: 'Eb major',
    bpm: 92,
    stepsPerBar: 16,
    swing: 0,
    leadWave: 'sine',
    chordWave: 'sine',
    filterHz: 1850,
    melody: [75, null, 79, 82, 87, null, 82, 79, 80, null, 79, 75, 77, null, 75, null],
    bass: [39, null, null, null, 46, null, null, null, 44, null, null, null, 46, null, null, null],
    chords: [
      [63, 67, 70], null, [70, 75], null,
      [63, 67, 70], null, [70, 75], null,
      [60, 63, 68], null, [68, 72], null,
      [62, 65, 70], null, [63, 67, 70], null,
    ],
    perc: [null, null, 's', null, null, null, 's', null, null, null, 's', null, null, null, 's', null],
  },
  tahoe: {
    id: 'tahoe',
    title: 'Sparkling Alpine Pier',
    style: 'Lake Tahoe Crystalline Bells & Acoustic Breeze',
    keySignature: 'A major',
    bpm: 102,
    stepsPerBar: 16,
    swing: 0.03,
    leadWave: 'sine',
    chordWave: 'triangle',
    filterHz: 2700,
    melody: [81, null, 85, 88, 85, null, 81, 76, 78, null, 81, 85, 83, null, 81, null],
    bass: [45, null, null, 52, 45, null, null, 52, 50, null, null, 57, 52, null, 45, null],
    chords: [
      [61, 64, 69], null, null, null,
      [64, 69, 73], null, null, null,
      [62, 66, 69], null, null, null,
      [64, 68, 71], null, null, null,
    ],
    perc: ['k', null, 's', null, null, null, 's', null, 'k', null, 's', null, null, null, 's', null],
  },
  mountainview: {
    id: 'mountainview',
    title: 'Bay View Dragonscale Sunset Finale',
    style: 'Celebratory Mountain View Bayshore Synth-Pop Finale',
    keySignature: 'C major',
    bpm: 120,
    stepsPerBar: 16,
    swing: 0.06,
    leadWave: 'triangle',
    chordWave: 'sine',
    filterHz: 2800,
    // Joyful celebratory Bayshore finale sparkle!
    melody: [72, 74, 76, 79, 84, null, 81, 79, 76, 79, 81, 84, 86, null, 84, null],
    bass: [48, null, 48, 55, 53, null, 53, 60, 50, null, 55, null, 48, null, 55, null],
    chords: [
      [60, 64, 67], null, [60, 64, 67], null,
      [65, 69, 72], null, [65, 69, 72], null,
      [62, 67, 71], null, [67, 71, 74], null,
      [60, 64, 67], null, [64, 67, 72], null,
    ],
    perc: ['k', null, 's', null, 'k', 's', 's', null, 'k', null, 's', null, 'k', 's', 'k', 's'],
  },
};

export function resolveMusicThemeForScreen(screen: ScreenMode, stopId?: StopId | null): MusicThemeId {
  if (screen === 'kitchen' && stopId && Object.prototype.hasOwnProperty.call(MUSIC_THEMES, stopId)) {
    return stopId;
  }
  return screen === 'map' ? 'map' : 'lobby';
}

class MusicEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private enabled = true;
  private masterMuted = false;
  private ducked = false;
  private pageHidden = false;
  private activeThemeId: MusicThemeId | null = null;
  private stepIndex = 0;
  private stepTimer: ReturnType<typeof setTimeout> | null = null;
  private duckTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly baseVolume = 0.14;

  constructor() {
    this.enabled = this.loadPreference();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.pageHidden = document.hidden;
        if (this.pageHidden) {
          this.stopScheduler();
          this.rampMasterGain(0.0001, 0.15);
        } else {
          this.syncPlayback();
        }
      });
    }
  }

  private loadPreference(): boolean {
    try {
      const raw = globalThis.localStorage?.getItem(MUSIC_PREF_KEY);
      if (raw === 'false') return false;
      if (raw === 'true') return true;
    } catch {
      // ignore storage errors
    }
    return true;
  }

  private savePreference(): void {
    try {
      globalThis.localStorage?.setItem(MUSIC_PREF_KEY, String(this.enabled));
    } catch {
      // ignore storage errors
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get currentThemeId(): MusicThemeId | null {
    return this.activeThemeId;
  }

  setEnabled(next: boolean): void {
    this.enabled = Boolean(next);
    this.savePreference();
    if (this.enabled) {
      this.unlock();
    }
    this.syncPlayback();
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  setMasterMuted(muted: boolean): void {
    this.masterMuted = Boolean(muted);
    this.syncPlayback();
  }

  /**
   * Temporarily softens background music when Kid Helper speaks or fanfares play.
   */
  duck(durationMs = 2200): void {
    this.ducked = true;
    this.applyTargetGain(0.18);
    if (this.duckTimer !== null) clearTimeout(this.duckTimer);
    this.duckTimer = setTimeout(() => {
      this.ducked = false;
      this.applyTargetGain(0.45);
    }, durationMs);
  }

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterFilter = this.ctx.createBiquadFilter();
      this.masterFilter.type = 'lowpass';
      this.masterFilter.frequency.value = 2300;
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.0001;
      this.masterFilter.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
      this.buildNoiseBuffer();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().then(() => this.syncPlayback()).catch(() => {});
    } else {
      this.syncPlayback();
    }
  }

  /**
   * Smoothly crossfades to the musical theme for the current screen or US destination.
   */
  setTheme(themeId: MusicThemeId): void {
    if (this.activeThemeId === themeId) {
      this.syncPlayback();
      return;
    }
    this.activeThemeId = themeId;
    this.stepIndex = 0;

    if (this.ctx && this.masterFilter) {
      const theme = MUSIC_THEMES[themeId];
      this.masterFilter.frequency.setTargetAtTime(theme.filterHz, this.ctx.currentTime, 0.25);
    }

    // Gentle crossfade dip -> glide back in on the new regional motif
    this.rampMasterGain(0.0001, 0.25);
    this.stopScheduler();
    if (this.shouldPlay()) {
      this.stepTimer = setTimeout(() => {
        this.applyTargetGain(0.45);
        this.scheduleNextStep();
      }, 260);
    }
  }

  private shouldPlay(): boolean {
    return (
      this.enabled &&
      !this.masterMuted &&
      !this.pageHidden &&
      this.activeThemeId !== null &&
      this.ctx !== null &&
      this.ctx.state === 'running'
    );
  }

  private applyTargetGain(rampSec = 0.3): void {
    if (!this.shouldPlay()) {
      this.rampMasterGain(0.0001, 0.2);
      return;
    }
    const target = this.ducked ? this.baseVolume * 0.32 : this.baseVolume;
    this.rampMasterGain(target, rampSec);
  }

  private rampMasterGain(target: number, rampSec: number): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(Math.max(0.0001, this.masterGain.gain.value), now);
    this.masterGain.gain.linearRampToValueAtTime(Math.max(0.0001, target), now + rampSec);
  }

  private syncPlayback(): void {
    if (!this.shouldPlay()) {
      this.stopScheduler();
      this.rampMasterGain(0.0001, 0.2);
      return;
    }
    this.applyTargetGain(0.4);
    if (this.stepTimer === null) {
      this.scheduleNextStep();
    }
  }

  private stopScheduler(): void {
    if (this.stepTimer !== null) {
      clearTimeout(this.stepTimer);
      this.stepTimer = null;
    }
  }

  private buildNoiseBuffer(): void {
    if (!this.ctx) return;
    const len = Math.floor(this.ctx.sampleRate * 0.08);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    this.noiseBuffer = buf;
  }

  private scheduleNextStep(): void {
    if (!this.shouldPlay() || !this.activeThemeId || !this.ctx || !this.masterFilter) {
      this.stepTimer = null;
      return;
    }

    const theme = MUSIC_THEMES[this.activeThemeId];
    const step = this.stepIndex % theme.stepsPerBar;
    const baseStepSec = 60 / theme.bpm / 2; // eighth-note feel (warm & musical)
    const swingOffset = step % 2 === 0 ? 1 + theme.swing : 1 - theme.swing;
    const stepDurationSec = baseStepSec * swingOffset;

    const now = this.ctx.currentTime + 0.015;

    // 1) Lead regional melody note
    const melMidi = theme.melody[step];
    if (typeof melMidi === 'number') {
      this.playVoice(midiToFreq(melMidi), theme.leadWave, now, baseStepSec * 1.45, 0.34);
    }

    // 2) Warm bass note
    const bassMidi = theme.bass[step];
    if (typeof bassMidi === 'number') {
      this.playVoice(midiToFreq(bassMidi), 'triangle', now, baseStepSec * 1.7, 0.38);
    }

    // 3) Soft harmonic triad chord
    const chord = theme.chords[step];
    if (chord && chord.length > 0) {
      const perNoteGain = 0.2 / chord.length;
      for (const midi of chord) {
        this.playVoice(midiToFreq(midi), theme.chordWave, now, baseStepSec * 2.1, perNoteGain);
      }
    }

    // 4) Gentle brushed percussion
    const p = theme.perc[step];
    if (p === 'k') {
      this.playSoftKick(now);
    } else if (p === 's') {
      this.playSoftBrush(now);
    }

    this.stepIndex = (this.stepIndex + 1) % theme.stepsPerBar;
    this.stepTimer = setTimeout(() => this.scheduleNextStep(), Math.round(stepDurationSec * 1000));
  }

  private playVoice(
    freq: number,
    wave: OscillatorType,
    startTime: number,
    durationSec: number,
    peakGain: number,
  ): void {
    if (!this.ctx || !this.masterFilter) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    osc.connect(gain);
    gain.connect(this.masterFilter);
    osc.start(startTime);
    osc.stop(startTime + durationSec + 0.03);
  }

  private playSoftKick(startTime: number): void {
    if (!this.ctx || !this.masterFilter) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(115, startTime);
    osc.frequency.exponentialRampToValueAtTime(48, startTime + 0.11);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(0.22, startTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.13);

    osc.connect(gain);
    gain.connect(this.masterFilter);
    osc.start(startTime);
    osc.stop(startTime + 0.15);
  }

  private playSoftBrush(startTime: number): void {
    if (!this.ctx || !this.masterFilter || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 3400;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.05, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.07);

    src.connect(hp);
    hp.connect(gain);
    gain.connect(this.masterFilter);
    src.start(startTime);
  }
}

export const musicEngine = new MusicEngine();
