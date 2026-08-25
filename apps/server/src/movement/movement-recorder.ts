export const MOVEMENT_FLUSH_INTERVAL_MS = 5_000;
export const MOVEMENT_FLUSH_SAMPLE_THRESHOLD = 150;
const MOVEMENT_TICK_INTERVAL_MS = 1_000;

export type MovementSample = { t: number; x: number; y: number };

export type MovementRecordingStarted = {
  recordingId: string;
  sessionId: string;
  participantId: string;
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
  sessionId: string;
  recordingId: string | null;
  startedAt: number | null;
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
 * design, but a recording is created lazily on a participant's first
 * sample rather than on join, so participants who never move produce no
 * recording at all.
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

  join(participantId: string, sessionId: string): void {
    if (this.participants.has(participantId)) return;
    this.participants.set(participantId, {
      participantId,
      sessionId,
      recordingId: null,
      startedAt: null,
      buffer: [],
      batchIndex: 0,
      sampleCount: 0,
      lastFlushAt: 0,
    });
  }

  recordSample(participantId: string, x: number, y: number, now: number): void {
    const state = this.participants.get(participantId);
    if (!state || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (state.startedAt === null) {
      state.startedAt = now;
      // Includes startedAt so a full drop-then-reconnect within the same
      // session (which produces a second join()/recordSample() cycle for
      // the same sessionId+participantId) still gets a unique recordingId.
      state.recordingId = `${state.sessionId}:${participantId}:${now}`;
      state.lastFlushAt = now;
      this.options.onRecordingStarted({
        recordingId: state.recordingId,
        sessionId: state.sessionId,
        participantId,
        showId: this.options.showId,
        scenarioVersion: this.options.scenarioVersion,
        installationId: this.options.installationId,
        roomId: this.options.roomId,
        startedAt: now,
      });
    }
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
      if (state.recordingId === null || state.buffer.length === 0) continue;
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
    if (state.recordingId === null) return;
    if (state.buffer.length > 0) this.flush(state, now);
    this.options.onRecordingFinalized({
      recordingId: state.recordingId,
      endedAt: now,
      status,
      sampleCount: state.sampleCount,
    });
  }

  private flush(state: ParticipantState, now: number): void {
    if (state.recordingId === null || state.buffer.length === 0) return;
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
