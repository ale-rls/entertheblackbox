import { randomUUID } from 'node:crypto';
import type { ParticipantRole, RoleAssignment, ParticipantTask, TaskInstance, TaskOutcome, TaskRecipient } from '@entertheblackbox/scenario';
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
    this.prepareRoleAssignment(participantId, roleId, source, now)();
  }
  prepareRoleAssignment(participantId: string, roleId: string, source: string, now: number, replaceExclusive = false): () => void {
    const role = this.roles.find(r => r.id === roleId);
    if (!role) throw new Error('Unknown role');
    if (this.assignments.some(a => a.participantId === participantId && a.roleId === roleId)) return () => {};
    if (role.capacity !== undefined && this.assignments.filter(a => a.roleId === roleId).length >= role.capacity) throw new Error('Role is full');
    const conflicts = role.exclusiveSet ? this.assignments.filter(a => a.participantId === participantId && this.roles.find(r => r.id === a.roleId)?.exclusiveSet === role.exclusiveSet) : [];
    if (conflicts.length && !replaceExclusive) throw new Error('Withdraw the existing role in this exclusive set first');
    // Staff picks commit this synchronously after validating the group move.
    return () => {
      for (const conflict of conflicts) this.withdraw(participantId, conflict.roleId);
      this.assignments.push({ participantId, roleId, source, assignedAt: now });
    };
  }
  withdraw(participantId: string, roleId: string): void {
    // A role can come from the option itself or from one of its rank/overflow outcomes; the
    // assignment's source names the task that gave it, so that response gives its place back too.
    const sources = new Set(this.assignments.filter(a => a.participantId === participantId && a.roleId === roleId).map(a => a.source));
    this.assignments = this.assignments.filter(a => a.participantId !== participantId || a.roleId !== roleId);
    for (const t of this.instances) for (const r of t.recipients) if (r.participantId === participantId && (sources.has(t.id) || t.template.options.find(o => o.id === r.optionId)?.roleId === roleId) && (r.status === 'accepted' || r.status === 'answered')) { r.status = 'withdrawn'; r.message = 'Assignment withdrawn by the operator.'; }
  }
  endOccupant(participantId: string): void {
    for (const a of [...this.assignments]) if (a.participantId === participantId) this.withdraw(participantId,a.roleId);
    for (const t of this.instances) for (const r of t.recipients) if (r.participantId === participantId && !(t.template.autoComplete && r.status === 'answered')) { r.status = 'cancelled'; r.message = 'Participation ended.'; }
  }
  clearRoles(): void { this.assignments = []; }

  all(): TaskInstance[] { return structuredClone(this.instances); }
  open(template: ParticipantTask, sessionId: string, ids: string[], now: number, phase: { id: string; epoch: number } | null = null): TaskInstance {
    this.tick(now);
    if (!ids.length && phase === null) throw new Error('No eligible participants');
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
    if (this.busy(participantId, task.sessionId, now)) return false;
    task.recipients.push({ participantId, optionId: null, sequence: null, status: 'pending', message: '', respondedAt: null, ...(task.template.audio ? { audio: this.audio(task.template, now) } : {}) });
    return true;
  }
  respond(instanceId: string, sessionId: string, participantId: string, optionId: string, now: number): boolean {
    this.tick(now);
    const task = this.instances.find(t => t.id === instanceId && t.sessionId === sessionId);
    const r = task?.recipients.find(r => r.participantId === participantId);
    const option = task?.template.options.find(o => o.id === optionId);
    if (!task || task.template.autoComplete || !r || !option || task.status !== 'open' || this.current(participantId, sessionId)?.task.id !== task.id) return false;
    if (r.status === 'accepted' || r.status === 'answered') return r.optionId === optionId;
    if (r.status !== 'pending' && r.status !== 'full') return false;
    const winner = option.audioByVote ? this.workflow?.winner(option.audioByVote.questionId) : null;
    const own: TaskOutcome = { roleId: option.roleId, groupId: option.groupId, nextTaskId: option.nextTaskId, message: option.message,
      audio: option.audioByVote ? (winner ? option.audioByVote.clips[winner] : undefined) ?? option.audioByVote.fallback : option.audio };
    // Rank and capacity count only responses that took a place, not overflow arrivals.
    const placed = task.recipients.filter(x => x.optionId === optionId && (x.status === 'accepted' || x.status === 'answered') && x.outcome !== 'overflow').length;
    const atCapacity = option.capacity !== undefined && placed >= option.capacity;
    const rank = option.rankOutcomes?.[placed];
    const first: { outcome: TaskOutcome; label?: string } | null = atCapacity ? null
      : rank ? { outcome: { ...own, ...Object.fromEntries(Object.entries(rank).filter(([, v]) => v !== undefined)) }, label: `rank-${placed + 1}` }
      : { outcome: own };
    let failure = first ? this.apply(task, r, participantId, first.outcome, now) : task.template.fullMessage;
    let label = first?.label;
    if (failure !== null && option.overflow) {
      failure = this.apply(task, r, participantId, { message: '', ...option.overflow }, now);
      label = 'overflow';
    }
    if (failure !== null) {
      Object.assign(r, { status: 'full', message: failure });
      // Without a full recording, any introduction that is still playing carries on.
      if (task.template.fullAudio) r.audio = { ...task.template.fullAudio, startedAt: now + 400 };
      return true;
    }
    delete r.outcome;
    if (label) r.outcome = label;
    // Overflow arrivals did not take one of the option's places, so they never count as accepted.
    Object.assign(r, { optionId, status: option.capacity === undefined || label === 'overflow' ? 'answered' : 'accepted', sequence: ++this.sequence, respondedAt: now });
    // A scene's task stays open to its deadline so late joiners can still be added.
    if (task.phaseId === null && task.recipients.every(r => r.status === 'accepted' || r.status === 'answered')) task.status = 'closed';
    return true;
  }
  /** Gives one recipient an outcome. Returns null on success, or the reason it could not be given (nothing kept). */
  private apply(task: TaskInstance, r: TaskRecipient, participantId: string, outcome: TaskOutcome, now: number): string | null {
    if (outcome.roleId) {
      try { this.assignRole(participantId, outcome.roleId, task.id, now); }
      catch (error) { return error instanceof Error ? error.message : 'Role unavailable'; }
    }
    if (outcome.groupId && (!this.workflow || !this.workflow.assignGroup(participantId, outcome.groupId))) {
      // Roll back only the role this response just acquired.
      if (outcome.roleId) this.assignments = this.assignments.filter(a => !(a.participantId === participantId && a.roleId === outcome.roleId && a.source === task.id));
      return 'This route is unavailable. Please ask the operator.';
    }
    delete r.audio;
    if (outcome.audio) r.audio = { ...outcome.audio, startedAt: now + 400 };
    r.message = outcome.message ?? '';
    if (outcome.nextTaskId) this.followups.push({ sourceId: task.id, participantId, templateId: outcome.nextTaskId, at: now + (outcome.audio?.durationMs ?? 0) + 500 });
    return null;
  }
  close(id: string, cancel = false): boolean {
    const task = this.instances.find(t => t.id === id);
    if (!task) return false;
    if (cancel && task.template.autoComplete && task.status === 'closed') return true;
    task.status = cancel ? 'cancelled' : 'closed';
    // A cancelled task's queued follow-ups never open.
    if (cancel) this.followups = this.followups.filter(f => f.sourceId !== id);
    for (const r of task.recipients) if (cancel || r.status === 'pending' || r.status === 'full') {
      r.status = cancel ? 'cancelled' : 'expired'; r.message = cancel ? 'Task cancelled.' : 'Responses closed.';
    }
    return true;
  }
  private complete(task: TaskInstance, at: number): void {
    const option = task.template.options[0]!;
    for (const recipient of task.recipients) {
      if (recipient.status !== 'pending') continue;
      delete recipient.audio;
      Object.assign(recipient, { status: 'answered', optionId: option.id, sequence: ++this.sequence,
        respondedAt: at, message: option.message });
    }
    task.status = 'closed';
  }
  tick(now: number): void {
    for (const task of this.instances) {
      if (task.status !== 'open' || now < task.deadlineAt) continue;
      if (task.template.autoComplete) this.complete(task, task.deadlineAt);
      else this.close(task.id);
    }
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
  endPhase(phaseId: string, phaseEpoch: number, endedAt?: number): void {
    for (const task of this.instances) {
      if (task.template.persistAcrossPhases || task.phaseId !== phaseId || task.phaseEpoch !== phaseEpoch || task.status === 'cancelled') continue;
      if (endedAt !== undefined && task.template.autoComplete && task.status === 'open') {
        this.complete(task, Math.min(endedAt, task.deadlineAt));
      }
      else this.close(task.id, true);
    }
  }
  cancelAll(): void { for (const t of this.instances) this.close(t.id, true); }
  /**
   * Waiting on this participant's answer to an open task, still playing the instruction their answer gave them,
   * or about to open their follow-up task (one that will still open: its source neither cancelled nor withdrawn).
   */
  busy(participantId: string, sessionId: string, now: number): boolean {
    return this.followups.some(f => {
      if (f.participantId !== participantId) return false;
      const source = this.instances.find(t => t.id === f.sourceId);
      const r = source?.recipients.find(r => r.participantId === participantId);
      return source?.sessionId === sessionId && source.status !== 'cancelled' && !!r && ['accepted', 'answered'].includes(r.status);
    }) || this.instances.some(t => t.sessionId === sessionId && t.recipients.some(r => r.participantId === participantId && (
      (t.status === 'open' && (r.status === 'pending' || r.status === 'full'))
      || (r.audio !== undefined && (r.status === 'accepted' || r.status === 'answered') && now < r.audio.startedAt + r.audio.durationMs))));
  }
  /** Live instances (not copies) for these IDs, for read-only scans. */
  instancesById(ids: ReadonlySet<string>): readonly TaskInstance[] {
    return this.instances.filter(t => ids.has(t.id));
  }
  /** The task this participant should see: one still waiting on their answer, else the one they last touched (for its feedback). */
  current(participantId: string, sessionId: string): { task: TaskInstance; recipient: TaskRecipient } | null {
    const mine = [...this.instances].reverse().filter(t => t.sessionId === sessionId && t.recipients.some(r => r.participantId === participantId));
    const own = (t: TaskInstance) => t.recipients.find(r => r.participantId === participantId)!;
    // A late recipient added to an older open task must not be hidden behind a newer, finished one.
    const waiting = mine.find(t => t.status === 'open' && ['pending', 'full'].includes(own(t).status));
    const touched = (t: TaskInstance) => Math.max(t.createdAt, own(t).respondedAt ?? -Infinity);
    const task = waiting ?? mine.reduce<TaskInstance | undefined>((best, t) => !best || touched(t) > touched(best) ? t : best, undefined);
    const recipient = task?.recipients.find(r => r.participantId === participantId);
    return task && recipient ? { task, recipient } : null;
  }
}
