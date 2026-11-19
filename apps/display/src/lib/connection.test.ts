import { afterEach, describe, expect, it, vi } from "vitest";
import { DISPLAY_REPLACED_CLOSE_CODE } from "@entertheblackbox/protocol";
import { Backoff } from "./backoff.js";
import { DisplayConnection, type ConnectionStatus } from "./connection.js";

class FakeWebSocket {
  static readonly OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: unknown[] = [];

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.serverClose();
  }

  /** Simulate the server closing this socket, optionally with a code. */
  serverClose(code = 1006, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

function harness() {
  const sockets: FakeWebSocket[] = [];
  const statuses: ConnectionStatus[] = [];
  const connection = new DisplayConnection({
    url: "ws://server.test/ws",
    clientVersion: "test",
    installationId: "inst-1",
    roomId: "room-1",
    displayToken: "token",
    onMessage: () => {},
    onStatusChange: (status) => statuses.push(status),
    backoff: new Backoff({ baseMs: 1, capMs: 1, jitter: 0 }),
    webSocketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  return { connection, sockets, statuses };
}

describe("DisplayConnection close handling", () => {
  afterEach(() => vi.useRealTimers());

  it("reconnects after an ordinary close", () => {
    vi.useFakeTimers();
    const { connection, sockets, statuses } = harness();
    connection.start();
    sockets[0]!.onopen?.({} as Event);

    sockets[0]!.serverClose(1006, "abnormal");
    expect(statuses.at(-1)).toBe("reconnecting");

    vi.runOnlyPendingTimers();
    expect(sockets).toHaveLength(2);
    connection.stop();
  });

  it("does not reconnect after being replaced by a newer display connection", () => {
    vi.useFakeTimers();
    const { connection, sockets, statuses } = harness();
    connection.start();
    sockets[0]!.onopen?.({} as Event);

    sockets[0]!.serverClose(DISPLAY_REPLACED_CLOSE_CODE, "display replaced");
    expect(statuses.at(-1)).toBe("closed");

    vi.runAllTimers();
    // No second socket was ever created -- reconnecting here would just
    // replace the connection that replaced this one right back.
    expect(sockets).toHaveLength(1);
  });

  it("closes cleanly on stop() without the onclose handler also scheduling a reconnect", () => {
    vi.useFakeTimers();
    const { connection, sockets, statuses } = harness();
    connection.start();
    sockets[0]!.onopen?.({} as Event);
    statuses.length = 0;

    connection.stop();
    // stop() itself reports "closed"; the resulting onclose callback must
    // recognize `stopped` and not report anything a second time or
    // schedule a reconnect.
    expect(statuses).toEqual(["closed"]);

    vi.runAllTimers();
    expect(sockets).toHaveLength(1);
  });
});

describe("DisplayConnection watchdog", () => {
  afterEach(() => vi.useRealTimers());
  const pong = (socket: FakeWebSocket) => socket.onmessage?.({
    data: JSON.stringify({ t: "pong", v: 2, echoClientTime: Date.now(), serverTime: Date.now() }),
  } as MessageEvent);

  it("replaces a socket that stays open but stops answering, and joins again", () => {
    vi.useFakeTimers();
    const { connection, sockets, statuses } = harness();
    connection.start();
    sockets[0]!.onopen?.({} as Event);
    vi.advanceTimersByTime(20_000);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(2);
    expect(statuses.at(-1)).toBe("reconnecting");
    // The old socket's late close must not start a second reconnect.
    sockets[0]!.serverClose();
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    sockets[1]!.onopen?.({} as Event);
    expect(sockets[1]!.sent[0]).toMatchObject({ t: "display_join", displayToken: "token" });
    connection.stop();
  });

  it("keeps a socket that answers its pings", () => {
    vi.useFakeTimers();
    const { connection, sockets } = harness();
    connection.start();
    sockets[0]!.onopen?.({} as Event);
    for (let i = 0; i < 30; i += 1) {
      vi.advanceTimersByTime(10_000);
      pong(sockets[0]!);
    }
    expect(sockets).toHaveLength(1);
    connection.stop();
  });
});
