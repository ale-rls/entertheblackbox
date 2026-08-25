import type { AdminDataSource, AdminExport } from "../admin/index.js";
import type { PhaseCheckpoint } from "../engine/phase-engine.js";
import type {
  MovementBatchFlushed,
  MovementRecordingFinalized,
  MovementRecordingStarted,
} from "../movement/index.js";
import type { FinalVoteSnapshot, PositionVote } from "../votes/index.js";
import type { PocketBaseClient } from "./pocketbase-client.js";

const RECENT_ERRORS_LIMIT = 100;

type AdminErrorRecord = { message: string; at: string; path: string };
type SessionCheckpointRecord = PhaseCheckpoint & { installationId: string; roomId: string };
type VoteSnapshotRecord = {
  sessionId: string;
  questionId: string;
  phaseEpoch: number;
  recordedAt: number;
  votes: readonly PositionVote[];
};

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function votesToCsv(votes: readonly PositionVote[]): string {
  const header = [
    "questionId", "participantId", "x", "y", "status",
    "lastInputAt", "lastHeartbeatAt", "recordedAt",
  ];
  const rows = votes.map((vote) => [
    vote.questionId, vote.participantId, vote.x, vote.y, vote.status,
    vote.lastInputAt, vote.lastHeartbeatAt, vote.recordedAt,
  ].map(csvEscape).join(","));
  return [header.join(","), ...rows].join("\n");
}

/**
 * AdminDataSource backed by PocketBase. Every write is best-effort/fire-and-
 * forget (matching the interface's synchronous `void` signatures) since
 * admin telemetry must never block the request or websocket path that
 * triggered it; failures are logged to stderr instead of surfaced.
 */
export class PocketBaseAdminDataSource implements AdminDataSource {
  constructor(
    private readonly client: PocketBaseClient,
    private readonly installation: { installationId: string; roomId: string },
  ) {}

  recordError(entry: { message: string; at: string; path: string }): void {
    void this.create("admin_errors", entry);
  }

  audit(entry: { action: string; at: string; detail: unknown }): void {
    void this.create("admin_audit", entry);
  }

  recordCheckpoint(checkpoint: PhaseCheckpoint): void {
    // PocketBase coerces an explicit `deadlineAt: null` to 0 (non-required
    // number fields have no null state); 0 never collides with a real
    // epoch-ms deadline, so it stays a safe "no deadline" sentinel.
    void this.create("session_checkpoints", { ...checkpoint, ...this.installation });
  }

  recordVoteSnapshot(snapshot: FinalVoteSnapshot): void {
    void this.create("vote_snapshots", {
      sessionId: snapshot.sessionId,
      questionId: snapshot.questionId,
      phaseEpoch: snapshot.phaseEpoch,
      recordedAt: snapshot.recordedAt,
      votes: snapshot.votes,
    });
  }

  recordMovementStarted(event: MovementRecordingStarted): void {
    void this.create("movement_recordings", {
      recordingId: event.recordingId,
      sessionId: event.sessionId,
      participantId: event.participantId,
      showId: event.showId,
      scenarioVersion: event.scenarioVersion,
      installationId: event.installationId,
      roomId: event.roomId,
      startedAt: event.startedAt,
      status: "recording",
      sampleCount: 0,
    });
  }

  recordMovementBatch(event: MovementBatchFlushed): void {
    void this.create("movement_recording_batches", {
      recordingId: event.recordingId,
      sessionId: event.sessionId,
      batchIndex: event.batchIndex,
      recordedAt: event.recordedAt,
      samples: event.samples,
    });
  }

  recordMovementFinalized(event: MovementRecordingFinalized): void {
    void this.finalizeMovementRecording(event);
  }

  async recentErrors(): Promise<readonly unknown[]> {
    await this.client.ensureAuth();
    const result = await this.client.pb.collection<AdminErrorRecord>("admin_errors")
      .getList(1, RECENT_ERRORS_LIMIT, { sort: "-at" });
    return result.items.map((item) => ({ message: item.message, at: item.at, path: item.path }));
  }

  async exportSession(sessionId: string): Promise<AdminExport | null> {
    await this.client.ensureAuth();
    const filter = this.client.pb.filter("sessionId = {:sessionId}", { sessionId });
    const [checkpoints, snapshots] = await Promise.all([
      this.client.pb.collection<SessionCheckpointRecord>("session_checkpoints")
        .getFullList({ filter, sort: "startedAt" }),
      this.client.pb.collection<VoteSnapshotRecord>("vote_snapshots")
        .getFullList({ filter, sort: "recordedAt" }),
    ]);
    if (checkpoints.length === 0 && snapshots.length === 0) return null;

    const votes = snapshots.flatMap((snapshot) => snapshot.votes);
    return {
      json: {
        sessionId,
        checkpoints: checkpoints.map((c) => ({
          kind: c.kind, reason: c.reason, phaseId: c.phaseId, phaseEpoch: c.phaseEpoch,
          startedAt: c.startedAt, deadlineAt: c.deadlineAt,
        })),
        voteSnapshots: snapshots.map((s) => ({
          questionId: s.questionId, phaseEpoch: s.phaseEpoch, recordedAt: s.recordedAt, votes: s.votes,
        })),
      },
      csv: votesToCsv(votes),
    };
  }

  private async create<T extends Record<string, unknown>>(collection: string, data: T): Promise<void> {
    try {
      await this.client.ensureAuth();
      await this.client.pb.collection(collection).create(data);
    } catch (error) {
      console.error(`pocketbase: failed to write to ${collection}`, error);
    }
  }

  private async finalizeMovementRecording(event: MovementRecordingFinalized): Promise<void> {
    try {
      await this.client.ensureAuth();
      const record = await this.client.pb.collection("movement_recordings")
        .getFirstListItem(this.client.pb.filter("recordingId = {:id}", { id: event.recordingId }));
      await this.client.pb.collection("movement_recordings").update(record.id, {
        endedAt: event.endedAt,
        status: event.status,
        sampleCount: event.sampleCount,
      });
    } catch (error) {
      console.error("pocketbase: failed to finalize movement_recordings", error);
    }
  }
}
