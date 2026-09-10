export const MOVEMENT_FLUSH_INTERVAL_MS = 5_000;
export const MOVEMENT_FLUSH_SAMPLE_THRESHOLD = 150;
const MOVEMENT_TICK_INTERVAL_MS = 1_000;

export type MovementSample = { t: number; x: number; y: number };

export type MovementRecordingStarted = {
  recordingId: string;
  sessionId: string;
  participantId: string;
  participantName: string;
  showId: string;
  scenarioVersion: string;
  installationId: string;
  roomId: string;
  startedAt: number;
};

export type MovementBatchFlushed = {
  recordingId: string;
  sessionId: string;
  batchIndex: number;
  recordedAt: number;
  samples: readonly MovementSample[];
};

export type MovementRecordingFinalized = {
  recordingId: string;
  endedAt: number;
  status: "completed" | "abandoned";
  sampleCount: number;
};

export type MovementRecorderOptions = {
  showId: string;
  scenarioVersion: string;
  installationId: string;
  roomId: string;
  intervalMs?: number;
  sampleThreshold?: number;
  onRecordingStarted: (event: MovementRecordingStarted) => void;
  onBatchFlushed: (event: MovementBatchFlushed) => void;
  onRecordingFinalized: (event: MovementRecordingFinalized) => void;
};

type ParticipantState = {
  participantId: string;
  participantName: string;
  sessionId: string;
  recordingId: string;
  startedAt: number;
  buffer: MovementSample[];
  batchIndex: number;
  sampleCount: number;
  lastFlushAt: number;
};

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Records each connected participant's movement path during a live show
 * session, buffering samples in memory and flushing periodic batches via
 * callbacks (no PocketBase awareness here — see PocketBaseAdminDataSource
 * for the persistence sink). Mirrors CursorPipeline's per-participant Map
 * design. The lightweight parent recording is created on active-session
 * join—even when the participant never moves—so it also serves as the
 * durable named participant ledger for session monitoring and exports.
 */
export class MovementRecorder {
  private readonly participants = new Map<string, ParticipantState>();
  private readonly intervalMs: number;
  private readonly sampleThreshold: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: MovementRecorderOptions) {
    this.intervalMs = options.intervalMs ?? MOVEMENT_FLUSH_INTERVAL_MS;
    this.sampleThreshold = options.sampleThreshold ?? MOVEMENT_FLUSH_SAMPLE_THRESHOLD;
    if (this.intervalMs < 1) throw new Error("movement flush interval must be positive");
    if (this.sampleThreshold < 1) throw new Error("movement flush sample threshold must be positive");
  }

  join(participantId: string, participantName: string, sessionId: string, now: number): void {
    if (this.participants.has(participantId)) return;
    const state: ParticipantState = {
      participantId,
      participantName,
      sessionId,
      recordingId: `${sessionId}:${participantId}:${now}`,
      startedAt: now,
      buffer: [],
      batchIndex: 0,
      sampleCount: 0,
      lastFlushAt: now,
    };
    this.participants.set(participantId, state);
    this.options.onRecordingStarted({
      recordingId: state.recordingId,
      sessionId,
      participantId,
      participantName,
      showId: this.options.showId,
      scenarioVersion: this.options.scenarioVersion,
      installationId: this.options.installationId,
      roomId: this.options.roomId,
      startedAt: now,
    });
  }

  recordSample(participantId: string, x: number, y: number, now: number): void {
    const state = this.participants.get(participantId);
    if (!state || !Number.isFinite(x) || !Number.isFinite(y)) return;
    state.buffer.push({ t: now - state.startedAt, x: clamp(x), y: clamp(y) });
    state.sampleCount += 1;
    if (state.buffer.length >= this.sampleThreshold) this.flush(state, now);
  }

  leave(participantId: string, now: number): void {
    const state = this.participants.get(participantId);
    if (!state) return;
    this.participants.delete(participantId);
    this.close(state, now, "abandoned");
  }

  finalizeSession(now: number): void {
    const states = [...this.participants.values()];
    this.participants.clear();
    for (const state of states) this.close(state, now, "completed");
  }

  tick(now: number): void {
    for (const state of this.participants.values()) {
      if (state.buffer.length === 0) continue;
      if (now - state.lastFlushAt >= this.intervalMs) this.flush(state, now);
    }
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(Date.now()), MOVEMENT_TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private close(state: ParticipantState, now: number, status: "completed" | "abandoned"): void {
    if (state.buffer.length > 0) this.flush(state, now);
    this.options.onRecordingFinalized({
      recordingId: state.recordingId,
      endedAt: now,
      status,
      sampleCount: state.sampleCount,
    });
  }

  private flush(state: ParticipantState, now: number): void {
    if (state.buffer.length === 0) return;
    const samples = state.buffer;
    state.buffer = [];
    state.lastFlushAt = now;
    this.options.onBatchFlushed({
      recordingId: state.recordingId,
      sessionId: state.sessionId,
      batchIndex: state.batchIndex,
      recordedAt: now,
      samples,
    });
    state.batchIndex += 1;
  }
}
