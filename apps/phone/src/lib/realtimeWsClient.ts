/**
 * Publishes this phone's position to apps/realtime-ws-coolify's low-latency
 * cursor relay -- a separate, simpler wire protocol from packages/protocol,
 * additive to (not a replacement for) the authoritative `input` message
 * sent over the main /ws connection. Reconnect backoff mirrors
 * connection.ts's inline exponential-backoff-with-jitter (no shared
 * Backoff class in this app). Phones only ever publish position -- the
 * relay fans cursor traffic out to display sockets only, never back to
 * other phones -- so this client has no onmessage handler.
 */

export type RealtimeCursorPublisherOptions = {
  url: string;
  room: string;
  clientId: string;
  color: string;
  webSocketFactory?: (url: string) => WebSocket;
  rng?: () => number;
};

export class RealtimeCursorPublisher {
  private ws: WebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly rng: () => number;

  constructor(private readonly options: RealtimeCursorPublisherOptions) {
    this.rng = options.rng ?? Math.random;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
  }

  send(x: number, y: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: "cursor_update", x, y }));
    }
  }

  private connect(): void {
    const factory = this.options.webSocketFactory ?? ((url: string) => new WebSocket(url));
    const params = new URLSearchParams({
      room: this.options.room,
      clientId: this.options.clientId,
      color: this.options.color,
      role: "phone",
    });
    const ws = factory(`${this.options.url}/?${params.toString()}`);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.stopped) return;
      const raw = Math.min(15_000, 500 * 2 ** this.attempt);
      this.attempt += 1;
      const jitterSpan = raw * 0.2;
      const delay = Math.round(raw - jitterSpan / 2 + jitterSpan * this.rng());
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => {
      // onclose follows and owns reconnection.
    };
  }
}
