import { WebSocket } from "ws";
import { TrackedAudience, type TrackingAction } from "./audience.js";

/**
 * Long-lived client for TrackingBox's `/ws`.
 *
 * TrackingBox is a sensor on a different machine, so the connection is expected
 * to drop and come back during a show. Reconnection backs off, and every
 * reconnect is followed by a fresh snapshot that replaces local state wholesale
 * — see TrackedAudience for why patching would be wrong.
 *
 * Failures never throw into the caller. A tracking outage should degrade the
 * show to "nobody is standing anywhere", not stop the phase engine.
 */

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 10_000;

export type TrackingClientOptions = {
  url: string;
  onActions: (actions: readonly TrackingAction[]) => void;
  /** Injectable for tests; defaults to the real ws client. */
  createSocket?: (url: string) => WebSocket;
  onError?: (error: unknown) => void;
  initialReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
};

export class TrackingClient {
  private readonly audience = new TrackedAudience();
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs: number;
  private stopped = false;

  constructor(private readonly options: TrackingClientOptions) {
    this.reconnectDelayMs = options.initialReconnectDelayMs ?? INITIAL_RECONNECT_DELAY_MS;
  }

  /** Bodies currently believed present, for the admin dashboard. */
  get trackedCount(): number {
    return this.audience.size;
  }

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  start(): void {
    if (this.stopped) return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.emit(this.audience.reset());
  }

  private connect(): void {
    const create = this.options.createSocket ?? ((url: string) => new WebSocket(url));
    let socket: WebSocket;
    try {
      socket = create(this.options.url);
    } catch (error) {
      this.options.onError?.(error);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.on("open", () => {
      // Only a delivered snapshot proves the link works, but resetting backoff
      // here is close enough and keeps a flapping link from backing off forever.
      this.reconnectDelayMs = this.options.initialReconnectDelayMs ?? INITIAL_RECONNECT_DELAY_MS;
    });

    socket.on("message", (data: unknown) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch (error) {
        this.options.onError?.(error);
        return;
      }
      this.emit(this.audience.ingest(parsed));
    });

    socket.on("error", (error: unknown) => {
      this.options.onError?.(error);
    });

    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
      // Everyone is unknown until the next snapshot lands.
      this.emit(this.audience.reset());
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(
      delay * 2,
      this.options.maxReconnectDelayMs ?? MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private emit(actions: readonly TrackingAction[]): void {
    if (actions.length === 0) return;
    try {
      this.options.onActions(actions);
    } catch (error) {
      this.options.onError?.(error);
    }
  }
}
