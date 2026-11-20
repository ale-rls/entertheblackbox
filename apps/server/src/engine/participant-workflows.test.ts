import { describe,it,expect } from 'vitest';
import Fastify from 'fastify';
import type { WebSocket } from 'ws';
import { scenarioSchema } from '@entertheblackbox/scenario';
import { ParticipantRegistry } from '../admission/registry.js';
import { PhaseEngine } from './phase-engine.js';
import { registerAdminRoutes } from '../admin/admin.js';
const scenario=scenarioSchema.parse({version:'workflow-test',entryPhaseId:'task',groups:[{id:'ki',label:'Stage'},{id:'audience',label:'Audience'}],
  participantRoles:[{id:'helper',label:'Helper',capacity:1}],
  participantTasks:[{id:'volunteer',title:'Volunteer',question:'Join?',notificationBody:'Please answer',groupIds:['ki'],durationMs:1000,options:[{id:'yes',label:'Yes',roleId:'helper',capacity:1},{id:'no',label:'No'}]}],
  admission:{assignment:'self-select',paths:[{groupId:'ki',intro:[{src:'intro.mp3',durationMs:1000}],loop:[{src:'loop.mp3',durationMs:1000}]}]},
  phases:[{kind:'idle',id:'idle'},{kind:'narration',id:'task',text:'Instructions',taskId:'volunteer',waitForGo:true,durationMs:1000,next:'next'},{kind:'narration',id:'next',text:'Continue',durationMs:1000,next:'idle'}]});
