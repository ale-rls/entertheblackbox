import { describe, it, expect } from 'vitest';
import { participantTaskSchema } from '@entertheblackbox/scenario';
import { TaskEngine } from './task-engine.js';
const audio = { src: 'choice.mp3', durationMs: 1000 };
const task = (id: string, options: unknown[], extra = {}) => participantTaskSchema.parse({ id, title: id, question: id, notificationBody: id, durationMs: 60000, options, ...extra });
function setup() {
 const first = task('work', [{id:'stage',label:'Stage',roleId:'stage',groupId:'stage',audio}, {id:'swap',label:'Swap',audio,nextTaskId:'handover'}], {audio});
 const handover = task('handover', [{id:'yes',label:'Yes',nextTaskId:'new-work'}, {id:'no',label:'No',groupId:'exit',audio}]);
 const replacement = task('new-work', [{id:'stage',label:'Stage',roleId:'stage',groupId:'stage',audio}]);
 const e = new TaskEngine(); const groups = new Map<string,string>();
 e.configureRoles([{id:'stage',label:'Stage',capacity:1}]);
 e.configureWorkflow([first,handover,replacement], {assignGroup:(id,g)=>{groups.set(id,g);return true;},winner:()=>null});
 return {e,first,handover,replacement,groups};
}
describe('automatic task routing', () => {
 it('routes once, plays response audio, chains after it finishes and shares role capacity across original and replacement audiences', () => {
  const {e,first,groups} = setup(); const t=e.open(first,'s',['a','b'],0);
  expect(e.current('a','s')!.recipient.audio).toMatchObject({startedAt:400,src:'choice.mp3'});
  e.respond(t.id,'s','a','stage',100); e.respond(t.id,'s','a','stage',200);
  expect(groups.get('a')).toBe('stage'); expect(e.roleAssignments()).toHaveLength(1);
  expect(e.current('a','s')!.recipient.audio!.startedAt).toBe(500);
  e.respond(t.id,'s','b','swap',100);e.tick(1599);expect(e.current('b','s')!.task.template.id).toBe('work');
  e.tick(1600);const swap=e.current('b','s')!;expect(swap.task.template.id).toBe('handover');
  e.respond(swap.task.id,'s','b','yes',1700);e.tick(2200);const fresh=e.current('b','s')!;expect(fresh.task.template.id).toBe('new-work');
  e.respond(fresh.task.id,'s','b','stage',2300);expect(e.current('b','s')!.recipient.status).toBe('full');expect(groups.has('b')).toBe(false);expect(e.roleAssignments()).toHaveLength(1);
 });
 it('rejects stale choices and cancels delayed followups after cancellation or a newer operator task', () => {
  const {e,first,handover}=setup();let t=e.open(first,'s',['a'],0);e.respond(t.id,'s','a','swap',10);e.close(t.id,true);e.tick(2000);expect(e.all()).toHaveLength(1);
  t=e.open(first,'s',['b'],3000);e.respond(t.id,'s','b','swap',3010);const newer=e.open(handover,'s',['b'],3100);expect(()=>e.tick(5000)).not.toThrow();expect(e.current('b','s')!.task.id).toBe(newer.id);
  expect(e.respond(t.id,'s','b','stage',5001)).toBe(false);e.cancelAll();e.tick(10000);expect(e.all().every(t=>t.status==='cancelled')).toBe(true);
 });
 it('selects recorded instruction from the saved vote and uses the declared fallback for a tie', () => {
  const {e}=setup();const variant=task('chor',[{id:'yes',label:'Yes',audioByVote:{questionId:'rule',clips:{blue:{src:'blue.mp3',durationMs:2000}},fallback:audio}}]);
  e.configureWorkflow([variant],{assignGroup:()=>true,winner:()=> 'blue'});const t=e.open(variant,'s',['a'],0);e.respond(t.id,'s','a','yes',10);expect(e.current('a','s')!.recipient.audio!.src).toBe('blue.mp3');
  e.configureWorkflow([variant],{assignGroup:()=>true,winner:()=>null});const t2=e.open(variant,'s',['b'],0);e.respond(t2.id,'s','b','yes',10);expect(e.current('b','s')!.recipient.audio!.src).toBe('choice.mp3');
 });
});
