/**
 * Relative trackpad model (plan §8/§10): the phone is a relative X/Y
 * trackpad; the participant watches their cursor on the projection.
 * Pointer deltas move a normalized 0..1 position that is clamped at the
 * edges. Sensitivity is a director-tunable factor (Phase 0) mapping
 * screen-fraction deltas to cursor-fraction movement.
 */

export type TrackpadState = { x: number; y: number };

export const TRACKPAD_CENTER: TrackpadState = { x: 0.5, y: 0.5 };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function applyDelta(
  state: TrackpadState,
  deltaXPx: number,
  deltaYPx: number,
  surfaceSizePx: number,
  sensitivity = 1.4,
): TrackpadState {
  if (surfaceSizePx <= 0) return state;
  return {
    x: clamp01(state.x + (deltaXPx / surfaceSizePx) * sensitivity),
    y: clamp01(state.y + (deltaYPx / surfaceSizePx) * sensitivity),
  };
}

/**
 * Input throttle (plan §7: client sends at ~20–30 Hz). Move samples are
 * latest-wins, but a throttled sample remains pending so gesture end can
 * explicitly flush the final position.
 */
export class InputThrottle {
  private lastSentAt = -Infinity;
  private pending = false;

  constructor(private readonly minIntervalMs = 40) {} // 25 Hz

  shouldSend(now: number): boolean {
    if (now - this.lastSentAt < this.minIntervalMs) {
      this.pending = true;
      return false;
    }
    this.lastSentAt = now;
    this.pending = false;
    return true;
  }

  /** Flush a move sample suppressed during the current gesture, if any. */
  shouldFlushFinal(now: number): boolean {
    if (!this.pending) return false;
    this.lastSentAt = now;
    this.pending = false;
    return true;
  }
}
