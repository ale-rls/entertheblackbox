import { describe, it, expect } from 'vitest';
import type { WebSocket } from 'ws';
import { scenarioSchema, validateScenario } from '@entertheblackbox/scenario';
import { ParticipantRegistry } from '../admission/registry.js';
import { PhaseEngine } from './phase-engine.js';

const intro = (text: string, src?: string) => ({ notificationBody: `Notify ${text}`, text, ...(src ? { audio: { src, durationMs: 20000 } } : {}) });
const scenario = scenarioSchema.parse({
  version: 'assign-rest-test', entryPhaseId: 'hold',
  groups: [
    { id: 'ki', label: 'KI' },
    { id: 'theater', label: 'Theater' },
    { id: 'vector', label: 'VECTOR', introduction: intro('Du bist VECTOR', 'vector.mp3') },
    { id: 'patch', label: 'PATCH', introduction: intro('Du bist PATCH', 'patch.mp3') },
    { id: 'buehne', label: 'Bühne', introduction: intro('Bühnenarbeit', 'buehne.mp3') },
    { id: 'chor', label: 'Chor', introduction: intro('Chor und Choreo') },
  ],
  staffAssignments: [{ id: 'vector', label: 'VECTOR', groupId: 'vector' }],
  assignRest: { fromGroupId: 'ki', leadGroupIds: ['vector', 'patch'], fill: [{ groupId: 'buehne', min: 2, max: 4, share: 1 / 3 }], restGroupId: 'chor' },
  phases: [{ kind: 'idle', id: 'idle' }, { kind: 'narration', id: 'hold', text: 'Casting', durationMs: 600000, next: 'idle' }],
});

class Socket { readyState = 1; sent: any[] = []; send(raw: string) { this.sent.push(JSON.parse(raw)); } close() { this.readyState = 3; } }

function setup() {
  let now = 100;
  const registry = new ParticipantRegistry(100);
  const membership = new Map<string, string>();
  const engine = new PhaseEngine({ scenario, registry, installationId: 'i', roomId: 'r', showId: 'show', displayToken: 'display', staffPin: '2468', now: () => now,
    autoStartOnFirstParticipant: false, sessionIdFactory: () => 'session',
    groupSelection: { current: id => membership.get(id) ?? null, select: (id, g) => { membership.set(id, g); } } });
  const sockets = new Map<string, Socket>();
  const tablet = (id: string, group = 'ki') => {
    const socket = new Socket();
    membership.set(id, group);
    const record = registry.admit({ clientId: id, participantLease: `lease-${id}`, name: id, client: 'native', leaseExpiresAt: 1e9, socket: socket as unknown as WebSocket, now });
    if (!record.ok) throw new Error('admit');
    engine.participantJoined(socket as unknown as WebSocket, record.participant);
    sockets.set(id, socket);
    return socket;
  };
  const task = (id: string) => sockets.get(id)!.sent.filter(m => m.t === 'participant_task').at(-1)?.task;
  return { engine, membership, tablet, task, advance: (ms: number) => { now += ms; } };
}

describe('group introductions', () => {
  it('plays the group introduction on every move into a group, and again on a move between parts', () => {
    const h = setup(); h.tablet('a'); h.engine.adminStart();
    expect(h.engine.adminAssignGroup('a', 'buehne').ok).toBe(true);
    expect(h.task('a')).toMatchObject({ status: 'closed', template: { introduction: true, question: 'Bühnenarbeit', notificationBody: 'Notify Bühnenarbeit' },
      recipient: { status: 'answered', audio: { src: 'buehne.mp3', startedAt: 500 } } });
    const first = h.task('a').id;
    h.advance(1000);
    h.engine.adminAssignGroup('a', 'chor');
    expect(h.task('a')).toMatchObject({ template: { question: 'Chor und Choreo' }, recipient: { status: 'answered' } });
    expect(h.task('a').recipient.audio).toBeUndefined();
    expect(h.task('a').deadlineAt).toBe(1100 + 15000);
    h.engine.adminAssignGroup('a', 'buehne');
    expect(h.task('a').id).not.toBe(first);
    expect(h.task('a').recipient.audio.src).toBe('buehne.mp3');
  });

  it('does not replay on a move into the same group, and stops the introduction on a move to a group without one', () => {
    const h = setup(); h.tablet('a'); h.engine.adminStart();
    h.engine.adminAssignGroup('a', 'vector');
    const id = h.task('a').id;
    h.engine.adminAssignGroup('a', 'vector');
    expect(h.task('a').id).toBe(id);
    h.engine.adminAssignGroup('a', 'ki');
    expect(h.task('a')).toMatchObject({ id, status: 'cancelled', recipient: { status: 'cancelled' } });
  });

  it('plays the introduction for a staff pick and keeps it out of the operator task list', () => {
    const h = setup(); const socket = h.tablet('a'); h.engine.adminStart();
    h.engine.handleClientMessage({ v: 2, t: 'staff_assign', pin: '2468', pickId: 'vector' } as never, socket as unknown as WebSocket);
    expect(h.task('a').template.question).toBe('Du bist VECTOR');
    expect(h.engine.taskStatus.instances).toEqual([]);
  });
});

