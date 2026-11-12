import { describe, expect, it } from 'vitest';
import type { Snapshot } from './cues';
import { tabletTextFromSnapshot } from './tablet-text';
const snapshot = { t: 'snapshot', v: 2, sessionId: 'session', phaseEpoch: 1, serverTime: 0,
  currentGroup: { id: 'chorus', label: 'Chorus' },
  phase: { id: 'scene', kind: 'narration', text: 'Display', durationMs: 1000, next: 'idle', scenarioVersion: 'one',
    startedAt: 0, deadlineAt: 1000, tabletText: 'Everyone', tabletTextByGroup: { chorus: '  Chorus lines  ', crew: '' } } } as Snapshot;
const withGroup = (id: string | null) => ({ ...snapshot, currentGroup: id ? { id, label: id } : null }) as Snapshot;
describe('tablet text', () => {
  it('uses the group text, trimmed, over the default', () => {
    expect(tabletTextFromSnapshot(snapshot)).toBe('Chorus lines');
  });
  it('falls back to the default without a group text, and an empty group text hides it', () => {
    expect(tabletTextFromSnapshot(withGroup('leads'))).toBe('Everyone');
    expect(tabletTextFromSnapshot(withGroup(null))).toBe('Everyone');
    expect(tabletTextFromSnapshot(withGroup('crew'))).toBeNull();
  });
  it('shows nothing when idle, unassigned, finished, or in a scene without text', () => {
    expect(tabletTextFromSnapshot(null)).toBeNull();
    expect(tabletTextFromSnapshot({ ...snapshot, participantState: 'unassigned' })).toBeNull();
    expect(tabletTextFromSnapshot({ ...snapshot, participantState: 'finished' })).toBeNull();
    expect(tabletTextFromSnapshot({ ...snapshot, phase: { ...snapshot.phase, tabletText: undefined, tabletTextByGroup: undefined } } as Snapshot)).toBeNull();
    expect(tabletTextFromSnapshot({ ...snapshot, phase: { id: 'idle', kind: 'idle', scenarioVersion: 'one', startedAt: 0, deadlineAt: null } } as Snapshot)).toBeNull();
  });
});
