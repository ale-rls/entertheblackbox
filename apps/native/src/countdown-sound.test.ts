import { describe, expect, it } from 'vitest';
import type { Snapshot } from './cues';
import { countdownAudible, countdownSound, countdownWave, CountdownTicker } from './countdown-sound';

const snapshot = (extra: object = {}) => ({ t: 'snapshot', v: 2, sessionId: 's', phaseEpoch: 1, serverTime: 0,
  phase: { id: 'p', kind: 'narration', text: 'x', durationMs: 1000, next: 'end', scenarioVersion: 'v', startedAt: 0, deadlineAt: 1000 }, ...extra }) as Snapshot;

describe('audible monitor countdown', () => {
  it('ticks once per new number and plays the end tone when 1 runs out', () => {
    const played: string[] = [];
    const ticker = new CountdownTicker(sound => played.push(sound));
    ticker.sample(0, null);
    ticker.sample(100, 3); ticker.sample(200, 3);
    ticker.sample(1_100, 2); ticker.sample(2_100, 1); ticker.sample(3_000, 1);
    ticker.sample(3_100, null); ticker.sample(3_200, null);
    expect(played).toEqual(['tick', 'tick', 'tick', 'end']);
  });

  it('plays no end tone after a long gap or when a count stops early', () => {
    expect(countdownSound({ at: 0, seconds: 1 }, { at: 5_000, seconds: null })).toBeNull();
    expect(countdownSound({ at: 0, seconds: 3 }, { at: 100, seconds: null })).toBeNull();
  });

  it('is heard by the KI side and its groups, not by cursor-voting groups', () => {
    expect(countdownAudible(snapshot())).toBe(true);
    expect(countdownAudible(snapshot({ currentGroup: { id: 'ki', label: 'KI', votingMethod: 'physical' } }))).toBe(true);
    expect(countdownAudible(snapshot({ currentGroup: { id: 'arbeit-buehne', label: 'Bühnenarbeit', votingMethod: 'physical' } }))).toBe(true);
    expect(countdownAudible(snapshot({ currentGroup: { id: 'theater', label: 'Theater', votingMethod: 'phone-cursor' } }))).toBe(false);
    expect(countdownAudible(snapshot({ participantState: 'finished' }))).toBe(false);
    expect(countdownAudible(null)).toBe(false);
  });

  it('generates valid short WAV files', () => {
    for (const sound of ['tick', 'end'] as const) {
      const wav = countdownWave(sound);
      expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
      expect(new DataView(wav.buffer).getUint32(40, true)).toBe(wav.length - 44);
    }
    expect(countdownWave('end').length).toBeGreaterThan(countdownWave('tick').length);
  });
});