describe('Assign rest', () => {
  const draw = (n: number, leads: string[] = []) => {
    const h = setup();
    for (const lead of leads) h.tablet(lead, 'vector');
    for (let i = 0; i < n; i++) h.tablet(`p${i}`);
    h.tablet('t', 'theater');
    h.engine.adminStart();
    return { h, plan: h.engine.planAssignRest(() => 0.5) };
  };
  const counts = (plan: { assignments: { groupId: string }[] }) => plan.assignments.reduce<Record<string, number>>((c, a) => ({ ...c, [a.groupId]: (c[a.groupId] ?? 0) + 1 }), {});

  it('keeps Bühne between 2 and 4 at about a third, the rest to Chor, and only draws from KI', () => {
    expect(counts(draw(1).plan)).toEqual({ buehne: 1 });
    expect(counts(draw(3).plan)).toEqual({ buehne: 2, chor: 1 });
    expect(counts(draw(9).plan)).toEqual({ buehne: 3, chor: 6 });
    expect(counts(draw(20).plan)).toEqual({ buehne: 4, chor: 16 });
    expect(draw(5).plan.assignments.map(a => a.participantId)).not.toContain('t');
  });

  it('warns about empty lead groups and leaves the leads alone', () => {
    const { plan } = draw(6, ['v']);
    expect(plan.emptyLeadGroupIds).toEqual(['patch']);
    expect(plan.assignments.map(a => a.participantId)).not.toContain('v');
  });

  it('applies a preview with introductions, and a second press only tops up for late joiners', () => {
    const { h, plan } = draw(6);
    expect(h.engine.applyAssignRest(plan.assignments)).toEqual({ moved: 6, skipped: [] });
    for (const { participantId, groupId } of plan.assignments) {
      expect(h.membership.get(participantId)).toBe(groupId);
      expect(h.task(participantId).template.introduction).toBe(true);
    }
    expect(h.engine.planAssignRest().assignments).toEqual([]);
    h.tablet('late1'); h.tablet('late2'); h.tablet('late3'); h.tablet('late4'); h.tablet('late5'); h.tablet('late6');
    // Pool 12 → Bühne target 4; 2 already there, so 2 of the late joiners go to Bühne.
    expect(counts(h.engine.planAssignRest(() => 0.1))).toEqual({ buehne: 2, chor: 4 });
  });

  it('skips anyone moved by hand since the preview', () => {
    const { h, plan } = draw(3);
    const moved = plan.assignments[0]!.participantId;
    h.engine.adminAssignGroup(moved, 'patch');
    expect(h.engine.applyAssignRest(plan.assignments)).toEqual({ moved: 2, skipped: [moved] });
    expect(h.membership.get(moved)).toBe('patch');
  });

  it('refuses targets outside the drawn groups', () => {
    const { h } = draw(2);
    expect(h.engine.applyAssignRest([{ participantId: 'p0', groupId: 'vector' }])).toEqual({ moved: 0, skipped: ['p0'] });
  });
});

describe('scenario validation', () => {
  it('rejects unknown and repeated Assign rest groups and missing introduction audio', () => {
    const bad = scenarioSchema.parse({ ...scenario, assignRest: { fromGroupId: 'ki', leadGroupIds: ['chor'], fill: [{ groupId: 'nope', max: 2, share: 0.5 }], restGroupId: 'chor' } });
    const result = validateScenario(bad, { files: [] });
    expect(result.errors.map(e => e.code)).toEqual(expect.arrayContaining(['unknown-group', 'invalid-assign-rest', 'missing-media']));
    expect(result.errors.some(e => e.message.includes('vector.mp3'))).toBe(true);
  });
});
