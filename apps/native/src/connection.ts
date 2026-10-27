import { ServerClock } from '@entertheblackbox/shared';
import { encodeMessage, parseServerMessage, PROTOCOL_VERSION, SHOW_ENDED_CLOSE_CODE,
  type PhoneToServerMessage, type ServerToClientMessage } from '@entertheblackbox/protocol';
export type Socket = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'onopen' | 'onmessage' | 'onclose' | 'onerror'>;
type Options = {
  origin: string; installationId: string; roomId: string; name: string; clientVersion: string;
  lease: string | null; saveLease: (lease: string | null) => void;
  message: (message: ServerToClientMessage) => void; status: (status: string) => void;
  ended: () => void; factory?: (url: string) => Socket;
};
export class NativeConnection {
  readonly clock = new ServerClock();
  private socket: Socket | null = null;
  private stopped = true;
  private attempt = 0;
  private lastReceived = 0;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  constructor(private options: Options) {}
  start() { this.stopped = false; this.connect(); }
  stop() {
    this.stopped = true; clearTimeout(this.retry); clearInterval(this.heartbeat);
    const socket = this.socket; this.socket = null; socket?.close();
  }
  resume() {
    if (this.stopped) return;
    // A foreground return discards potentially half-open background sockets.
    clearTimeout(this.retry); clearInterval(this.heartbeat);
    const old = this.socket; this.socket = null; old?.close();
    this.connect();
  }
  send(message: PhoneToServerMessage) {
    if (this.socket?.readyState === 1) this.socket.send(encodeMessage(message));
  }
  private connect() {
    if (this.stopped) return;
    this.options.status('Connecting');
    const socket = (this.options.factory ?? (url => new WebSocket(url)))(`${this.options.origin.replace(/^http/, 'ws')}/ws`);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket || this.stopped) return;
      this.lastReceived = Date.now();
      this.options.status('Joining');
      this.send({ t: 'join', v: PROTOCOL_VERSION, name: this.options.name,
        installationId: this.options.installationId, roomId: this.options.roomId,
        clientVersion: this.options.clientVersion, ...(this.options.lease ? { participantLease: this.options.lease } : {}) });
      this.send({ t: 'ping', v: PROTOCOL_VERSION, clientTime: Date.now() });
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastReceived > 25000) { this.resume(); return; }
        this.send({ t: 'ping', v: PROTOCOL_VERSION, clientTime: Date.now() });
      }, 5000);
    };
    socket.onmessage = event => {
      if (this.socket !== socket || this.stopped) return;
      const parsed = parseServerMessage(event.data);
      if (!parsed.ok) return;
      this.lastReceived = Date.now();
      const message = parsed.message;
      if (message.t === 'pong') this.clock.addSample(message.echoClientTime, Date.now(), message.serverTime);
      if (message.t === 'identity') {
        this.attempt = 0; this.options.lease = message.participantLease;
        this.options.saveLease(message.participantLease); this.options.status('Connected');
      }
      if (message.t === 'snapshot' || message.t === 'phase') this.clock.observe(message.serverTime, Date.now());
      this.options.message(message);
      if (message.t === 'join_rejected') {
        // Rejection requires operator/user action; don't create an endless admission retry storm.
        this.stop(); this.options.status(`Join rejected: ${message.reason}`);
      }
    };
    socket.onclose = event => {
      if (this.socket !== socket || this.stopped) return;
      this.socket = null; clearInterval(this.heartbeat);
      if (event.code === SHOW_ENDED_CLOSE_CODE) {
        this.stop(); this.options.saveLease(null); this.options.ended(); return;
      }
      this.options.status('Disconnected — retrying');
      this.retry = setTimeout(() => this.connect(), Math.min(15000, 500 * 2 ** this.attempt++) + Math.random() * 300);
    };
    socket.onerror = () => { /* onclose owns reconnect */ };
  }
}
