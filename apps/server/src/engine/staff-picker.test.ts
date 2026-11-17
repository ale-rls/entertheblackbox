import { describe, it, expect } from 'vitest';
import type { WebSocket } from 'ws';
import { scenarioSchema } from '@entertheblackbox/scenario';
import { ParticipantRegistry } from '../admission/registry.js';
import { PhaseEngine } from './phase-engine.js';
import { StaffGate } from '../prompts/staff-gate.js';

const scenario = scenarioSchema.parse({
  version: 'staff-test', entryPhaseId: 'hold',
  groups: [{ id: 'ki', label: 'Stage' }, { id: 'vector', label: 'VECTOR' }],
  participantRoles: [{ id: 'lead-job', label: 'Lead', exclusiveSet: 'work' }, { id: 'lead-vector', label: 'VECTOR', capacity: 1, exclusiveSet: 'work' }],
  staffAssignments: [{ id: 'vector', label: 'VECTOR', roleId: 'lead-vector', groupId: 'vector' }],
  phases: [{ kind: 'idle', id: 'idle' }, { kind: 'narration', id: 'hold', text: 'Casting', durationMs: 60000, next: 'idle' }],
});

class Socket { readyState = 1; sent: any[] = []; send(raw: string) { this.sent.push(JSON.parse(raw)); } close() { this.readyState = 3; } }

function setup(pin: string | null = '2468') {
  const staffPin = pin ?? undefined;
  const now = 100;
  const registry = new ParticipantRegistry(10);
  const membership = new Map<string, string>();
  const engine = new PhaseEngine({ scenario, registry, installationId: 'i', roomId: 'r', showId: 'show', displayToken: 'display', staffPin, now: () => now,
    autoStartOnFirstParticipant: false, sessionIdFactory: () => 'session',
    groupSelection: { current: id => membership.get(id) ?? null, select: (id, g) => { membership.set(id, g); } } });
  const phone = (id: string) => {
    const socket = new Socket();
    membership.set(id, 'ki');
    const record = registry.admit({ clientId: id, participantLease: `lease-${id}`, name: id, client: 'native', leaseExpiresAt: 1e9, socket: socket as unknown as WebSocket, now });
    if (!record.ok) throw new Error('admit');
    engine.participantJoined(socket as unknown as WebSocket, record.participant);
    return socket;
  };
  const send = (socket: Socket, message: object) => engine.handleClientMessage({ v: 2, ...message } as never, socket as unknown as WebSocket);
  const last = (socket: Socket, t: string) => socket.sent.filter(m => m.t === t).at(-1);
  return { engine, membership, phone, send, last };
}

describe('staff menu on the tablet', () => {
  it('only lists picks for the right PIN', () => {
    const h = setup(); const tablet = h.phone('a');
    h.send(tablet, { t: 'staff_menu_request', pin: '0000' });
    expect(h.last(tablet, 'staff_menu')).toMatchObject({ ok: false, picks: [], message: 'Wrong PIN.' });
    h.send(tablet, { t: 'staff_menu_request', pin: '2468' });
    expect(h.last(tablet, 'staff_menu')).toMatchObject({ ok: true, picks: [{ id: 'vector', label: 'VECTOR' }] });
  });

  it('assigns role and group to the tablet occupant, replacing a role in the same exclusive set', () => {
    const h = setup(); const tablet = h.phone('a'); h.engine.adminStart();
    h.engine.taskCommand({ action: 'assign-role', participantId: 'a', roleId: 'lead-job', sessionId: h.engine.currentSessionId, phaseId: 'hold', phaseEpoch: h.engine.currentPhaseEpoch });
    h.send(tablet, { t: 'staff_assign', pin: '2468', pickId: 'vector' });
    expect(h.last(tablet, 'staff_assign_result')).toMatchObject({ ok: true, message: 'Assigned: VECTOR' });
    expect(h.engine.taskStatus.assignments).toMatchObject([{ participantId: 'a', roleId: 'lead-vector', source: 'staff' }]);
    expect(h.membership.get('a')).toBe('vector');
  });

  it('refuses a full role and a wrong PIN without changing anything', () => {
    const h = setup(); const first = h.phone('a'); const second = h.phone('b'); h.engine.adminStart();
    h.send(first, { t: 'staff_assign', pin: '2468', pickId: 'vector' });
    h.send(second, { t: 'staff_assign', pin: '2468', pickId: 'vector' });
    expect(h.last(second, 'staff_assign_result')).toMatchObject({ ok: false, message: 'Role is full' });
    expect(h.membership.get('b')).toBe('ki');
    h.send(second, { t: 'staff_assign', pin: '1111', pickId: 'vector' });
    expect(h.last(second, 'staff_assign_result')).toMatchObject({ ok: false, message: 'Wrong PIN.' });
  });

  it('is off without STAFF_PIN', () => {
    const h = setup(null); const tablet = h.phone('a');
    h.send(tablet, { t: 'staff_menu_request', pin: '2468' });
    expect(h.last(tablet, 'staff_menu')).toMatchObject({ ok: false, message: 'The staff menu is not set up on this server.' });
  });
});

describe('StaffGate', () => {
  it('locks a participant out after repeated wrong PINs, then lets them retry', () => {
    const gate = new StaffGate('2468', 3, 1000);
    expect(gate.check('a', '1', 0)).toBe('wrong');
    expect(gate.check('a', '2', 0)).toBe('wrong');
    expect(gate.check('a', '3', 0)).toBe('locked');
    expect(gate.check('a', '2468', 500)).toBe('locked');
    expect(gate.check('b', '2468', 500)).toBe('ok');
    expect(gate.check('a', '2468', 1001)).toBe('ok');
  });
});
