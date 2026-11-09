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
    e.cancelPhase('p',2); expect(e.all()[0]!.status).toBe('open');
    e.cancelPhase('p',1); expect(e.current('a','s')?.task.status).toBe('cancelled');
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
