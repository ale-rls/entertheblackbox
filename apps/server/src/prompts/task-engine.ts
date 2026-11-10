import { randomUUID } from 'node:crypto';
import type { ParticipantRole, RoleAssignment, ParticipantTask, TaskInstance, TaskRecipient } from '@entertheblackbox/scenario';
/** Serialized on the server event loop: a claim is committed before another response is processed. */
export class TaskEngine {
  private instances: TaskInstance[] = [];
  private sequence = 0;
  private templates: ParticipantTask[] = [];
  private followups: Array<{ sourceId: string; participantId: string; templateId: string; at: number }> = [];
  private workflow: { assignGroup: (id: string, group: string) => boolean; winner: (question: string) => string | null } | undefined;
  configureWorkflow(templates: ParticipantTask[], workflow: NonNullable<TaskEngine['workflow']>): void {
    this.templates = templates; this.workflow = workflow;
  }
  private audio(template: ParticipantTask, now: number) {
    return template.audio ? { ...template.audio, startedAt: now + 400 } : undefined;
  }
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
    if (this.instances.some(t => t.sessionId === sessionId && t.status === 'open' && t.recipients.some(r => ids.includes(r.participantId) && (r.status === 'pending' || r.status === 'full')))) throw new Error('Recipients already have an open task. Close or cancel it first.');
    const task: TaskInstance = { id: randomUUID(), sessionId, template: structuredClone(template),
      phaseId: phase?.id ?? null, phaseEpoch: phase?.epoch ?? null, createdAt: now, deadlineAt: now + template.durationMs, status: 'open',
      recipients: [...new Set(ids)].map(participantId => ({ participantId, optionId: null, sequence: null, status: 'pending', message: '', respondedAt: null, ...(template.audio ? { audio: this.audio(template, now) } : {}) })) };
    this.instances.push(task); return structuredClone(task);
  }
  /** Adds a late joiner to a still-open task; false when closed, already a recipient, or busy with another open task. */
  addRecipient(instanceId: string, participantId: string, now: number): boolean {
    this.tick(now);
    const task = this.instances.find(t => t.id === instanceId);
    if (!task || task.status !== 'open' || task.recipients.some(r => r.participantId === participantId)) return false;
    if (this.instances.some(t => t.sessionId === task.sessionId && t.status === 'open' && t.recipients.some(r => r.participantId === participantId && (r.status === 'pending' || r.status === 'full')))) return false;
    task.recipients.push({ participantId, optionId: null, sequence: null, status: 'pending', message: '', respondedAt: null, ...(task.template.audio ? { audio: this.audio(task.template, now) } : {}) });
    return true;
  }
  respond(instanceId: string, sessionId: string, participantId: string, optionId: string, now: number): boolean {
    this.tick(now);
    const task = this.instances.find(t => t.id === instanceId && t.sessionId === sessionId);
    const r = task?.recipients.find(r => r.participantId === participantId);
    const option = task?.template.options.find(o => o.id === optionId);
    if (!task || !r || !option || task.status !== 'open' || this.current(participantId, sessionId)?.task.id !== task.id) return false;
    if (r.status === 'accepted' || r.status === 'answered') return r.optionId === optionId;
    if (r.status !== 'pending' && r.status !== 'full') return false;
    if (option.capacity !== undefined && task.recipients.filter(r => r.optionId === optionId && r.status === 'accepted').length >= option.capacity) {
      r.status = 'full'; r.message = task.template.fullMessage; return true;
    }
    if (option.roleId) {
      try { this.assignRole(participantId, option.roleId, task.id, now); }
      catch (error) { r.status = 'full'; r.message = error instanceof Error ? error.message : 'Role unavailable'; return true; }
    }
    if (option.groupId && (!this.workflow || !this.workflow.assignGroup(participantId, option.groupId))) {
      // Roll back only the role this response just acquired.
      if (option.roleId) this.assignments = this.assignments.filter(a => !(a.participantId === participantId && a.roleId === option.roleId && a.source === task.id));
      r.status = 'full'; r.message = 'This route is unavailable. Please ask the operator.'; return true;
    }
    const winner = option.audioByVote ? this.workflow?.winner(option.audioByVote.questionId) : null;
    const audio = option.audioByVote ? (winner ? option.audioByVote.clips[winner] : undefined) ?? option.audioByVote.fallback : option.audio;
    delete r.audio;
    if (audio) r.audio = { ...audio, startedAt: now + 400 };
    if (option.nextTaskId) this.followups.push({ sourceId: task.id, participantId, templateId: option.nextTaskId, at: now + (audio?.durationMs ?? 0) + 500 });
    Object.assign(r, { optionId, status: option.capacity === undefined ? 'answered' : 'accepted', sequence: ++this.sequence, respondedAt: now, message: option.message });
    // A scene's task stays open to its deadline so late joiners can still be added.
    if (task.phaseId === null && task.recipients.every(r => r.status === 'accepted' || r.status === 'answered')) task.status = 'closed';
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
  tick(now: number): void {
    for (const t of this.instances) if (t.status === 'open' && now >= t.deadlineAt) this.close(t.id);
    const due = this.followups.filter(f => f.at <= now);
    this.followups = this.followups.filter(f => f.at > now);
    for (const f of due) {
      const source = this.instances.find(t => t.id === f.sourceId);
      const r = source?.recipients.find(r => r.participantId === f.participantId);
      const template = this.templates.find(t => t.id === f.templateId);
      if (!source || this.current(f.participantId, source.sessionId)?.task.id !== source.id || source.status === 'cancelled' || !r || !['accepted','answered'].includes(r.status) || !template) continue;
      // An accepted recipient is no longer busy even while others answer the source task.
      this.open(template, source.sessionId, [f.participantId], now, source.phaseId === null || source.template.persistAcrossPhases ? null : { id: source.phaseId, epoch: source.phaseEpoch! });
    }
  }
  cancelPhase(phaseId: string, phaseEpoch: number): void { for (const t of this.instances) if (!t.template.persistAcrossPhases && t.phaseId === phaseId && t.phaseEpoch === phaseEpoch && t.status !== 'cancelled') this.close(t.id, true); }
  cancelAll(): void { for (const t of this.instances) this.close(t.id, true); }
  current(participantId: string, sessionId: string): { task: TaskInstance; recipient: TaskRecipient } | null {
    const task = [...this.instances].reverse().find(t => t.sessionId === sessionId && t.recipients.some(r => r.participantId === participantId));
    const recipient = task?.recipients.find(r => r.participantId === participantId);
    return task && recipient ? { task, recipient } : null;
  }
}
