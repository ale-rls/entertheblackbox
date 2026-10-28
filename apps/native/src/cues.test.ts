import { describe, expect, it } from 'vitest';
import { NARRATION_START_DELAY_MS, acceptsSnapshot, cueFromSnapshot, targetPosition, type Snapshot } from './cues';
const snapshot: Snapshot = { t: 'snapshot', v: 2, sessionId: 'session', phaseEpoch: 4, serverTime: 1000,
  phoneAudioActive: true, currentGroup: { id: 'blue', label: 'Blue' },
  phase: { id: 'voice', kind: 'narration', text: 'Test', durationMs: 10000, next: 'idle', scenarioVersion: 'one',
    startedAt: 1000, deadlineAt: 11000, phoneAudioSrc: 'all.mp3', phoneAudioByGroup: { blue: 'blue.mp3' } } };
describe('server cues', () => {
  it('uses group audio, delays narration by the shared lead, and seeks late arrivals to the shared timeline', () => {
    const cue = cueFromSnapshot(snapshot)!;
    expect(cue.src).toBe('blue.mp3');
    expect(cue).toMatchObject({ startedAt: 1000 + NARRATION_START_DELAY_MS, endsAt: 11000 + NARRATION_START_DELAY_MS });
    expect(targetPosition(cue, 5000 + NARRATION_START_DELAY_MS)).toBe(4);
    expect(targetPosition(cue, 1000)).toBeNull();
    expect(targetPosition(cue, 11000 + NARRATION_START_DELAY_MS)).toBeNull();
  });
  it('keeps video phase audio on the phase clock, in step with the display video', () => {
    const video = { ...snapshot, phase: { id: 'film', kind: 'video', src: 'film.mp4', expectedDurationMs: 10000, next: 'idle',
      scenarioVersion: 'one', startedAt: 1000, deadlineAt: 11000, phoneAudioSrc: 'film.mp3' } } as unknown as Snapshot;
    expect(cueFromSnapshot(video)).toMatchObject({ startedAt: 1000, endsAt: 11000 });
  });
  it('stops for silent or unassigned participants', () => {
    expect(cueFromSnapshot({ ...snapshot, phoneAudioActive: false })).toBeNull();
    expect(cueFromSnapshot({ ...snapshot, participantState: 'unassigned' })).toBeNull();
    expect(cueFromSnapshot({ ...snapshot, participantState: 'finished' })).toBeNull();
  });
  it('uses fallback audio and changes cue identity when transferred', () => {
    const next = { ...snapshot, currentGroup: null, routingEpoch: 1 };
    expect(cueFromSnapshot(next)?.src).toBe('all.mp3');
    expect(cueFromSnapshot(next)?.key).not.toBe(cueFromSnapshot(snapshot)?.key);
  });
  it('rejects stale phase/routing state but accepts transfer to an older phase', () => {
    expect(acceptsSnapshot(snapshot, { ...snapshot, phaseEpoch: 3 })).toBe(false);
    expect(acceptsSnapshot({ ...snapshot, routingEpoch: 2 }, { ...snapshot, phaseEpoch: 8, routingEpoch: 1 })).toBe(false);
    expect(acceptsSnapshot(snapshot, { ...snapshot, phaseEpoch: 1, routingEpoch: 1 })).toBe(true);
    expect(acceptsSnapshot(snapshot, { ...snapshot, sessionId: 'new', phaseEpoch: 0 })).toBe(true);
  });
});
