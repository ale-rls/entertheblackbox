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
function setup(){let now=100;let seq=0;const registry=new ParticipantRegistry(10);const membership=new Map<string,string>();
 const engine=new PhaseEngine({scenario,registry,installationId:'i',roomId:'r',showId:'show',displayToken:'display',now:()=>now,autoStartOnFirstParticipant:false,sessionIdFactory:()=>`session-${++seq}`,groupSelection:{current:id=>membership.get(id)??null,select:(id,g)=>{membership.set(id,g);}}});
 const phone=(id:string,group='ki',client:'native'|'web'='web')=>{const socket=new Socket();membership.set(id,group);const record=registry.admit({clientId:id,participantLease:`lease-${id}`,name:id,client,leaseExpiresAt:1e9,socket:socket as unknown as WebSocket,now});if(!record.ok)throw new Error('admit');engine.participantJoined(socket as unknown as WebSocket,record.participant);return socket;};
 return {engine,phone,tick:(value:number)=>{now=value;engine.tick(now);},respond:(socket:Socket,id:string,option='yes',sessionId=engine.currentSessionId)=>engine.handleClientMessage({t:'participant_task_response',v:2,sessionId,instanceId:id,optionId:option},socket as unknown as WebSocket)};
}
describe('connected participant workflows',()=>{
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
