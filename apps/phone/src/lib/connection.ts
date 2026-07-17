import {
  encodeMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  SHOW_ENDED_CLOSE_CODE,
  type PhoneToServerMessage,
  type ServerToClientMessage,
} from "@smartphonecracy/protocol";
import { clearLease, loadLease, storeLease } from "./lease.js";

/**
 * Phone WebSocket connection: joins with the QR grant + any stored
 * lease, persists the lease from identity, reconnects with exponential
 * backoff, pings every ~10 s (plan §7), and hands every valid server
 * message to the consumer. WebSocket constructor injectable for tests.
 */

export type PhoneConnectionOptions = {
  url: string;
  clientVersion: string;
  installationId: string;
  roomId: string;
  joinGrant: string;
  onMessage: (message: ServerToClientMessage) => void;
  onSocketOpen?: () => void;
  onSocketLost?: () => void;
  onSessionEnded?: () => void;
  webSocketFactory?: (url: string) => WebSocket;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  pingIntervalMs?: number;
  now?: () => number;
  rng?: () => number;
};

export class PhoneConnection {
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pingIntervalMs: number;
  private readonly now: () => number;
  private readonly rng: () => number;

  constructor(private readonly options: PhoneConnectionOptions) {
    this.pingIntervalMs = options.pingIntervalMs ?? 10_000;
    this.now = options.now ?? (() => Date.now());
    this.rng = options.rng ?? Math.random;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
  }

  send(message: PhoneToServerMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeMessage(message));
    }
  }

  private connect(): void {
    const factory =
      this.options.webSocketFactory ?? ((url: string) => new WebSocket(url));
    const ws = factory(this.options.url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.options.onSocketOpen?.();
      const lease = loadLease(this.options.installationId, this.options.storage);
      this.send({
        t: "join",
        v: PROTOCOL_VERSION,
        clientVersion: this.options.clientVersion,
        installationId: this.options.installationId,
        roomId: this.options.roomId,
        joinGrant: this.options.joinGrant,
        ...(lease === null ? {} : { participantLease: lease }),
      });
      this.send({ t: "ping", v: PROTOCOL_VERSION, clientTime: this.now() });
      this.pingTimer = setInterval(
        () => this.send({ t: "ping", v: PROTOCOL_VERSION, clientTime: this.now() }),
        this.pingIntervalMs,
      );
    };

    ws.onmessage = (event: MessageEvent) => {
      const parsed = parseServerMessage(event.data);
      if (!parsed.ok) {
        console.warn("phone: dropped invalid server message:", parsed.reason);
        return;
      }
      if (parsed.message.t === "identity") {
        storeLease(
          this.options.installationId,
          parsed.message.participantLease,
          this.options.storage,
        );
      }
      this.options.onMessage(parsed.message);
    };

    ws.onclose = (event) => {
      this.clearTimers();
      this.ws = null;
      if (this.stopped) return;
      if (event.code === SHOW_ENDED_CLOSE_CODE) {
        this.stopped = true;
        clearLease(this.options.installationId, this.options.storage);
        this.options.onSessionEnded?.();
        return;
      }
      this.options.onSocketLost?.();
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

  private clearTimers(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
  }
}