class Socket {readyState=1;sent:any[]=[];send(raw:string){this.sent.push(JSON.parse(raw));}close(){this.readyState=3;}}
function setup(config=scenario){let now=100;let seq=0;const registry=new ParticipantRegistry(10);const membership=new Map<string,string>();
 const engine=new PhaseEngine({scenario:config,registry,installationId:'i',roomId:'r',showId:'show',displayToken:'display',now:()=>now,autoStartOnFirstParticipant:false,sessionIdFactory:()=>`session-${++seq}`,groupSelection:{current:id=>membership.get(id)??null,select:(id,g)=>{membership.set(id,g);}}});
 const phone=(id:string,group='ki',client:'native'|'web'='web')=>{const socket=new Socket();membership.set(id,group);const record=registry.admit({clientId:id,participantLease:`lease-${id}`,name:id,client,leaseExpiresAt:1e9,socket:socket as unknown as WebSocket,now});if(!record.ok)throw new Error('admit');engine.participantJoined(socket as unknown as WebSocket,record.participant);return socket;};
 const replace = (id: string, replacementId: string) => {
   const former = registry.values().find(p => p.clientId === id)!;
   const group = membership.get(id)!;
   engine.socketClosed(former.socket!);
   registry.removeLease(former.participantLease);
   const record = registry.admit({ ...former, clientId: replacementId, participantLease: `lease-${replacementId}`, socket: former.socket!, now });
   if (!record.ok) throw new Error('admit replacement');
   engine.retireOccupant(id);
   membership.delete(id);
   membership.set(replacementId, group);
   engine.welcomeReplacement(record.participant, group);
 };
 return {engine,phone,replace,tick:(value:number)=>{now=value;engine.tick(now);},respond:(socket:Socket,id:string,option='yes',sessionId=engine.currentSessionId)=>engine.handleClientMessage({t:'participant_task_response',v:2,sessionId,instanceId:id,optionId:option},socket as unknown as WebSocket)};
}
describe('connected participant workflows',()=>{
 it.each([
  { handoverGroup: 'ki', expected: 'handover' },
  { handoverGroup: 'audience', expected: 'volunteer' },
  { handoverGroup: undefined, expected: 'volunteer' },
 ])('offers $expected to a replacement with handover group $handoverGroup', ({ handoverGroup, expected }) => {
  const h = setup(scenarioSchema.parse({
   ...scenario,
   handoverTaskId: handoverGroup ? 'handover' : undefined,
   participantTasks: [
    ...scenario.participantTasks!,
    { id: 'handover', title: 'Handover', question: 'Ready?', notificationBody: 'Please answer', groupIds: handoverGroup ? [handoverGroup] : [], durationMs: 1000, options: [{ id: 'yes', label: 'Yes' }] },
   ],
  }));
  const tablet = h.phone('former', 'ki', 'native');
  h.engine.adminStart();
  tablet.sent.length = 0;
  h.replace('former', 'replacement');

  const taskCards = tablet.sent.filter(message => message.t === 'participant_task' && message.task);
  expect(taskCards.length).toBeGreaterThan(0);
  for (const { task } of taskCards) {
   expect(task).toMatchObject({ template: { id: expected }, recipient: { participantId: 'replacement', status: 'pending' } });
  }
  const scene = h.engine.taskStatus.instances.find(task => task.template.id === 'volunteer')!;
  expect(scene.recipients).toContainEqual(expect.objectContaining({ participantId: 'former', status: 'cancelled' }));
  expect(scene.recipients.some(recipient => recipient.participantId === 'replacement')).toBe(expected === 'volunteer');
 });
 it('targets the authored audience, holds for GO after responses expire, and rejects stale commands',()=>{
  const h=setup();const a=h.phone('a','ki','native');const b=h.phone('b','ki','native');const outside=h.phone('outside','audience');h.engine.adminStart();
  const task=h.engine.taskStatus.instances[0]!;expect(task.recipients.map(r=>r.participantId)).toEqual(['a','b']);
  expect(outside.sent.filter(m=>m.t==='participant_task').at(-1).task).toBeNull();h.respond(b,task.id);h.respond(a,task.id);
  expect(h.engine.taskStatus.assignments).toMatchObject([{participantId:'b',roleId:'helper'}]);
  expect(h.engine.taskStatus.instances[0]!.recipients.find(r=>r.participantId==='a')?.status).toBe('full');
  h.tick(2000);expect(h.engine.currentPhaseId).toBe('task');
  expect(()=>h.engine.taskCommand({action:'go',sessionId:'stale',phaseId:'task',phaseEpoch:h.engine.currentPhaseEpoch})).toThrow('Stale');
  h.engine.taskCommand({action:'go',sessionId:h.engine.currentSessionId,phaseId:'task',phaseEpoch:h.engine.currentPhaseEpoch});expect(h.engine.currentPhaseId).toBe('next');
 });
 it('gives a still-open scene task to late joiners and newly grouped participants in its audience',()=>{
  const h=setup();const a=h.phone('a');h.engine.adminStart();const task=h.engine.taskStatus.instances[0]!;h.respond(a,task.id,'no');
  const lastTask=(socket:Socket)=>socket.sent.filter(m=>m.t==='participant_task').at(-1).task;
  const late=h.phone('late');expect(lastTask(late)).toMatchObject({id:task.id,recipient:{participantId:'late',status:'pending'}});
  const outside=h.phone('outside','audience');expect(lastTask(outside)).toBeNull();
  expect(h.engine.adminAssignGroup('outside','ki').ok).toBe(true);expect(lastTask(outside)).toMatchObject({id:task.id});
  h.respond(late,task.id);expect(h.engine.taskStatus.assignments).toMatchObject([{participantId:'late',roleId:'helper'}]);
  h.tick(2000);const tooLate=h.phone('too-late');expect(lastTask(tooLate)).toBeNull();
 });
 it('opens a scene task for an empty audience and keeps its original deadline for the first eligible arrival', () => {
  const h = setup();
  const outside = h.phone('outside', 'audience');
  h.engine.adminStart();

  const task = h.engine.taskStatus.instances[0]!;
  expect(h.engine.taskStatus.error).toBeNull();
  expect(task).toMatchObject({ status: 'open', recipients: [], deadlineAt: 1100 });
  const lastTask = (socket: Socket) => socket.sent.filter(m => m.t === 'participant_task').at(-1).task;
  expect(lastTask(outside)).toBeNull();
  h.tick(1099);
  const first = h.phone('first');
  expect(lastTask(first)).toMatchObject({ id: task.id, deadlineAt: task.deadlineAt, recipient: { participantId: 'first', status: 'pending' } });
  h.respond(first, task.id);
  expect(lastTask(first).recipient.status).toBe('accepted');

  h.tick(1100);
  expect(h.engine.taskStatus.instances[0]?.status).toBe('closed');
  expect(lastTask(h.phone('too-late'))).toBeNull();
 });

 it('opens the scene task for free tablets and hands it to a busy tablet once it answers', () => {
  const h = setup(scenarioSchema.parse({
   ...scenario,
   entryPhaseId: 'pre',
   participantTasks: [
    ...scenario.participantTasks!,
    { id: 'handover', title: 'Handover', question: 'Ready?', notificationBody: 'Please answer', groupIds: ['ki'], durationMs: 5000, options: [{ id: 'yes', label: 'Yes' }] },
   ],
   phases: [{ kind: 'narration', id: 'pre', text: 'Before', durationMs: 1000, next: 'task' }, ...scenario.phases],
  }));
  const busy = h.phone('busy', 'ki', 'native');
  h.engine.adminStart();
  // Staff hand over a tablet near the end of the scene; the replacement has not answered yet.
  h.engine.taskCommand({ action: 'open', templateId: 'handover', sessionId: h.engine.currentSessionId, phaseId: 'pre', phaseEpoch: h.engine.currentPhaseEpoch });
  const handover = h.engine.taskStatus.instances.find(task => task.template.id === 'handover')!;
  const free = h.phone('free', 'ki', 'native');
  h.tick(1100);
  expect(h.engine.currentPhaseId).toBe('task');

  expect(h.engine.taskStatus.error).toBeNull();
  const scene = () => h.engine.taskStatus.instances.find(task => task.template.id === 'volunteer')!;
  expect(scene().recipients.map(r => r.participantId)).toEqual(['free']);
  const lastTask = (socket: Socket) => socket.sent.filter(m => m.t === 'participant_task').at(-1).task;
  expect(lastTask(free)).toMatchObject({ template: { id: 'volunteer' } });

  h.respond(busy, handover.id);
  expect(scene().recipients.map(r => r.participantId)).toEqual(['free', 'busy']);
  expect(lastTask(busy)).toMatchObject({ template: { id: 'volunteer' }, recipient: { participantId: 'busy', status: 'pending' } });
 });

 describe('scene tasks offered to free tablets', () => {
  const clip = { src: 'go-to-stage.mp3', durationMs: 2000 };
  const scenes = (tasks: unknown[], taskId = 'volunteer') => scenarioSchema.parse({
   ...scenario,
   entryPhaseId: 'pre',
   participantTasks: [...scenario.participantTasks!.map(t => ({ ...t, durationMs: 10000 })), ...tasks],
   phases: [{ kind: 'narration', id: 'pre', text: 'Before', durationMs: 1000, next: 'task' },
    { kind: 'idle', id: 'idle' }, { kind: 'narration', id: 'task', text: 'Instructions', taskId, waitForGo: true, durationMs: 1000, next: 'next' },
    { kind: 'narration', id: 'next', text: 'Continue', durationMs: 1000, next: 'idle' }],
  });
  const lastTask = (socket: Socket) => socket.sent.filter(m => m.t === 'participant_task').at(-1).task;
  const open = (h: ReturnType<typeof setup>, templateId: string) => {
   h.engine.taskCommand({ action: 'open', templateId, sessionId: h.engine.currentSessionId, phaseId: h.engine.currentPhaseId, phaseEpoch: h.engine.currentPhaseEpoch });
   return h.engine.taskStatus.instances.filter(t => t.template.id === templateId).at(-1)!;
  };

  it('never hands one tablet\'s follow-up task to another tablet', () => {
   const h = setup(scenarioSchema.parse({
    ...scenario,
    participantTasks: [
     { id: 'volunteer', title: 'Volunteer', question: 'Join?', notificationBody: 'Please answer', groupIds: ['ki'], durationMs: 10000,
      options: [{ id: 'swap', label: 'Swap', nextTaskId: 'private' }, { id: 'stay', label: 'Stay' }] },
     { id: 'private', title: 'Private', question: 'Only for you', notificationBody: 'Please answer', groupIds: ['ki'], durationMs: 10000, options: [{ id: 'ok', label: 'OK' }] },
    ],
   }));
   const a = h.phone('a', 'ki', 'native'); const b = h.phone('b', 'ki', 'native');
   h.engine.adminStart();
   const scene = h.engine.taskStatus.instances[0]!;
   h.respond(a, scene.id, 'swap'); h.respond(b, scene.id, 'stay');
   h.tick(700); h.tick(800);
   const follow = h.engine.taskStatus.instances.find(t => t.template.id === 'private')!;
   expect(follow.recipients.map(r => r.participantId)).toEqual(['a']);
   expect(lastTask(b)).toMatchObject({ template: { id: 'volunteer' } });
  });

  it('lets an answer\'s spoken instruction finish before handing over the scene task', () => {
   const h = setup(scenes([{ id: 'brief', title: 'Brief', question: 'Ready?', notificationBody: 'Please answer', groupIds: ['ki'], durationMs: 5000,
    options: [{ id: 'ok', label: 'OK', audio: clip }] }]));
   const tablet = h.phone('tablet', 'ki', 'native');
   h.engine.adminStart();
   const brief = open(h, 'brief');
   h.tick(1100);
   expect(h.engine.currentPhaseId).toBe('task');
   h.respond(tablet, brief.id, 'ok');
   // The answer's instruction reaches the tablet; the scene task waits for it to finish.
   expect(lastTask(tablet)).toMatchObject({ template: { id: 'brief' }, recipient: { status: 'answered', audio: { src: 'go-to-stage.mp3' } } });
   h.tick(2000);
   expect(lastTask(tablet)).toMatchObject({ template: { id: 'brief' } });
   h.tick(3600);
   expect(lastTask(tablet)).toMatchObject({ template: { id: 'volunteer' }, recipient: { status: 'pending' } });
  });

  it('gives the scene task to a tablet whose queued follow-up was cancelled', () => {
   const h = setup(scenes([{ id: 'brief', title: 'Brief', question: 'Ready?', notificationBody: 'Please answer', groupIds: ['ki'], durationMs: 5000,
    options: [{ id: 'ok', label: 'OK', nextTaskId: 'brief' }] }]));
   const tablet = h.phone('tablet', 'ki', 'native');
   h.engine.adminStart();
   const brief = open(h, 'brief');
   h.tick(800);
   h.respond(tablet, brief.id, 'ok');
   h.engine.taskCommand({ action: 'cancel', instanceId: brief.id, sessionId: h.engine.currentSessionId, phaseId: 'pre', phaseEpoch: h.engine.currentPhaseEpoch });
   h.tick(1100);
   expect(h.engine.currentPhaseId).toBe('task');
   const scene = h.engine.taskStatus.instances.find(t => t.template.id === 'volunteer')!;
   expect(scene.recipients.map(r => r.participantId)).toEqual(['tablet']);
  });
 });

 it('rejects a manually opened task with no eligible recipients', () => {
  const h = setup();
  h.phone('outside', 'audience');
  h.engine.adminStart();
  expect(() => h.engine.taskCommand({
    action: 'open', templateId: 'volunteer', sessionId: h.engine.currentSessionId, phaseId: 'task', phaseEpoch: h.engine.currentPhaseEpoch,
  })).toThrow('No eligible participants');
  expect(h.engine.taskStatus.instances).toHaveLength(1);
 });

 it('stops admission before active phase frames and never starts admission for active late arrivals',()=>{
  const h=setup();const p=h.phone('a');expect(p.sent.find(m=>m.t==='admission_state').active).toBe(true);
  h.engine.adminStart();const stop=p.sent.findIndex(m=>m.t==='admission_state'&&!m.active);const start=p.sent.findIndex(m=>m.t==='phase'&&m.phase.kind==='narration');expect(stop).toBeLessThan(start);
  const late=h.phone('late');expect(late.sent.filter(m=>m.t==='admission_state').at(-1).active).toBe(false);
 });
 it('cancels overlays on restart and rejects packets from the previous session',()=>{
  const h=setup();const p=h.phone('a');h.engine.adminStart();h.engine.taskCommand({action:'go',sessionId:h.engine.currentSessionId,phaseId:h.engine.currentPhaseId,phaseEpoch:h.engine.currentPhaseEpoch});
  h.engine.taskCommand({action:'open',templateId:'volunteer',sessionId:h.engine.currentSessionId,phaseId:h.engine.currentPhaseId,phaseEpoch:h.engine.currentPhaseEpoch});
  const old=h.engine.taskStatus.instances.find(t=>t.phaseId===null)!;h.engine.adminRestart();h.respond(p,old.id,'yes',old.sessionId);
  expect(h.engine.taskStatus.instances.find(t=>t.id===old.id)?.recipients[0]?.status).toBe('cancelled');expect(h.engine.taskStatus.assignments).toEqual([]);
 });
 it('connects authenticated Admin mutations to the live engine with guards and audit',async()=>{
  const h=setup();h.phone('a');h.engine.adminStart();const app=Fastify();const audit:any[]=[];
  registerAdminRoutes(app,{verifyToken:async t=>t==='operator',engine:()=>h.engine,ready:true,startedAt:0,data:{audit:e=>audit.push(e),recentErrors:async()=>[],exportSession:async()=>null}});
  const payload={action:'go',sessionId:h.engine.currentSessionId,phaseId:'task',phaseEpoch:h.engine.currentPhaseEpoch};
  expect((await app.inject({method:'POST',url:'/api/admin/tasks',payload})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:'/api/admin/tasks',headers:{authorization:'Bearer operator'},payload})).statusCode).toBe(200);
  expect(h.engine.currentPhaseId).toBe('next');expect(audit[0].action).toBe('participant-task');
  expect((await app.inject({method:'POST',url:'/api/admin/tasks',headers:{authorization:'Bearer operator'},payload})).statusCode).toBe(409);await app.close();
 });
});
