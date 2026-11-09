import { randomUUID } from 'node:crypto';
import { admissionPosition, type AdmissionProgram } from '@entertheblackbox/scenario';
export class AdmissionPrograms {
  generation = randomUUID();
  private records = new Map<string, { groupId: string; anchor: number; revision: number }>();
  ensure(id: string, groupId: string, now: number, restart = false) {
    const old = this.records.get(id);
    if (!old || old.groupId !== groupId || restart) this.records.set(id, { groupId, anchor: now, revision: (old?.revision ?? 0) + 1 });
    return this.records.get(id)!;
  }
  get(id: string) { return this.records.get(id); }
  reset() { this.generation = randomUUID(); this.records.clear(); }
  status(programs: AdmissionProgram[], now: number) { return [...this.records].map(([participantId, record]) => ({ participantId, ...record, position: programs.find(p => p.groupId === record.groupId) ? admissionPosition(programs.find(p => p.groupId === record.groupId)!, record.anchor, now) : null })); }
}
