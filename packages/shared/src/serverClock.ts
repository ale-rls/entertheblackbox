/**
 * Corrected server time (plan §7): the client estimates
 * serverOffset = serverTime - midpoint(localSend, localReceive) from
 * ping/pong pairs and renders all countdowns from corrected time, never
 * the device clock. The median of recent samples absorbs jitter spikes.
 */

const MAX_SAMPLES = 9;

export class ServerClock {
  private samples: number[] = [];
  private initialOffset = 0;
  private receivedAt: number | null = null;
  private roundTrip: number | null = null;

  /** Bootstrap before the first pong; arrival time is an approximate lower bound. */
  observe(serverTime: number, localReceive: number): void {
    if (!Number.isFinite(serverTime) || !Number.isFinite(localReceive)) return;
    if (!this.hasSamples) {
      this.initialOffset = serverTime - localReceive;
      this.receivedAt = localReceive;
    }
  }

  get ready(): boolean { return this.receivedAt !== null; }
  get roundTripMs(): number | null { return this.roundTrip; }
  sampleAgeMs(localNow = Date.now()): number | null {
    return this.receivedAt === null ? null : Math.max(0, localNow - this.receivedAt);
  }

  addSample(localSend: number, localReceive: number, serverTime: number): void {
    if (![localSend, localReceive, serverTime].every(Number.isFinite) || localReceive < localSend) return;
    this.receivedAt = localReceive;
    this.roundTrip = localReceive - localSend;
    const midpoint = (localSend + localReceive) / 2;
    this.samples.push(serverTime - midpoint);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  get hasSamples(): boolean {
    return this.samples.length > 0;
  }

  /** Median offset of recent samples; snapshot estimate until the first pong arrives. */
  get offset(): number {
    if (this.samples.length === 0) return this.initialOffset;
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
