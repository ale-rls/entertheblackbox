import { describe, it, expect } from 'vitest';
import { participantTaskSchema, taskAudioSources, validateScenario } from '@entertheblackbox/scenario';
import { TaskEngine } from './task-engine.js';

const audio = (src: string) => ({ src, durationMs: 1000 });
// First three to pick the lead role are cast in order; everyone after them joins the chorus.
const casting = participantTaskSchema.parse({
  id: 'casting', title: 'Casting', question: 'Which job?', notificationBody: 'Choose', durationMs: 60_000,
  fullAudio: audio('full.mp3'), fullMessage: 'Taken, choose again.',
  options: [
    { id: 'lead', label: 'Lead', capacity: 3, message: 'Cast.',
      rankOutcomes: [
        { roleId: 'vector', groupId: 'vector', audio: audio('cast-1.mp3'), message: 'You play VECTOR.' },
        { roleId: 'patch', groupId: 'patch', audio: audio('cast-2.mp3') },
        { roleId: 'oracle', groupId: 'oracle', audio: audio('cast-3.mp3') },
      ],
      overflow: { groupId: 'chorus', audio: audio('to-chorus.mp3'), message: 'You join the chorus.' } },
    { id: 'stage', label: 'Stage', capacity: 1, message: 'Stage job.' },
    { id: 'none', label: 'None' },
  ],
});
function engine(groupFails: string[] = []) {
  const groups = new Map<string, string>();
  const e = new TaskEngine();
  e.configureRoles(['vector', 'patch', 'oracle'].map(id => ({ id, label: id, capacity: 1 })));
  e.configureWorkflow([casting], { assignGroup: (id, group) => { if (groupFails.includes(group)) return false; groups.set(id, group); return true; }, winner: () => null });
  return { e, groups };
}
const recipient = (e: TaskEngine, id: string) => e.current(id, 's')!.recipient;

describe('task outcomes', () => {
  it('casts by acceptance order and sends later responses to the overflow outcome', () => {
    const { e, groups } = engine(); const t = e.open(casting, 's', ['a', 'b', 'c', 'd', 'f'], 0);
    for (const [i, id] of ['c', 'a', 'd', 'b'].entries()) expect(e.respond(t.id, 's', id, 'lead', 10 + i)).toBe(true);
    expect(['c', 'a', 'd', 'b'].map(id => [groups.get(id), recipient(e, id).status, recipient(e, id).outcome, recipient(e, id).audio?.src])).toEqual([
      ['vector', 'accepted', 'rank-1', 'cast-1.mp3'], ['patch', 'accepted', 'rank-2', 'cast-2.mp3'],
      ['oracle', 'accepted', 'rank-3', 'cast-3.mp3'], ['chorus', 'answered', 'overflow', 'to-chorus.mp3']]);
    // A rank without its own message falls back to the option's.
    expect([recipient(e, 'c').message, recipient(e, 'a').message, recipient(e, 'b').message]).toEqual(['You play VECTOR.', 'Cast.', 'You join the chorus.']);
    expect(e.roleAssignments().map(a => [a.participantId, a.roleId])).toEqual([['c', 'vector'], ['a', 'patch'], ['d', 'oracle']]);
    // Overflow arrivals hold no place: the option still counts exactly its capacity.
    expect(e.respond(t.id, 's', 'f', 'lead', 20)).toBe(true);
    expect(recipient(e, 'f').outcome).toBe('overflow');
  });
  it('falls back to overflow when the rank role is still held from an earlier task', () => {
    const { e, groups } = engine(); e.assignRole('earlier', 'vector', 'admin', 0);
    const t = e.open(casting, 's', ['a'], 1);
    e.respond(t.id, 's', 'a', 'lead', 2);
    expect([groups.get('a'), recipient(e, 'a').outcome, e.roleAssignments().length]).toEqual(['chorus', 'overflow', 1]);
  });
  it('rolls back a rank role when its group cannot be assigned', () => {
    const { e } = engine(['vector', 'chorus']); const t = e.open(casting, 's', ['a'], 0);
    e.respond(t.id, 's', 'a', 'lead', 1);
    expect([recipient(e, 'a').status, e.roleAssignments()]).toEqual(['full', []]);
  });
  it('plays the full recording with the full message and lets the recipient choose again', () => {
    const { e } = engine(); const t = e.open(casting, 's', ['a', 'b'], 0);
    e.respond(t.id, 's', 'a', 'stage', 1); e.respond(t.id, 's', 'b', 'stage', 2);
    expect([recipient(e, 'b').status, recipient(e, 'b').message, recipient(e, 'b').audio]).toEqual(['full', 'Taken, choose again.', { src: 'full.mp3', durationMs: 1000, startedAt: 402 }]);
    e.respond(t.id, 's', 'b', 'none', 3);
    expect([recipient(e, 'b').status, recipient(e, 'b').audio, recipient(e, 'b').outcome]).toEqual(['answered', undefined, undefined]);
  });
  it('keeps an introduction playing when a full option has no full recording', () => {
    const intro = participantTaskSchema.parse({ ...casting, audio: audio('intro.mp3'), fullAudio: undefined });
    const { e } = engine(); const t = e.open(intro, 's', ['a', 'b'], 0);
    e.respond(t.id, 's', 'a', 'stage', 1); e.respond(t.id, 's', 'b', 'stage', 2);
    expect(recipient(e, 'b').audio?.src).toBe('intro.mp3');
  });
  it('bundles every outcome recording and validates outcome targets', () => {
    expect(taskAudioSources([casting]).sort()).toEqual(['cast-1.mp3', 'cast-2.mp3', 'cast-3.mp3', 'full.mp3', 'to-chorus.mp3']);
    const scenario = { version: 'v', entryPhaseId: 'idle', phases: [{ id: 'idle', kind: 'idle' }],
      groups: [{ id: 'vector', label: 'V' }], participantRoles: [{ id: 'vector', label: 'V' }],
      participantTasks: [{ ...casting, options: [{ id: 'x', label: 'X', message: '', rankOutcomes: [{ roleId: 'vector', groupId: 'vector' }, { roleId: 'ghost' }], overflow: { groupId: 'nowhere' }, capacity: 1 }] }] };
    const result = validateScenario(scenario as never);
    expect(result.errors.map(e => e.message)).toEqual(expect.arrayContaining([expect.stringContaining('rank 2 references unknown role ghost'), expect.stringContaining('overflow assigns unknown group nowhere')]));
    expect(result.warnings.map(w => w.code)).toContain('unused-rank-outcome');
  });
});
