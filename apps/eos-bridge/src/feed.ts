import type { Log } from "./eos.js";

/** The part of an EventSource the feed uses (the `eventsource` package, or a fake in tests). */
export type FeedSource = {
  readonly readyState: number;
  onopen: (() => void) | null;
  onerror: ((error: { code?: number | undefined; message?: string | undefined }) => void) | null;
  onmessage: ((message: { data: string }) => void) | null;
  close(): void;
};

/**
 * The fetch the feed's EventSource uses: adds the display token and asks for an
 * uncompressed stream. Node's fetch offers br and zstd by default, and a proxy
 * that compresses with those holds the event stream back to fill its buffer:
 * not even the headers arrive, so the feed never opens. A live stream of small
 * events gains nothing from compression.
 */
export function feedFetch(token: string, fetchImpl: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept-Encoding", "identity");
    return fetchImpl(input, { ...init, headers });
  };
}

const CLOSED = 2;
export const FEED_RETRY_MIN_MS = 1_000;
export const FEED_RETRY_MAX_MS = 30_000;

/**
 * Keeps the cue feed (GET /api/cues) open. EventSource retries dropped
 * connections by itself, but an HTTP error response (a 502 while the server
 * restarts, a 503 from the proxy) closes it for good, per the spec. Then this
 * opens a fresh one, backing off 1 s, 2 s, 4 s … up to 30 s, and starts over
 * at 1 s once a connection opens. A 401 is final: the token is wrong.
 */
export class CueFeed {
  private source: FeedSource | null = null;
  private retryMs = FEED_RETRY_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private connected = false;
  private failingSince: number | null = null;
  private lastWarning = 0;
  private stopped = false;

  constructor(
    private readonly url: URL,
    private readonly open: (url: URL) => FeedSource,
    private readonly onEvent: (data: string) => void,
    private readonly log: Log,
    private readonly onUnauthorized: () => void,
    private readonly now: () => number = Date.now,
    private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (fn, ms) => setTimeout(fn, ms),
  ) {}

  start(): void {
    this.log(`connecting to ${this.url.origin}…`);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.source?.close();
  }

  private connect(): void {
    if (this.stopped) return;
    const source = this.open(this.url);
    this.source = source;
    source.onopen = () => {
      this.connected = true;
      this.failingSince = null;
      this.retryMs = FEED_RETRY_MIN_MS;
      this.log(`listening to ${this.url.origin}`);
    };
    source.onerror = (error) => {
      if (source !== this.source) return;
      const status = error.code;
      if (status === 401) {
        this.log("server rejected the display token (401); check DISPLAY_TOKEN");
        this.stop();
        this.onUnauthorized();
        return;
      }
      const now = this.now();
      if (this.connected) this.log("connection lost · reconnecting…");
      else if (now - this.lastWarning > 10_000) {
        // Say so while it keeps failing, so whoever watches the laptop sees cues are not arriving.
        this.log(`cannot reach ${this.url.origin}${status ? ` (HTTP ${status})` : ""}${this.failingSince ? ` for ${Math.round((now - this.failingSince) / 1000)} s` : ""} · retrying`);
        this.lastWarning = now;
      }
      this.failingSince ??= now;
      this.connected = false;
      if (source.readyState === CLOSED) {
        // EventSource gave up (HTTP error response): open a new one ourselves.
        source.close();
        const delay = this.retryMs;
        this.retryMs = Math.min(FEED_RETRY_MAX_MS, this.retryMs * 2);
        clearTimeout(this.retryTimer);
        this.retryTimer = this.schedule(() => this.connect(), delay);
      }
    };
    source.onmessage = (message) => this.onEvent(message.data);
  }
}
