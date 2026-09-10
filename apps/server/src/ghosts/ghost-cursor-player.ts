import { createHash } from "node:crypto";
import type { Cursor } from "@smartphonecracy/protocol";
import { IDENTITY_COLORS } from "../admission/registry.js";

export const GHOST_TICK_INTERVAL_MS = 40;

/** One recorded position, `t` = ms since the *past* recording started (session-relative). */
export type GhostSample = { t: number; x: number; y: number };

/** One past participant's full playthrough, samples ascending by `t`. */
export type GhostTrack = { recordingId: string; samples: readonly GhostSample[] };

export type GhostPool = { tracks: readonly GhostTrack[] };

export type GhostCursorPlayerOptions = {
  pool: GhostPool;
  targetAudienceSize: () => number;
  liveConnectedCount: () => number;
  /** The current live session's start time, or null while no session is active. */
  sessionStartedAt: () => number | null;
  onFrame: (ghosts: readonly Cursor[]) => void;
  now?: () => number;
  intervalMs?: number;
  colorFor?: (recordingId: string) => string;
};

function defaultColorFor(recordingId: string): string {
  const digest = createHash("sha256").update(recordingId).digest();
  return IDENTITY_COLORS[digest[0]! % IDENTITY_COLORS.length]!;
}

/**
 * Given one past participant's `t`-ascending samples and the live show's
 * current session-relative elapsed time, returns their interpolated
 * position: held at the first/last sample outside the recorded range,
 * linearly interpolated between the bracketing pair otherwise. Never
 * throws for a well-formed non-empty `samples` array.
 */
export function interpolate(samples: readonly GhostSample[], sessionElapsed: number): { x: number; y: number } {
  const first = samples[0]!;
  if (sessionElapsed <= first.t) return { x: first.x, y: first.y };
  const last = samples[samples.length - 1]!;
  if (sessionElapsed >= last.t) return { x: last.x, y: last.y };
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.t <= sessionElapsed) lo = mid;
    else hi = mid;
  }
  const a = samples[lo]!;
  const b = samples[hi]!;
  const span = b.t - a.t;
  const fraction = span === 0 ? 0 : (sessionElapsed - a.t) / span;
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
}

/**
 * Replays past participants' recorded cursor paths ("ghosts") to fill out
 * a sparse live audience, timed by session-relative elapsed ms rather than
 * by phase: since phase durations are fixed per scenario version, a past
 * recording's own session-elapsed time already lines up with "what phase
 * was showing" consistently across runs (see persistence/ghost-pool-loader.ts).
 *
 * Owns no PocketBase/WebSocket awareness -- `pool` is pre-loaded data and
 * `onFrame` is a plain callback, mirroring MovementRecorder/CursorPipeline's
 * separation of "what happened" from "how it's sent".
 */
export class GhostCursorPlayer {
  private readonly now: () => number;
  private readonly intervalMs: number;
  private readonly colorFor: (recordingId: string) => string;
  private roster: GhostTrack[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: GhostCursorPlayerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.intervalMs = options.intervalMs ?? GHOST_TICK_INTERVAL_MS;
    this.colorFor = options.colorFor ?? defaultColorFor;
    if (this.intervalMs < 1) throw new Error("ghost cursor interval must be positive");
  }

  /** Pick a fixed roster of past recordings for the whole upcoming live session. */
  selectForSession(now = this.now()): void {
    const wanted = Math.min(this.options.pool.tracks.length, Math.max(0, this.options.targetAudienceSize()));
    this.roster = shuffle([...this.options.pool.tracks]).slice(0, wanted);
    this.emitFrame(now);
  }

  /** Recompute the rendered subset immediately (live participant count may have changed). */
  onPhaseChanged(now = this.now()): void {
    this.emitFrame(now);
  }

  /** Drop the roster (session ended) and emit an empty frame. */
  clear(): void {
    this.roster = [];
    this.options.onFrame([]);
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.emitFrame(this.now()), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private emitFrame(now: number): void {
    const sessionStartedAt = this.options.sessionStartedAt();
    if (sessionStartedAt === null || this.roster.length === 0) {
      this.options.onFrame([]);
      return;
    }
    const sessionElapsed = Math.max(0, now - sessionStartedAt);
    const neededCount = Math.max(0, this.options.targetAudienceSize() - this.options.liveConnectedCount());
    const frame: Cursor[] = [];
    for (const track of this.roster) {
      if (frame.length >= neededCount) break;
      if (track.samples.length === 0) continue;
      const { x, y } = interpolate(track.samples, sessionElapsed);
      frame.push({ clientId: `ghost:${track.recordingId}`, x, y, color: this.colorFor(track.recordingId), ghost: true });
    }
    this.options.onFrame(frame);
  }
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}
