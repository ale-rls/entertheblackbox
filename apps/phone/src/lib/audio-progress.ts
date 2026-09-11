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

/**
 * A live Icecast stream has no reason to sit far ahead of playback: normal
 * delivery arrives close to encode rate, so buffered-but-unplayed audio
 * stays a second or two deep. A wider gap means the phone caught up from a
 * network hiccup mid-backlog rather than at the live edge, and playback
 * will keep dragging that same number of seconds behind until something
 * forces a reconnect. Reconnecting resets to the live edge (SPEC §5).
 */
export function drifted(bufferedEnd: number, position: number, threshold = 4): boolean {
  return bufferedEnd - position >= threshold;
}
