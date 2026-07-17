import type { PositionVoteStatus, Scenario } from "@smartphonecracy/scenario";
import { classifyPositionVotesForField, type PositionField } from "@smartphonecracy/shared";
import { resolveSnapshot, type FinalVoteSnapshot } from "../votes/index.js";
import type { PhaseCheckpoint } from "../engine/phase-engine.js";
import { PersistenceWriteQueue, type PersistenceShutdownResult, type SqlStatement } from "./write-queue.js";
import type { AdminDataSource, AdminExport } from "../admin/index.js";
import type { PersistenceQueueHealthEvent } from "./write-queue.js";

const DAY_MS = 86_400_000;

export type PersistenceOptions = {
  queue: PersistenceWriteQueue;
  installationId: string;
  scenario: Scenario;
  /** Closing date plus 90 days is the launch policy; supplied by deployment config. */
  participantDataExpiresAt: number;
};

const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString();
const phaseRowId = (snapshot: FinalVoteSnapshot) => `${snapshot.sessionId}:${snapshot.phaseEpoch}`;

function persistedAxes(field: PositionField): { xAxis: unknown; yAxis: unknown } {
  if (field.type === "four-quadrant") {
    return { xAxis: field.xAxis, yAxis: field.yAxis };
  }
  return field.axis === "x"
    ? { xAxis: field.labels, yAxis: null }
    : { xAxis: null, yAxis: field.labels };
}

function boundaryConvention(field: PositionField): string {
  if (field.type === "four-quadrant") {
    return "x=0.5 belongs to right; y=0.5 belongs to bottom; center belongs to q4";
  }
  return field.axis === "x"
    ? "x=0.5 belongs to the max/right quadrant"
    : "y=0.5 belongs to the max/bottom quadrant";
}

export class InstallationPersistence implements AdminDataSource {
  private lastActiveSessionId: string | null = null;
  private readonly errors: unknown[] = [];

  constructor(private readonly options: PersistenceOptions) {
    if (options.participantDataExpiresAt < Date.now() - 365 * DAY_MS) {
      throw new Error("participant retention deadline is implausibly old");
    }
    options.queue.enqueue([{
      text: `insert into scenarios (id,version,definition_json,status) values ($1,$2,$3,'deployed')
        on conflict (version) do update set definition_json=excluded.definition_json,status=excluded.status`,
      values: [options.scenario.version, options.scenario.version, JSON.stringify(options.scenario)],
    }]);
  }

  checkpoint(checkpoint: PhaseCheckpoint): void {
    const { scenario, installationId, participantDataExpiresAt } = this.options;
    if (checkpoint.sessionId !== "idle") this.lastActiveSessionId = checkpoint.sessionId;
    const sessionId = checkpoint.sessionId === "idle" ? this.lastActiveSessionId : checkpoint.sessionId;
    if (sessionId === null) return;
    const statements: SqlStatement[] = [{
      text: `insert into sessions (id, installation_id, scenario_id, status, started_at, ended_at, end_reason, current_phase_id, current_phase_epoch, current_phase_started_at, current_phase_deadline, participant_data_expires_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        on conflict (id) do update set status=excluded.status, ended_at=excluded.ended_at, end_reason=excluded.end_reason, current_phase_id=excluded.current_phase_id, current_phase_epoch=excluded.current_phase_epoch, current_phase_started_at=excluded.current_phase_started_at, current_phase_deadline=excluded.current_phase_deadline`,
      values: [sessionId, installationId, scenario.version, checkpoint.phaseId === "idle" ? "ended" : "active", iso(checkpoint.startedAt), checkpoint.phaseId === "idle" ? iso(checkpoint.startedAt) : null, checkpoint.phaseId === "idle" ? checkpoint.reason : null, checkpoint.phaseId, checkpoint.phaseEpoch, iso(checkpoint.startedAt), iso(checkpoint.deadlineAt), iso(participantDataExpiresAt)],
    }, {
      text: "insert into checkpoints (session_id, phase_id, phase_epoch, scenario_version, started_at, deadline_at, reason) values ($1,$2,$3,$4,$5,$6,$7)",
      values: [sessionId, checkpoint.phaseId, checkpoint.phaseEpoch, scenario.version, iso(checkpoint.startedAt), iso(checkpoint.deadlineAt), checkpoint.reason],
    }, {
      text: `insert into session_phases (id,session_id,phase_id,phase_index,started_at) values ($1,$2,$3,$4,$5)
        on conflict (id) do nothing`,
      values: [`${sessionId}:${checkpoint.phaseEpoch}`, sessionId, checkpoint.phaseId, checkpoint.phaseEpoch, iso(checkpoint.startedAt)],
    }];
    if (checkpoint.kind === "recovery") statements.push({
      text: "insert into events (session_id, type, payload_json) values ($1,'recovery',$2)",
      values: [sessionId, JSON.stringify({ reason: checkpoint.reason, phaseId: checkpoint.phaseId, phaseEpoch: checkpoint.phaseEpoch })],
    });
    this.options.queue.enqueue(statements);
  }

