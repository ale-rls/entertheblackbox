import { Backoff } from "../lib/backoff.js";

/**
 * Client for apps/realtime-ws-coolify's low-latency cursor relay -- a
 * separate, simpler wire protocol from packages/protocol, additive to (not
 * a replacement for) the main /ws connection's batched `cursors` messages.
 * The relay coalesces phone position updates into periodic `cursor_batch`
 * messages rather than relaying each one individually, so `cursor_batch`
 * fans out to the same onUpdate callback as a single `cursor_update`.
 * Delivers parsed events via callbacks rather than writing into a
 * CursorField directly, so the caller can apply the same phase/session
 * gating it already applies to the main-protocol path.
 */

type RelayCursor = { clientId: string; color: string; x: number; y: number };

export type RealtimeWsClientOptions = {
  url: string;
  room: string;
  onSnapshot: (cursors: readonly RelayCursor[]) => void;
  onUpdate: (cursor: RelayCursor) => void;
  onLeave: (clientId: string) => void;
  webSocketFactory?: (url: string) => WebSocket;
  backoff?: Backoff;
};

function isRelayCursor(value: unknown): value is RelayCursor {
  if (typeof value !== "object" || value === null) return false;
  const cursor = value as Partial<RelayCursor>;
  return (
    typeof cursor.clientId === "string" &&
    typeof cursor.color === "string" &&
    typeof cursor.x === "number" && Number.isFinite(cursor.x) &&
    typeof cursor.y === "number" && Number.isFinite(cursor.y)
  );
}

export class RealtimeWsClient {
  private ws: WebSocket | null = null;
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly backoff: Backoff;

  constructor(private readonly options: RealtimeWsClientOptions) {
    this.backoff = options.backoff ?? new Backoff();
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

  private connect(): void {
    const factory = this.options.webSocketFactory ?? ((url: string) => new WebSocket(url));
    const params = new URLSearchParams({ room: this.options.room, role: "display" });
    const ws = factory(`${this.options.url}/?${params.toString()}`);
    this.ws = ws;

    ws.onopen = () => this.backoff.reset();
    ws.onmessage = (event: MessageEvent) => this.handleMessage(event.data);
    ws.onclose = () => {
      this.ws = null;
      if (this.stopped) return;
      this.reconnectTimer = setTimeout(() => this.connect(), this.backoff.next());
    };
    ws.onerror = () => {
      // onclose follows and owns reconnection.
    };
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const message = parsed as { t?: unknown; cursors?: unknown; clientId?: unknown };
    switch (message.t) {
      case "cursor_snapshot":
        if (Array.isArray(message.cursors)) {
          this.options.onSnapshot(message.cursors.filter(isRelayCursor));
        }
        return;
      case "cursor_update":
        if (isRelayCursor(message)) {
          this.options.onUpdate({ clientId: message.clientId, color: message.color, x: message.x, y: message.y });
        }
        return;
      case "cursor_batch":
        if (Array.isArray(message.cursors)) {
          for (const cursor of message.cursors.filter(isRelayCursor)) {
            this.options.onUpdate(cursor);
          }
        }
        return;
      case "cursor_leave":
        if (typeof message.clientId === "string") this.options.onLeave(message.clientId);
        return;
      default:
        // cursor_join carries no position yet; the following cursor_update
        // populates it, so it needs no handling of its own.
        return;
    }
  }
}
