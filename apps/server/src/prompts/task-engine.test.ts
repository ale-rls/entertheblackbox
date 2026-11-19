import { describe, it, expect } from 'vitest';
import { participantTaskSchema } from '@entertheblackbox/scenario';
import { TaskEngine } from './task-engine.js';
const template = participantTaskSchema.parse({ id: 'volunteer', title: 'Volunteer', question: 'Join?', notificationBody: 'Please answer', durationMs: 1000, options: [{ id: 'yes', label: 'Yes', capacity: 2 }, { id: 'no', label: 'No' }] });
describe('participant tasks', () => {
  it('arbitrates capacity in receive order, deduplicates and lets a full recipient choose another option', () => {
    const e = new TaskEngine(); const t = e.open(template, 's', ['a','b','c'], 0);
    expect(e.respond(t.id,'s','b','yes',10)).toBe(true);
    e.respond(t.id,'s','b','yes',10); e.respond(t.id,'s','a','yes',10); e.respond(t.id,'s','c','yes',10);
    expect(e.all()[0]!.recipients.map(r => [r.status,r.sequence])).toEqual([['accepted',2],['accepted',1],['full',null]]);
    expect(e.respond(t.id,'s','c','no',11)).toBe(true); expect(e.all()[0]!.status).toBe('closed');
    expect(e.current('b','s')?.recipient.optionId).toBe('yes');
  });
  it('keeps a scene task open after everyone answered and adds late recipients until its deadline', () => {
    const e = new TaskEngine(); const t = e.open(template, 's', ['a'], 0, { id: 'scene', epoch: 1 });
    e.respond(t.id,'s','a','no',1); expect(e.all()[0]!.status).toBe('open');
    expect(e.addRecipient(t.id,'late',2)).toBe(true); expect(e.addRecipient(t.id,'late',3)).toBe(false);
    expect(e.respond(t.id,'s','late','yes',4)).toBe(true);
    expect(e.addRecipient(t.id,'too-late',1000)).toBe(false); expect(e.all()[0]!.status).toBe('closed');
  });
  it('shows and accepts an older open task a participant was added to after finishing a newer one', () => {
    const e = new TaskEngine();
    const casting = e.open(template, 's', [], 0, { id: 'scene', epoch: 1 });
    const operator = e.open(template, 's', ['a'], 1);
    expect(e.respond(operator.id, 's', 'a', 'no', 2)).toBe(true);
    // Staff move them into the casting group before its deadline.
    expect(e.addRecipient(casting.id, 'a', 3)).toBe(true);
    expect(e.current('a', 's')).toMatchObject({ task: { id: casting.id }, recipient: { status: 'pending' } });
    expect(e.respond(casting.id, 's', 'a', 'yes', 4)).toBe(true);
    // Once answered, the tablet keeps the feedback of the choice it just made.
    expect(e.current('a', 's')).toMatchObject({ task: { id: casting.id }, recipient: { status: 'accepted' } });
  });
  it('rejects wrong session, unknown recipients/options and expired responses', () => {
    const e = new TaskEngine(); const t = e.open(template,'s',['a'],0);
    expect(e.respond(t.id,'old','a','yes',1)).toBe(false);
    expect(e.respond(t.id,'s','x','yes',1)).toBe(false);
    expect(e.respond(t.id,'s','a','invalid',1)).toBe(false);
    expect(e.respond(t.id,'s','a','yes',1000)).toBe(false);
    expect(e.current('a','s')?.recipient.status).toBe('expired');
  });
  it('freezes recipients, prevents overlaps, cancels only the matching graph instance', () => {
    const e = new TaskEngine(); const ids = ['a']; const t = e.open(template,'s',ids,0,{id:'p',epoch:1}); ids.push('b');
    expect(() => e.open(template,'s',['a'],0)).toThrow('open task');
    const overlay = e.open(template,'s',['b'],0);
    e.endPhase('p',2,10); expect(e.all()[0]!.status).toBe('open');
    e.endPhase('p',1,10); expect(e.current('a','s')?.task.status).toBe('cancelled');
    expect(e.current('b','s')?.task.id).toBe(overlay.id);
    expect(e.respond(t.id,'s','a','yes',1)).toBe(false);
  });
  it('does not close all choices when one quota fills and preserves outcomes on response closure', () => {
    const e = new TaskEngine(); const t=e.open(template,'s',['a','b','c'],0);
    e.respond(t.id,'s','a','yes',1); e.respond(t.id,'s','b','yes',2);
    expect(e.all()[0]!.status).toBe('open'); e.close(t.id);
    expect(e.current('a','s')?.recipient.status).toBe('accepted');
    expect(e.current('c','s')?.recipient.status).toBe('expired');
  });
});
it('keeps role capacity across prompts and releases it explicitly for a replacement',()=>{
 const e=new TaskEngine();e.configureRoles([{id:'helper',label:'Helper',capacity:1}]);const roleTask={...template,options:[{id:'yes',label:'Yes',message:'Assigned',roleId:'helper'}]};
 const first=e.open(roleTask,'s',['a'],0);e.respond(first.id,'s','a','yes',1);const second=e.open(roleTask,'s',['b'],2);e.respond(second.id,'s','b','yes',3);expect(e.current('b','s')?.recipient.status).toBe('full');
 e.withdraw('a','helper');e.respond(second.id,'s','b','yes',4);expect(e.roleAssignments()).toMatchObject([{participantId:'b',roleId:'helper'}]);e.endOccupant('b');expect(e.roleAssignments()).toEqual([]);expect(e.current('b','s')?.recipient.status).toBe('cancelled');
});

