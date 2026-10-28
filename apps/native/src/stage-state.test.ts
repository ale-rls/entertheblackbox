import { describe, expect, it } from 'vitest';
import type { ClockTiming } from '@entertheblackbox/protocol';
import type { Snapshot } from './cues';
import type { Voting, Groups } from './action-prompt';
import { playbackState, stageState, type StageInput } from './stage-state';
const snapshot: Snapshot = { t: 'snapshot', v: 2, sessionId: 's', phaseEpoch: 1, serverTime: 100,
  phase: { id: 'n', kind: 'narration', text: 'Listen to the room', durationMs: 1000, next: 'end', scenarioVersion: 'v', startedAt: 100, deadlineAt: 1100 } };
const vote: Voting = { t: 'voting_options', v: 2, sessionId: 's', phaseEpoch: 1, method: 'phone-buttons', question: 'Choose', options: [{ id: 'a', label: 'A' }] };
const groups: Groups = { t: 'group_selection_options', v: 2, sessionId: 's', phaseEpoch: 1, groups: [{ id: 'a', label: 'A' }], selectedGroupId: null };
const input: StageInput = { connected: true, busy: false, status: 'Connected', error: '', audioStatus: 'Playing', paused: false, snapshot, voting: null, groups: null, now: 200 };
describe('Stage companion state boundaries', () => {
  it('preserves choices but disables action during reconnect or admission failure', () => {
    for (const status of ['Connecting', 'Disconnected — retrying', 'Join rejected: full']) {
      const state = stageState({ ...input, status, voting: vote, groups });
      expect(state.canAct).toBe(false); expect(state.cursorOpen).toBe(false); expect(state.ratingOpen).toBe(false);
      expect(state.title).not.toBe('Choose');
    }
    expect(stageState({ ...input, status: 'Connected', voting: vote }).canAct).toBe(true);
  });
  it('ignores stale choices from another phase or session', () => {
    expect(stageState({ ...input, voting: { ...vote, phaseEpoch: 0 }, groups: { ...groups, sessionId: 'old' } })).toMatchObject({ voting: null, groups: null, title: 'Listen closely' });
  });
  it('closes timed actions at the deadline and for finished/unassigned participants', () => {
    expect(stageState({ ...input, voting: vote, now: 1100 })).toMatchObject({ canAct: false, title: 'Voting has closed' });
    for (const participantState of ['finished', 'unassigned'] as const) expect(stageState({ ...input, snapshot: { ...snapshot, participantState }, voting: vote }).canAct).toBe(false);
    expect(stageState({ ...input, now: 99 }).canAct).toBe(false);
  });
  it('distinguishes physical, phone cursor, hidden cursor and closed vote states', () => {
    expect(stageState({ ...input, voting: { ...vote, method: 'physical' } })).toMatchObject({ cursorOpen: false, body: 'Move to your answer in the room.' });
    expect(stageState({ ...input, voting: { ...vote, method: 'phone-cursor' } }).cursorOpen).toBe(true);
    expect(stageState({ ...input, voting: { ...vote, method: 'phone-cursor', closed: true } })).toMatchObject({ cursorOpen: false, title: 'Voting has closed' });
    const hidden = { ...snapshot, phase: { ...snapshot.phase, showCursors: false } } as Snapshot;
    expect(stageState({ ...input, snapshot: hidden, voting: { ...vote, method: 'phone-cursor' } }).cursorOpen).toBe(false);
  });
  it('keeps the group and rating actions in their server-owned windows', () => {
    expect(stageState({ ...input, groups }).title).toBe('Choose your group');
    const rated = { ...snapshot, phase: { ...snapshot.phase, rating: { candidateLabel: 'A', windows: [{ startAtMs: 100, endAtMs: 200 }] } } } as Snapshot;
    expect(stageState({ ...input, snapshot: rated, now: 199 }).ratingOpen).toBe(false);
    expect(stageState({ ...input, snapshot: rated, now: 200 }).ratingOpen).toBe(true);
    expect(stageState({ ...input, snapshot: rated, now: 300 }).ratingOpen).toBe(false);
  });
  it('presents pause, audio failure, preparation failure and show end with recovery copy', () => {
    expect(stageState({ ...input, paused: true }).title).toBe('Your audio is paused');
    expect(stageState({ ...input, audioStatus: 'Missing downloaded audio: voice.mp3' }).title).toBe('Audio needs attention');
    expect(stageState({ ...input, connected: false, error: 'Download failed' }).title).toBe('Something needs attention');
    expect(stageState({ ...input, connected: false, status: 'Show ended. Join again for the next performance.' }).title).toBe('Thank you for being here');
  });
});
it('visualizes actual playing layers, including music-only scenes, but never scheduled/paused/ended audio', () => {
  const timing = (states: ClockTiming['media'][number]['state'][]): ClockTiming => ({ calibrated: true, offsetMs: 0, roundTripMs: 0, sampleAgeMs: 0, elapsedMs: 0, mode: 'synchronized', media: states.map((state, i) => ({ role: i ? 'extra' : 'main', state, positionMs: null, targetMs: null, driftMs: null })) });
  expect(playbackState(timing(['ended', 'playing'])).playing).toBe(true);
  for (const state of ['waiting', 'loading', 'paused', 'ended', 'error'] as const) expect(playbackState(timing([state])).playing).toBe(false);
  expect(playbackState(timing([])).playing).toBe(false);
});
