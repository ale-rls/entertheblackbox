import { randomUUID } from 'node:crypto';
import type { ParticipantRole, RoleAssignment, ParticipantTask, TaskInstance, TaskRecipient } from '@entertheblackbox/scenario';
/** Serialized on the server event loop: a claim is committed before another response is processed. */
export class TaskEngine {
  private instances: TaskInstance[] = [];
  private sequence = 0;
  private exportRevision = 0;
  nextExportRevision() { return ++this.exportRevision; }
  private roles: ParticipantRole[] = [];
  private assignments: RoleAssignment[] = [];
  configureRoles(roles: ParticipantRole[]) { this.roles = roles; }
  roleAssignments() { return structuredClone(this.assignments); }
  assignRole(participantId: string, roleId: string, source: string, now: number): void {
    const role = this.roles.find(r => r.id === roleId);
    if (!role) throw new Error('Unknown role');
    if (this.assignments.some(a => a.participantId === participantId && a.roleId === roleId)) return;
    if (role.capacity !== undefined && this.assignments.filter(a => a.roleId === roleId).length >= role.capacity) throw new Error('Role is full');
    if (role.exclusiveSet && this.assignments.some(a => a.participantId === participantId && this.roles.find(r => r.id === a.roleId)?.exclusiveSet === role.exclusiveSet)) throw new Error('Withdraw the existing role in this exclusive set first');
    this.assignments.push({participantId,roleId,source,assignedAt:now});
  }
  withdraw(participantId: string, roleId: string): void {
    this.assignments = this.assignments.filter(a => a.participantId !== participantId || a.roleId !== roleId);
    for (const t of this.instances) for (const r of t.recipients) if (r.participantId === participantId && t.template.options.find(o => o.id === r.optionId)?.roleId === roleId && (r.status === 'accepted' || r.status === 'answered')) { r.status = 'withdrawn'; r.message = 'Assignment withdrawn by the operator.'; }
  }
  endOccupant(participantId: string): void {
    for (const a of [...this.assignments]) if (a.participantId === participantId) this.withdraw(participantId,a.roleId);
    for (const t of this.instances) for (const r of t.recipients) if (r.participantId === participantId) { r.status = 'cancelled'; r.message = 'Participation ended.'; }
  }
  clearRoles(): void { this.assignments = []; }

  all(): TaskInstance[] { return structuredClone(this.instances); }
  open(template: ParticipantTask, sessionId: string, ids: string[], now: number, phase: { id: string; epoch: number } | null = null): TaskInstance {
    this.tick(now);
    if (!ids.length) throw new Error('No eligible participants');
    if (this.instances.some(t => t.sessionId === sessionId && t.status === 'open' && t.recipients.some(r => ids.includes(r.participantId)))) throw new Error('Recipients already have an open task. Close or cancel it first.');
    const task: TaskInstance = { id: randomUUID(), sessionId, template: structuredClone(template),
      phaseId: phase?.id ?? null, phaseEpoch: phase?.epoch ?? null, createdAt: now, deadlineAt: now + template.durationMs, status: 'open',
      recipients: [...new Set(ids)].map(participantId => ({ participantId, optionId: null, sequence: null, status: 'pending', message: '', respondedAt: null })) };
    this.instances.push(task); return structuredClone(task);
  }
  respond(instanceId: string, sessionId: string, participantId: string, optionId: string, now: number): boolean {
    this.tick(now);
    const task = this.instances.find(t => t.id === instanceId && t.sessionId === sessionId);
    const r = task?.recipients.find(r => r.participantId === participantId);
    const option = task?.template.options.find(o => o.id === optionId);
    if (!task || !r || !option || task.status !== 'open') return false;
    if (r.status === 'accepted' || r.status === 'answered') return r.optionId === optionId;
    if (r.status !== 'pending' && r.status !== 'full') return false;
    if (option.capacity !== undefined && task.recipients.filter(r => r.optionId === optionId && r.status === 'accepted').length >= option.capacity) {
      r.status = 'full'; r.message = task.template.fullMessage; return true;
    }
    if (option.roleId) {
      try { this.assignRole(participantId, option.roleId, task.id, now); }
      catch (error) { r.status = 'full'; r.message = error instanceof Error ? error.message : 'Role unavailable'; return true; }
    }
    Object.assign(r, { optionId, status: option.capacity === undefined ? 'answered' : 'accepted', sequence: ++this.sequence, respondedAt: now, message: option.message });
    if (task.recipients.every(r => r.status === 'accepted' || r.status === 'answered')) task.status = 'closed';
    return true;
  }
  close(id: string, cancel = false): boolean {
    const task = this.instances.find(t => t.id === id);
    if (!task) return false;
    task.status = cancel ? 'cancelled' : 'closed';
    for (const r of task.recipients) if (cancel || r.status === 'pending' || r.status === 'full') {
      r.status = cancel ? 'cancelled' : 'expired'; r.message = cancel ? 'Task cancelled.' : 'Responses closed.';
    }
    return true;
  }
  tick(now: number): void { for (const t of this.instances) if (t.status === 'open' && now >= t.deadlineAt) this.close(t.id); }
  cancelPhase(phaseId: string, phaseEpoch: number): void { for (const t of this.instances) if (t.phaseId === phaseId && t.phaseEpoch === phaseEpoch && t.status !== 'cancelled') this.close(t.id, true); }
  cancelAll(): void { for (const t of this.instances) this.close(t.id, true); }
  current(participantId: string, sessionId: string): { task: TaskInstance; recipient: TaskRecipient } | null {
    const task = [...this.instances].reverse().find(t => t.sessionId === sessionId && t.recipients.some(r => r.participantId === participantId));
    const recipient = task?.recipients.find(r => r.participantId === participantId);
    return task && recipient ? { task, recipient } : null;
  }
}
