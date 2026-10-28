import { describe, expect, it, vi } from 'vitest';
import { actionPrompt, ActionAlerts, type Voting, type Groups } from './action-prompt';
import type { Snapshot } from './cues';
const s: Snapshot = { t: 'snapshot', v: 2, sessionId: 's', phaseEpoch: 1, serverTime: 100,
  phase: { id: 'n', kind: 'narration', text: '', durationMs: 1000, next: 'end', scenarioVersion: 'v', startedAt: 100, deadlineAt: 1100 } };
const vote: Voting = { t: 'voting_options', v: 2, sessionId: 's', phaseEpoch: 1, method: 'phone-buttons', question: '?', options: [] };
const groups: Groups = { t: 'group_selection_options', v: 2, sessionId: 's', phaseEpoch: 1, groups: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], selectedGroupId: null };
describe('action eligibility', () => {
  it('alerts only for current, open phone voting', () => {
    expect(actionPrompt(s, vote, null, 200)?.body).toContain('answer');
    for (const v of [{ ...vote, closed: true }, { ...vote, phaseEpoch: 0 }, { ...vote, sessionId: 'old' }, { ...vote, method: 'physical' as const }]) expect(actionPrompt(s, v, null, 200)).toBeNull();
    expect(actionPrompt(s, vote, null, 1100)).toBeNull();
    expect(actionPrompt({ ...s, participantState: 'finished' }, vote, null, 200)).toBeNull();
  });
  it('alerts for group choice until selected, and separates routing changes', () => {
    expect(actionPrompt(s, null, groups, 200)?.body).toContain('group');
    expect(actionPrompt(s, null, { ...groups, selectedGroupId: 'a' }, 200)).toBeNull();
    expect(actionPrompt({ ...s, routingEpoch: 2 }, vote, null, 200)?.key).not.toBe(actionPrompt(s, vote, null, 200)?.key);
  });
  it('opens and expires distinct reaction windows', () => {
    const rated = { ...s, phase: { ...s.phase, rating: { candidateLabel: 'A', windows: [{ startAtMs: 100, endAtMs: 200 }, { startAtMs: 300, endAtMs: 400 }] } } } as Snapshot;
    expect(actionPrompt(rated, null, null, 199)).toBeNull();
    const first = actionPrompt(rated, null, null, 200);
    expect(first?.body).toContain('reaction');
    expect(actionPrompt(rated, null, null, 300)).toBeNull();
    expect(actionPrompt(rated, null, null, 400)?.key).not.toBe(first?.key);
    expect(actionPrompt(rated, null, null, 500)).toBeNull();
  });
  it('does not alert for passive scenes', () => expect(actionPrompt(s, null, null, 200)).toBeNull());
});
describe('notification lifecycle', () => {
  it('deduplicates snapshots and reconnects, clearing obsolete alerts', async () => {
    const show = vi.fn(async () => 'id'), dismiss = vi.fn(async () => {});
    const a = new ActionAlerts(show, dismiss, vi.fn());
    const p = { key: 'one', body: 'Choose' };
    a.update(p); a.update(p); await a.settled();
    expect(show).toHaveBeenCalledTimes(1);
    a.update(null); await a.settled();
    expect(dismiss).toHaveBeenCalledWith('id');
    a.update(p); await a.settled();
    expect(show).toHaveBeenCalledTimes(1);
  });
  it('removes a delivery that finishes after a phase change', async () => {
    let finish!: (id: string) => void;
    const dismiss = vi.fn(async () => {});
    const a = new ActionAlerts(() => new Promise(resolve => { finish = resolve; }), dismiss, vi.fn());
    a.update({ key: 'old', body: 'Old' });
    await Promise.resolve();
    a.update(null); finish('old-id'); await a.settled();
    expect(dismiss).toHaveBeenCalledWith('old-id');
  });
  it('recovers from OS errors for subsequent actions', async () => {
    const show = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue('new-id');
    const failed = vi.fn();
    const a = new ActionAlerts(show, async () => {}, failed);
    a.update({ key: 'one', body: 'One' }); await a.settled();
    a.update({ key: 'two', body: 'Two' }); await a.settled();
    expect(failed).toHaveBeenCalledOnce(); expect(show).toHaveBeenCalledTimes(2);
  });
});
