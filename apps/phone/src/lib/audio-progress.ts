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
 * A live Icecast stream has no reason to sit far ahead of playback forever,
 * but SPEC §4.3 is explicit that the phone's own live-stream buffer is not
 * ours to control and "iOS Safari alone buffers several seconds" as normal,
 * healthy behavior. The threshold has to clear that baseline or it flags
 * ordinary playback as backlog. A gap that clears it and *holds* means the
 * phone caught up from a hiccup mid-backlog rather than at the live edge,
 * and playback will keep dragging that same number of seconds behind until
 * something forces a reconnect. Reconnecting resets to the live edge (SPEC §5).
 */
export function drifted(bufferedEnd: number, position: number, threshold = 10): boolean {
  return bufferedEnd - position >= threshold;
}

/**
 * A plain `<audio src>` element never seeks itself to the live edge — it
 * just plays back whatever it has downloaded, in order, forever. Ordinary
 * network burstiness lets it download a little faster than real-time now
 * and then, and that backlog only ever grows over a multi-hour show: it
 * doesn't shrink on its own, and it's what eventually trips `drifted()`
 * into a full reconnect. It's also what makes a "stop"/interrupt cue take
 * as long to reach the ear as the backlog is deep, since Liquidsoap cutting
 * the source can't reach into a phone's local buffer and evict already-
 * downloaded audio.
 *
 * Seeking forward within data already buffered is free — no network
 * fetch, no rebuffer stall — so trimming the gap continuously here is what
 * keeps both a full reconnect and a slow stop from ever becoming necessary
 * in the common case. `drifted()`/`DriftWatch` remain the fallback for when
 * this can't keep up (e.g. seeking itself fails).
 */
export function catchUpTarget(bufferedEnd: number, position: number, aheadBy = 2, margin = 0.5): number | null {
  if (bufferedEnd - position <= aheadBy) return null;
  return bufferedEnd - margin;
}

/** Requires drift to hold across consecutive checks so one bursty sample can't force a reconnect. */
export class DriftWatch {
  private since: number | null = null;

  reset(): void {
    this.since = null;
  }

  /** True once `drifted` has held continuously for at least `holdMs`. */
  persists(isDrifted: boolean, now = Date.now(), holdMs = 10_000): boolean {
    if (!isDrifted) { this.since = null; return false; }
    if (this.since === null) this.since = now;
    return now - this.since >= holdMs;
  }
}
