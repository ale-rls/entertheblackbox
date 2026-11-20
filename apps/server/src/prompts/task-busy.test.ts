import { describe, it, expect } from 'vitest';
import { participantTaskSchema } from '@entertheblackbox/scenario';
import { TaskEngine } from './task-engine.js';
const clip = { src: 'go.mp3', durationMs: 1000 };
const template = (id: string, options: unknown[]) => participantTaskSchema.parse({ id, title: id, question: id, notificationBody: id, durationMs: 10000, options });

describe('finding who is busy for a whole audience at once', () => {
  it('names the same participants as busy() and enrolls only the free ones, once', () => {
    const brief = template('brief', [{ id: 'ok', label: 'OK', audio: clip }]);
    const scene = template('scene', [{ id: 'yes', label: 'Yes' }]);
    const e = new TaskEngine();
    const t = e.open(brief, 's', ['answering', 'listening'], 0);
    e.respond(t.id, 's', 'listening', 'ok', 10);
    const task = e.open(scene, 's', [], 20, { id: 'scene', epoch: 1 });
    const everyone = ['answering', 'listening', 'free'];
    const busy = e.busyParticipants('s', 100);
    expect([...busy].sort()).toEqual(everyone.filter(id => e.busy(id, 's', 100)).sort());
    expect([...busy].sort()).toEqual(['answering', 'listening']);
    expect(e.enrollFree(task.id, everyone, 100, busy)).toBe(1);
    expect(e.enrollFree(task.id, everyone, 100, e.busyParticipants('s', 100))).toBe(0);
    // Once the instruction has played, the listener is free too.
    expect(e.enrollFree(task.id, everyone, 2000, e.busyParticipants('s', 2000))).toBe(1);
    expect(e.all().find(x => x.id === task.id)!.recipients.map(r => r.participantId)).toEqual(['free', 'listening']);
  });

  it('leaves 120 participants still listening to an instruction off a new scene task', () => {
    const e = new TaskEngine();
    const ids = Array.from({ length: 120 }, (_, i) => `p${i}`);
    const brief = template('brief', [{ id: 'ok', label: 'OK', audio: { src: 'long.mp3', durationMs: 600_000 } }]);
    for (let n = 0; n < 60; n += 1) {
      const t = e.open(brief, 's', ids, n * 10);
      for (const id of ids) e.respond(t.id, 's', id, 'ok', n * 10 + 1);
    }
    const scene = e.open(template('scene', [{ id: 'yes', label: 'Yes' }]), 's', [], 1000, { id: 'scene', epoch: 1 });
    expect(e.enrollFree(scene.id, ids, 1000, e.busyParticipants('s', 1000))).toBe(0);
    expect(e.all().find(x => x.id === scene.id)!.recipients).toHaveLength(0);
  });
});
