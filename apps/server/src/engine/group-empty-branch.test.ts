import { describe, it, expect } from 'vitest';
import type { WebSocket } from 'ws';
import { scenarioSchema } from '@entertheblackbox/scenario';
import { ParticipantRegistry } from '../admission/registry.js';
import { PhaseEngine } from './phase-engine.js';

const scenario = scenarioSchema.parse({
  version: 'group-empty-test', entryPhaseId: 'check',
  groups: [{ id: 'ki', label: 'Stage' }, { id: 'swap', label: 'Wants a replacement' }],
  phases: [
    { kind: 'idle', id: 'idle' },
    { kind: 'narration', id: 'check', text: 'Who wants a replacement?', durationMs: 1000, next: 'swap-scene', nextIfGroupEmpty: { groupId: 'swap', target: 'nobody' } },
    { kind: 'narration', id: 'swap-scene', text: 'Swap now', durationMs: 1000, next: 'idle' },
    { kind: 'narration', id: 'nobody', text: 'Nobody needs a replacement', durationMs: 1000, next: 'idle' },
  ],
});

class Socket { readyState = 1; sent: unknown[] = []; send(raw: string) { this.sent.push(JSON.parse(raw)); } close() { this.readyState = 3; } }

function setup(groups: string[]) {
  let now = 100;
  const registry = new ParticipantRegistry(10);
  const membership = new Map<string, string>();
  const engine = new PhaseEngine({ scenario, registry, installationId: 'i', roomId: 'r', showId: 'show', displayToken: 'display', now: () => now,
    autoStartOnFirstParticipant: false, sessionIdFactory: () => 'session',
    groupSelection: { current: id => membership.get(id) ?? null, select: (id, g) => { membership.set(id, g); } } });
  groups.forEach((group, index) => {
    const id = `p${index}`;
    membership.set(id, group);
    const record = registry.admit({ clientId: id, participantLease: `lease-${id}`, name: id, client: 'native', leaseExpiresAt: 1e9, socket: new Socket() as unknown as WebSocket, now });
    if (!record.ok) throw new Error('admit');
    engine.participantJoined(new Socket() as unknown as WebSocket, record.participant);
  });
  return { engine, membership, tick: (value: number) => { now = value; engine.tick(now); } };
}

describe('nextIfGroupEmpty', () => {
  it('takes the alternative exit when nobody is in the group as the scene ends', () => {
    const h = setup(['ki', 'ki']);
    h.engine.adminStart();
    h.tick(2000);
    expect(h.engine.currentPhaseId).toBe('nobody');
  });

  it('keeps the normal exit while someone is in the group', () => {
    const h = setup(['ki', 'swap']);
    h.engine.adminStart();
    h.tick(2000);
    expect(h.engine.currentPhaseId).toBe('swap-scene');
  });

  it('decides when the scene ends, not when it starts, and on Admin skip too', () => {
    const h = setup(['ki', 'swap']);
    h.engine.adminStart();
    h.membership.set('p1', 'ki');
    expect(h.engine.adminSkip().ok).toBe(true);
    expect(h.engine.currentPhaseId).toBe('nobody');
  });
});
