/** Playback progress, independent of timer cadence and time spent backgrounded. */
export class AudioProgress {
  private position = 0;
  private progressedAt = 0;

  reset(position: number, now = Date.now()): void {
    this.position = position;
    this.progressedAt = now;
  }

  stalled(position: number, now = Date.now()): boolean {
    if (position !== this.position) this.reset(position, now);
    return now - this.progressedAt >= 15_000;
  }
}