  voteSnapshot(snapshot: FinalVoteSnapshot): void {
    const phase = this.options.scenario.phases.find((candidate) => candidate.id === snapshot.questionId);
    if (!phase || phase.kind !== "position-question") throw new Error(`unknown persisted question ${snapshot.questionId}`);
    const resolution = resolveSnapshot(phase, snapshot);
    const counted = new Set<PositionVoteStatus>(
      phase.next.type === "quadrant-plurality"
        ? phase.next.countedStatuses
        : ["valid", "stale", "disconnected"],
    );
    const classification = classifyPositionVotesForField(phase.field, snapshot.votes, counted);
    const outcome = {
      field: phase.field,
      layout: phase.field.type,
      activeAxis: phase.field.type === "two-quadrant" ? phase.field.axis : "both",
      quadrantCounts: resolution.quadrantCounts,
      includedByStatus: classification.includedByStatus,
      excludedByStatus: classification.excludedByStatus,
      includedTotal: classification.includedTotal,
      excludedTotal: classification.excludedTotal,
      winner: resolution.winner,
      resolvedTarget: resolution.resolvedTarget,
      countedStatuses: [...counted],
      boundaryConvention: boundaryConvention(phase.field),
    };
    const axes = persistedAxes(phase.field);
    const rowId = phaseRowId(snapshot);
    const statements: SqlStatement[] = [{
      text: `insert into session_phases (id,session_id,phase_id,phase_index,started_at,ended_at,question_text,x_axis_json,y_axis_json,outcome_json)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        on conflict (id) do update set ended_at=excluded.ended_at,question_text=excluded.question_text,x_axis_json=excluded.x_axis_json,y_axis_json=excluded.y_axis_json,outcome_json=excluded.outcome_json`,
      values: [rowId, snapshot.sessionId, phase.id, snapshot.phaseEpoch, iso(snapshot.votes[0]?.currentPhaseStartedAt ?? snapshot.recordedAt), iso(snapshot.recordedAt), phase.text, JSON.stringify(axes.xAxis), JSON.stringify(axes.yAxis), JSON.stringify(outcome)],
    }];
    for (const vote of snapshot.votes) statements.push({
      text: `insert into votes (session_phase_id,participant_id,x,y,status,last_input_at,recorded_at,metadata_json,retained_until)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (session_phase_id,participant_id) do nothing`,
      values: [rowId, vote.participantId, vote.x, vote.y, vote.status, iso(vote.lastInputAt), iso(vote.recordedAt), JSON.stringify({ lastHeartbeatAt: iso(vote.lastHeartbeatAt) }), iso(this.options.participantDataExpiresAt)],
    });
    this.options.queue.enqueue(statements);
  }

  async deleteExpiredParticipantData(cutoff = Date.now()): Promise<number> {
    const rows = await this.options.queue.query<{ deletedCount: string | number }>({
      text: `select delete_expired_participant_data($1) as "deletedCount"`,
      values: [iso(cutoff)],
    });
    const deletedCount = Number(rows[0]?.deletedCount);
    if (!Number.isSafeInteger(deletedCount) || deletedCount < 0) {
      throw new Error("participant retention cleanup returned an invalid deletion count");
    }
    return deletedCount;
  }

