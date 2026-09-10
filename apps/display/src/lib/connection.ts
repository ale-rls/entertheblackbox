import {
  DISPLAY_REPLACED_CLOSE_CODE,
  encodeMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  type DisplayToServerMessage,
  type ServerToClientMessage,
} from "@smartphonecracy/protocol";
import { Backoff } from "./backoff.js";
import { ServerClock } from "./serverClock.js";

/**
 * Display WebSocket connection (plan §9): authenticates with
 * display_join, reconnects with exponential backoff, keeps corrected
 * server time via ping/pong, and requests a fresh snapshot after every
 * reconnect (the server sends one on join; consumers just re-render).
 *
 * The WebSocket constructor is injectable for tests.
 */

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

export type DisplayConnectionOptions = {
  url: string;
  clientVersion: string;
  installationId: string;
  roomId: string;
  displayToken: string;
  onMessage: (message: ServerToClientMessage) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  webSocketFactory?: (url: string) => WebSocket;
  backoff?: Backoff;
  pingIntervalMs?: number;
  now?: () => number;
};

export class DisplayConnection {
  readonly clock = new ServerClock();

  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "closed";
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPingSentAt = 0;
  private readonly backoff: Backoff;
  private readonly pingIntervalMs: number;
  private readonly now: () => number;

  constructor(private readonly options: DisplayConnectionOptions) {
    this.backoff = options.backoff ?? new Backoff();
    this.pingIntervalMs = options.pingIntervalMs ?? 10_000;
    this.now = options.now ?? (() => Date.now());
  }

  get currentStatus(): ConnectionStatus {
    return this.status;
  }

  start(): void {
    this.stopped = false;
    this.connect("connecting");
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.setStatus("closed");
  }

  send(message: DisplayToServerMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeMessage(message));
    }
  }

  private connect(initialStatus: ConnectionStatus): void {
    this.setStatus(initialStatus);
    const factory =
      this.options.webSocketFactory ?? ((url: string) => new WebSocket(url));
    const ws = factory(this.options.url);
    this.ws = ws;

    ws.onopen = () => {
      this.backoff.reset();
      this.setStatus("open");
      this.send({
        t: "display_join",
        v: PROTOCOL_VERSION,
        clientVersion: this.options.clientVersion,
        installationId: this.options.installationId,
        roomId: this.options.roomId,
        displayToken: this.options.displayToken,
      });
      this.sendPing();
      this.pingTimer = setInterval(() => this.sendPing(), this.pingIntervalMs);
    };

    ws.onmessage = (event: MessageEvent) => {
      const parsed = parseServerMessage(event.data);
      if (!parsed.ok) {
        // Never crash the kiosk on a bad frame; surface it for diagnostics.
        console.warn("display: dropped invalid server message:", parsed.reason);
        return;
      }
      if (parsed.message.t === "pong") {
        this.clock.addSample(
          parsed.message.echoClientTime,
          this.now(),
          parsed.message.serverTime,
        );
      }
      this.options.onMessage(parsed.message);
    };

    ws.onclose = (event) => {
      this.clearTimers();
      this.ws = null;
      if (this.stopped) return;
      if (event.code === DISPLAY_REPLACED_CLOSE_CODE) {
        // A newer display connection took over this slot -- reconnecting
        // would just replace it right back. If two displays are both
        // open, auto-reconnecting here turns a one-time handoff into an
        // infinite kick-each-other-out loop, which is indistinguishable
        // from a broken connection to whoever is watching either screen.
        this.stopped = true;
        this.setStatus("closed");
        return;
      }
      this.setStatus("reconnecting");
      this.reconnectTimer = setTimeout(
        () => this.connect("reconnecting"),
        this.backoff.next(),
      );
    };

    ws.onerror = () => {
      // onclose follows and owns the reconnect; nothing to do here.
    };
  }

  private sendPing(): void {
    this.lastPingSentAt = this.now();
    // Displays reuse the phone ping/pong pair for time correction.
    this.ws?.send(
      encodeMessage({ t: "ping", v: PROTOCOL_VERSION, clientTime: this.lastPingSentAt }),
    );
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatusChange?.(status);
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
  }
}
