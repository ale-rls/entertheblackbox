/**
 * Corrected server time (plan §7): the client estimates
 * serverOffset = serverTime - midpoint(localSend, localReceive) from
 * ping/pong pairs and renders all countdowns from corrected time, never
 * the device clock. The median of recent samples absorbs jitter spikes.
 */

const MAX_SAMPLES = 9;

export class ServerClock {
  private samples: number[] = [];

  addSample(localSend: number, localReceive: number, serverTime: number): void {
    const midpoint = (localSend + localReceive) / 2;
    this.samples.push(serverTime - midpoint);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  get hasSamples(): boolean {
    return this.samples.length > 0;
  }

  /** Median offset of recent samples; 0 until the first pong arrives. */
  get offset(): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  /** Current corrected server time. */
  now(localNow: number = Date.now()): number {
    return localNow + this.offset;
  }

  /** Milliseconds until a server-time deadline, floored at 0. */
  remainingUntil(deadlineServerTime: number, localNow: number = Date.now()): number {
    return Math.max(0, deadlineServerTime - this.now(localNow));
  }
}
