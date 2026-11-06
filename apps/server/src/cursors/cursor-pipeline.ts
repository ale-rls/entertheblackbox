import { PROTOCOL_VERSION, type Cursor, type CursorsMessage, type PresenceMessage } from "@entertheblackbox/protocol";

export const CURSOR_TICK_INTERVAL_MS = 40;

type CursorState = Cursor & { lastSeq: number };

export type CursorPipelineOptions = {
  sendCursors: (message: CursorsMessage) => void;
  sendPresence: (message: PresenceMessage) => void;
  canSendCursors?: () => boolean;
  intervalMs?: number;
};

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

export class CursorPipeline {
  private readonly cursors = new Map<string, CursorState>();
  private readonly intervalMs: number;
  private lastEmittedCursors: Cursor[] = [];
  private ghostCursors: readonly Cursor[] = [];
  private dirty = false;
  /**
   * Curtain-light stages: cursors stay hidden (and ghosts are suppressed)
   * until the participant first touches their phone during the stage.
   */
  private entryStage = false;
  private readonly entered = new Set<string>();
  /** Last position of an entered participant who disconnected mid-stage. */
  private readonly parked = new Map<string, { x: number; y: number }>();
  private readonly pulses = new Map<string, number>();
  private tickNumber = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: CursorPipelineOptions) {
    this.intervalMs = options.intervalMs ?? CURSOR_TICK_INTERVAL_MS;
    if (this.intervalMs < 1) throw new Error("cursor interval must be positive");
  }

  join(clientId: string, color: string): void {
    const existing = this.cursors.get(clientId);
    if (existing) {
      existing.lastSeq = -1;
      return;
    }
    const parked = this.parked.get(clientId);
    this.parked.delete(clientId);
    this.cursors.set(clientId, { clientId, color, x: parked?.x ?? 0.5, y: parked?.y ?? 0.5, lastSeq: -1 });
    this.dirty = true;
    this.emitPresence();
  }

  leave(clientId: string): void {
    const cursor = this.cursors.get(clientId);
    // A reconnect within the same stage resumes where the cursor was.
    if (cursor && this.entryStage && this.entered.has(clientId)) this.parked.set(clientId, { x: cursor.x, y: cursor.y });
    if (this.cursors.delete(clientId)) {
      this.dirty = true;
      this.emitPresence();
    }
  }

  recordInput(clientId: string, seq: number, x: number, y: number): boolean {
    const cursor = this.cursors.get(clientId);
    if (!cursor || !Number.isSafeInteger(seq) || seq < 0 || seq <= cursor.lastSeq) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    cursor.lastSeq = seq;
    const nextX = clamp(x);
    const nextY = clamp(y);
    if (cursor.x !== nextX || cursor.y !== nextY) this.dirty = true;
    cursor.x = nextX;
    cursor.y = nextY;
    return true;
  }

  /** Validate and consume an input sequence number without moving the cursor. */
  acceptSeq(clientId: string, seq: number): boolean {
    const cursor = this.cursors.get(clientId);
    if (!cursor || !Number.isSafeInteger(seq) || seq < 0 || seq <= cursor.lastSeq) return false;
    cursor.lastSeq = seq;
    return true;
  }

  position(clientId: string): { x: number; y: number } | null {
    const cursor = this.cursors.get(clientId);
    return cursor ? { x: cursor.x, y: cursor.y } : null;
  }

  /** Move a cursor to a server-computed position (curtain-light relative input). */
  place(clientId: string, x: number, y: number): void {
    const cursor = this.cursors.get(clientId);
    if (!cursor || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const nextX = clamp(x);
    const nextY = clamp(y);
    if (cursor.x !== nextX || cursor.y !== nextY) this.dirty = true;
    cursor.x = nextX;
    cursor.y = nextY;
  }

  /** Start (true) or end (false) a stage where cursors appear only after first interaction. */
  setEntryStage(active: boolean): void {
    this.entryStage = active;
    this.entered.clear();
    this.parked.clear();
    this.pulses.clear();
    this.dirty = true;
  }

  get inEntryStage(): boolean {
    return this.entryStage;
  }

  isEntered(clientId: string): boolean {
    return !this.entryStage || this.entered.has(clientId);
  }

  /** Reveal a participant's cursor at the stage's neutral entry point. */
  enter(clientId: string, x: number, y: number): void {
    if (!this.cursors.has(clientId)) return;
    this.entered.add(clientId);
    this.place(clientId, x, y);
    this.pulse(clientId);
  }

  /** Briefly brighten this participant's light (they touched their phone). */
  pulse(clientId: string): void {
    if (!this.cursors.has(clientId)) return;
    this.pulses.set(clientId, (this.pulses.get(clientId) ?? 0) + 1);
    this.dirty = true;
  }

  /** Replace the current set of replayed ("ghost") cursors -- see apps/server/src/ghosts. */
  setGhostCursors(ghosts: readonly Cursor[]): void {
    this.ghostCursors = ghosts;
    this.dirty = true;
  }

  tick(): void {
    if (!this.dirty || this.options.canSendCursors?.() === false) return;
    const liveCursors = [...this.cursors.values()]
      .filter((cursor) => !this.entryStage || this.entered.has(cursor.clientId))
      .map(({ lastSeq: _lastSeq, ...cursor }) => {
        const pulse = this.pulses.get(cursor.clientId);
        return pulse === undefined ? cursor : { ...cursor, pulse };
      });
    // Replayed cursors never "enter", so they would light the curtain unasked.
    const cursors = this.entryStage ? liveCursors : [...liveCursors, ...this.ghostCursors];
    if (this.matchesLastEmission(cursors)) {
      this.dirty = false;
      return;
    }
    this.options.sendCursors({
      t: "cursors",
      v: PROTOCOL_VERSION,
      tick: this.tickNumber,
      cursors,
    });
    this.lastEmittedCursors = cursors;
    this.dirty = false;
    this.tickNumber += 1;
  }

  requestSnapshot(): void {
    if (this.cursors.size === 0) return;
    this.lastEmittedCursors = [];
    this.dirty = true;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private emitPresence(): void {
    this.options.sendPresence({ t: "presence", v: PROTOCOL_VERSION, count: this.cursors.size });
  }

  private matchesLastEmission(cursors: Cursor[]): boolean {
    return cursors.length === this.lastEmittedCursors.length && cursors.every((cursor, index) => {
      const previous = this.lastEmittedCursors[index];
      return previous !== undefined &&
        cursor.clientId === previous.clientId &&
        cursor.color === previous.color &&
        cursor.x === previous.x &&
        cursor.y === previous.y &&
        cursor.ghost === previous.ghost &&
        cursor.pulse === previous.pulse;
    });
  }
}