  audit(entry: { action: string; at: string; detail: unknown }): void {
    this.options.queue.enqueue([{ text: "insert into events (session_id,type,payload_json,created_at) values ($1,'admin_action',$2,$3)", values: [this.lastActiveSessionId ?? `installation:${this.options.installationId}`, JSON.stringify(entry), entry.at] }]);
  }

  recordError(entry: { message: string; at: string; path: string }): void {
    this.errors.push(entry); if (this.errors.length > 50) this.errors.shift();
    this.options.queue.enqueue([{ text: "insert into health_events (installation_id,component,status,payload_json,created_at) values ($1,'server','error',$2,$3)", values: [this.options.installationId, JSON.stringify(entry), entry.at] }]);
  }

  recordHealthEvent(event: PersistenceQueueHealthEvent, at = Date.now()): void {
    const error = event.status === "degraded" && event.error instanceof Error
      ? { name: event.error.name, message: event.error.message }
      : undefined;
    this.options.queue.enqueue([{
      text: "insert into health_events (installation_id,component,status,payload_json,created_at) values ($1,'persistence',$2,$3,$4)",
      values: [this.options.installationId, event.status, JSON.stringify({ ...event, error }), iso(at)],
    }]);
  }

  async recoverAfterCrash(now = Date.now()): Promise<number> {
    const active = await this.options.queue.query<{ id: string }>({
      text: "select id from sessions where installation_id=$1 and status='active' order by started_at",
      values: [this.options.installationId],
    });
    for (const session of active) {
      this.options.queue.enqueue([{
        text: "update sessions set status='ended',ended_at=$2,end_reason='crash-recovery',current_phase_id='idle',current_phase_deadline=null where id=$1 and status='active'",
        values: [session.id, iso(now)],
      }, {
        text: "insert into events (session_id,type,payload_json,created_at) values ($1,'recovery',$2,$3)",
        values: [session.id, JSON.stringify({ reason: "crash-recovery", recoveredAt: iso(now) }), iso(now)],
      }]);
    }
    return active.length;
  }

  async recentErrors(): Promise<readonly unknown[]> { return this.errors.slice(-50); }

  async exportSession(sessionId: string): Promise<AdminExport | null> {
    type ExportRow = {
      sessionId: string; questionId: string; phaseEpoch: number; outcome: unknown;
      participantId: string | null; x: number | null; y: number | null;
      status: string | null; lastInputAt: string | null; recordedAt: string | null;
    };
    const rows = await this.options.queue.query<ExportRow>({
      text: `select s.id as "sessionId", sp.phase_id as "questionId", sp.phase_index as "phaseEpoch", sp.outcome_json as outcome,
        v.participant_id as "participantId", v.x, v.y, v.status, v.last_input_at as "lastInputAt", v.recorded_at as "recordedAt"
        from sessions s join session_phases sp on sp.session_id=s.id
        left join votes v on v.session_phase_id=sp.id
        where s.id=$1 and sp.outcome_json is not null order by sp.phase_index,v.id`,
      values: [sessionId],
    });
    if (rows.length === 0) return null;
    const grouped = new Map<number, ExportRow[]>();
    for (const row of rows) grouped.set(row.phaseEpoch, [...(grouped.get(row.phaseEpoch) ?? []), row]);
    const snapshots = [...grouped].map(([phaseEpoch, phaseRows]) => ({
      sessionId,
      questionId: phaseRows[0]!.questionId,
      phaseEpoch,
      outcome: phaseRows[0]!.outcome,
      votes: phaseRows.filter((row) => row.participantId !== null).map((row) => ({
        participantId: row.participantId, x: row.x, y: row.y, status: row.status,
        lastInputAt: row.lastInputAt, recordedAt: row.recordedAt,
      })),
    }));
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const columns = ["sessionId", "questionId", "participantId", "x", "y", "status", "recordedAt"] as const;
    const voteRows = rows.filter((row): row is ExportRow & { participantId: string } => row.participantId !== null);
    return { json: { sessionId, snapshots }, csv: [columns.join(","), ...voteRows.map((row) => columns.map((column) => quote(row[column])).join(","))].join("\n") };
  }

  flush(): Promise<void> { return this.options.queue.flush(); }
  shutdown(timeoutMs: number): Promise<PersistenceShutdownResult> { return this.options.queue.shutdown(timeoutMs); }
}
