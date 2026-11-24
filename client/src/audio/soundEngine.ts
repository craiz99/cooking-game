import type { AnimalId } from '@shared/types';

/**
 * Procedural Web Audio sound effects engine + optional gentle Web Speech hints
 * for Kid Helper Mode. Zero external audio dependencies; unlocks cleanly on first iPad tap.
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  muted = false;
  voiceHints = true;
  private lastSpokenText = '';
  private lastSpokenAt = 0;

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx?.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  private tone(
    freq: number,
    durationSec: number,
    type: OscillatorType = 'sine',
    gainPeak = 0.14,
    delaySec = 0,
    endFreq?: number,
  ): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const start = this.ctx.currentTime + delaySec;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + durationSec);
    }

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(gainPeak, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(start);
    osc.stop(start + durationSec + 0.02);
  }

  private noiseBurst(durationSec: number, filterFreq: number, gainPeak = 0.12, delaySec = 0): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const sampleCount = Math.floor(this.ctx.sampleRate * durationSec);
    const buffer = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    const start = this.ctx.currentTime + delaySec;
    gain.gain.setValueAtTime(gainPeak, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + durationSec);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start(start);
  }

  playPickup(): void {
    this.tone(440, 0.09, 'triangle', 0.12, 0, 620);
  }

  playCombine(): void {
    this.tone(523, 0.1, 'triangle', 0.14, 0);
    this.tone(659, 0.11, 'triangle', 0.14, 0.07);
    this.tone(784, 0.16, 'sine', 0.16, 0.14);
  }

  playCookDone(): void {
    this.tone(880, 0.12, 'sine', 0.13, 0);
    this.tone(1174, 0.2, 'sine', 0.15, 0.09);
  }

  playServe(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
      this.tone(f, 0.18, 'triangle', 0.16, idx * 0.07);
    });
  }

  playStarFanfare(): void {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, idx) => {
      this.tone(f, 0.26, 'triangle', 0.16, idx * 0.09);
    });
  }

  playVanHonk(): void {
    this.tone(360, 0.14, 'sawtooth', 0.09, 0, 355);
    this.tone(450, 0.14, 'sawtooth', 0.08, 0, 445);
    this.tone(360, 0.18, 'sawtooth', 0.09, 0.18, 355);
    this.tone(450, 0.18, 'sawtooth', 0.08, 0.18, 445);
  }

  playPing(): void {
    this.tone(740, 0.14, 'sine', 0.15, 0, 987);
    this.tone(987, 0.2, 'sine', 0.15, 0.12);
  }

  /**
   * Plays a joyful, distinct custom sound for each of the 6 animal chefs!
   */
  playAnimalEmote(animalId: AnimalId): void {
    switch (animalId) {
      case 'purple_cat':
        // Magical crescent moonbeam harp shimmer + soft purr
        [659, 880, 1175, 1318].forEach((f, i) => this.tone(f, 0.22, 'sine', 0.12, i * 0.065));
        break;
      case 'orange_dog':
        // Playful double arf-arf!
        this.tone(340, 0.11, 'triangle', 0.16, 0, 520);
        this.tone(380, 0.13, 'triangle', 0.16, 0.15, 580);
        this.tone(880, 0.15, 'sine', 0.1, 0.3);
        break;
      case 'panda':
        // Crisp bamboo munch-crunch-crunch!
        this.noiseBurst(0.09, 1800, 0.18, 0);
        this.tone(240, 0.07, 'square', 0.06, 0, 180);
        this.noiseBurst(0.09, 2100, 0.18, 0.16);
        this.tone(260, 0.07, 'square', 0.06, 0.16, 190);
        this.noiseBurst(0.11, 1900, 0.18, 0.32);
        break;
      case 'fox':
        // Playful yip + swirling autumn leaf whoosh
        this.tone(620, 0.12, 'triangle', 0.15, 0, 960);
        this.noiseBurst(0.24, 900, 0.1, 0.1);
        this.tone(740, 0.13, 'triangle', 0.13, 0.18, 1080);
        break;
      case 'skunk':
        // Hilarious bubbly cartoon giggle-fart (pffft-boing!)
        this.tone(155, 0.34, 'sawtooth', 0.16, 0, 68);
        this.tone(125, 0.28, 'square', 0.08, 0.05, 55);
        this.noiseBurst(0.26, 360, 0.15, 0.02);
        // Cheeky cartoon boing after!
        this.tone(320, 0.18, 'sine', 0.12, 0.34, 680);
        break;
      case 'purple_bat':
        // Adorable tiny ultrasonic squeak-twinkle!
        this.tone(1320, 0.08, 'sine', 0.12, 0, 1760);
        this.tone(1480, 0.08, 'sine', 0.12, 0.11, 1980);
        this.tone(1568, 0.16, 'triangle', 0.11, 0.22, 2093);
        break;
    }
  }

  speakHint(text: string): void {
    if (this.muted || !this.voiceHints || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    const now = Date.now();
    if (text === this.lastSpokenText && now - this.lastSpokenAt < 9000) return;
    if (now - this.lastSpokenAt < 3500) return;
    this.lastSpokenText = text;
    this.lastSpokenAt = now;

    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.98;
      utter.pitch = 1.12;
      utter.volume = 0.85;
      window.speechSynthesis.speak(utter);
    } catch {
      // Speech synthesis is purely optional
    }
  }
}

export const soundEngine = new SoundEngine();
