/** Playback progress, independent of timer cadence and time spent backgrounded. */
export class AudioProgress {
  private position = 0;
  private progressedAt = 0;

  reset(position: number, now = Date.now()): void {
    this.position = position;
    this.progressedAt = now;
  }

  advanced(position: number, now = Date.now()): boolean {
    if (!Number.isFinite(position) || position === this.position) return false;
    this.reset(position, now);
    return true;
  }

  stalled(position: number, now = Date.now(), thresholdMs = 15_000): boolean {
    this.advanced(position, now);
    return now - this.progressedAt >= thresholdMs;
  }
}
