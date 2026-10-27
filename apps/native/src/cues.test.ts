import { describe, expect, it } from 'vitest';
import { acceptsSnapshot, cueFromSnapshot, targetPosition, type Snapshot } from './cues';
const snapshot: Snapshot = { t: 'snapshot', v: 2, sessionId: 'session', phaseEpoch: 4, serverTime: 1000,
  phoneAudioActive: true, currentGroup: { id: 'blue', label: 'Blue' },
  phase: { id: 'voice', kind: 'narration', text: 'Test', durationMs: 10000, next: 'idle', scenarioVersion: 'one',
    startedAt: 1000, deadlineAt: 11000, phoneAudioSrc: 'all.mp3', phoneAudioByGroup: { blue: 'blue.mp3' } } };
describe('server cues', () => {
  it('uses group audio and seeks late arrivals to the shared timeline', () => {
    const cue = cueFromSnapshot(snapshot)!;
    expect(cue.src).toBe('blue.mp3');
    expect(targetPosition(cue, 5000)).toBe(4);
    expect(targetPosition(cue, 900)).toBeNull();
    expect(targetPosition(cue, 11000)).toBeNull();
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
