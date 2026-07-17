import { PROTOCOL_VERSION, type Cursor, type CursorsMessage, type PresenceMessage } from "@smartphonecracy/protocol";

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
  private dirty = false;
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
    this.cursors.set(clientId, { clientId, color, x: 0.5, y: 0.5, lastSeq: -1 });
    this.dirty = true;
    this.emitPresence();
  }

  leave(clientId: string): void {
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

  tick(): void {
    if (!this.dirty || this.options.canSendCursors?.() === false) return;
    const cursors = [...this.cursors.values()].map(({ lastSeq: _lastSeq, ...cursor }) => cursor);
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
        cursor.y === previous.y;
    });
  }
}