describe('automatic bookkeeping tasks', () => {
  const option = { id: 'done', label: 'Done', message: '' };
  const bookkeeping = participantTaskSchema.parse({ ...template, autoComplete: true, options: [option] });

  it.each([300, 1200])('records completion once at the earlier of scene end (%i) and deadline', endedAt => {
    const engine = new TaskEngine();
    const task = engine.open(bookkeeping, 'show', ['a', 'departed'], 0, { id: 'scene', epoch: 1 });
    engine.endOccupant('departed');
    expect(engine.addRecipient(task.id, 'late', 100)).toBe(true);
    expect(engine.respond(task.id, 'show', 'a', 'done', 200)).toBe(false);
    engine.endPhase('scene', 2, 200);
    expect(engine.current('a', 'show')?.recipient.status).toBe('pending');
    engine.endPhase('scene', 1, endedAt);
    engine.tick(1500);
    engine.cancelAll();
    expect(engine.all()[0]?.status).toBe('closed');
    expect(engine.current('a', 'show')?.recipient).toMatchObject({ status: 'answered', optionId: 'done', sequence: 1, respondedAt: Math.min(endedAt, 1000) });
    expect(engine.current('late', 'show')?.recipient).toMatchObject({ status: 'answered', sequence: 2 });
    expect(engine.current('departed', 'show')?.recipient.status).toBe('cancelled');
  });

  it('completes manual sends at the deadline but respects cancellation', () => {
    const engine = new TaskEngine();
    const task = engine.open(bookkeeping, 'show', ['a', 'b'], 100);
    const cancelled = engine.open(bookkeeping, 'show', ['c'], 100);
    engine.close(cancelled.id, true);
    engine.tick(1101);
    expect(engine.all()[0]?.id).toBe(task.id);
    expect(engine.current('b', 'show')?.recipient).toMatchObject({ status: 'answered', respondedAt: 1100 });
    expect(engine.current('c', 'show')?.recipient.status).toBe('cancelled');
  });

  it('rejects automatic completion for choices, capacity and routing', () => {
    for (const options of [template.options, [{ ...option, capacity: 1 }], [{ ...option, nextTaskId: 'next' }]]) {
      expect(participantTaskSchema.safeParse({ ...bookkeeping, options }).success).toBe(false);
    }
  });
});
