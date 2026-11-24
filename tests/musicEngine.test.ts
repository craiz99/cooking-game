import { describe, expect, it } from 'vitest';
import {
  MUSIC_THEMES,
  midiToFreq,
  musicEngine,
  resolveMusicThemeForScreen,
} from '../client/src/audio/musicEngine.js';
import { STOPS } from '../shared/stops.js';

describe('Place-Appropriate Regional Background Music Engine (PR #15)', () => {
  it('defines a unique, valid musical theme for Lobby, Map, and all 8 US destinations', () => {
    const requiredIds = ['lobby', 'map', ...STOPS.map((s) => s.id)] as const;
    expect(Object.keys(MUSIC_THEMES)).toHaveLength(10);

    const titles = new Set<string>();
    const styles = new Set<string>();

    for (const id of requiredIds) {
      const theme = MUSIC_THEMES[id];
      expect(theme, `Missing theme for ${id}`).toBeDefined();
      expect(theme.id).toBe(id);
      expect(theme.bpm).toBeGreaterThanOrEqual(85);
      expect(theme.bpm).toBeLessThanOrEqual(130);
      expect(theme.melody).toHaveLength(theme.stepsPerBar);
      expect(theme.bass).toHaveLength(theme.stepsPerBar);
      expect(theme.chords).toHaveLength(theme.stepsPerBar);
      expect(theme.perc).toHaveLength(theme.stepsPerBar);

      // Must contain actual musical notes in valid audible MIDI ranges
      const melodyNotes = theme.melody.filter((n): n is number => typeof n === 'number');
      expect(melodyNotes.length).toBeGreaterThanOrEqual(6);
      for (const midi of melodyNotes) {
        expect(midi).toBeGreaterThanOrEqual(48);
        expect(midi).toBeLessThanOrEqual(96);
        const hz = midiToFreq(midi);
        expect(hz).toBeGreaterThan(100);
        expect(hz).toBeLessThan(2500);
      }

      titles.add(theme.title);
      styles.add(theme.style);
    }

    // All 10 places have distinct musical identities
    expect(titles.size).toBe(10);
    expect(styles.size).toBe(10);
  });

  it('resolves the matching regional theme for each screen and stop', () => {
    expect(resolveMusicThemeForScreen('lobby')).toBe('lobby');
    expect(resolveMusicThemeForScreen('map')).toBe('map');
    for (const stop of STOPS) {
      expect(resolveMusicThemeForScreen('kitchen', stop.id)).toBe(stop.id);
    }
    expect(resolveMusicThemeForScreen('kitchen', null)).toBe('lobby');
  });

  it('handles theme switching, toggling, mute syncing, and ducking cleanly without throwing in headless environments', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 5);
    expect(midiToFreq(60)).toBeCloseTo(261.6256, 3);

    musicEngine.setTheme('austin');
    expect(musicEngine.currentThemeId).toBe('austin');
    musicEngine.setTheme('tahoe');
    expect(musicEngine.currentThemeId).toBe('tahoe');

    const initial = musicEngine.isEnabled;
    expect(musicEngine.toggle()).toBe(!initial);
    expect(musicEngine.toggle()).toBe(initial);

    musicEngine.setMasterMuted(true);
    musicEngine.duck(500);
    musicEngine.setMasterMuted(false);
    musicEngine.setEnabled(true);
  });
});
