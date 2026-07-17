import type { IncomingMessage } from "node:http";

export type RateLimitResult = {
  allowed: boolean;
  retryAfterMs?: number;
};

type Bucket = { windowStartedAt: number; attempts: number };

/** Resolve the peer IP using the same explicit proxy trust policy across HTTP and WebSocket traffic. */
export function requestIp(request: IncomingMessage, trustProxy: boolean): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (trustProxy) {
    if (typeof forwarded === "string" && forwarded.length > 0) return forwarded.split(",")[0]!.trim();
    if (Array.isArray(forwarded) && forwarded[0]) return forwarded[0];
  }
  return request.socket.remoteAddress ?? "unknown";
}

/** Process-local abuse control. IPs are never used as participant identity or persisted. */
export class InMemoryIpRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly options: { maxAttempts: number; windowMs: number } = {
      maxAttempts: 30,
      windowMs: 60_000,
    },
  ) {
    if (options.maxAttempts < 1 || options.windowMs < 1) {
      throw new Error("rate limiter options must be positive");
    }
  }

  consume(ip: string, now = Date.now()): RateLimitResult {
    this.pruneExpired(now);
    const current = this.buckets.get(ip);
    if (!current || now - current.windowStartedAt >= this.options.windowMs) {
      this.buckets.set(ip, { windowStartedAt: now, attempts: 1 });
      return { allowed: true };
    }
    if (current.attempts >= this.options.maxAttempts) {
      return {
        allowed: false,
        retryAfterMs: Math.max(1, current.windowStartedAt + this.options.windowMs - now),
      };
    }
    current.attempts += 1;
    return { allowed: true };
  }

  get size(): number {
    return this.buckets.size;
  }

  pruneExpired(now = Date.now()): void {
    for (const [ip, bucket] of this.buckets) {
      if (now - bucket.windowStartedAt >= this.options.windowMs) this.buckets.delete(ip);
    }
  }

  clear(): void {
    this.buckets.clear();
  }
}
