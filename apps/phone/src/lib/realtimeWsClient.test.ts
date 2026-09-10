import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeCursorPublisher } from "./realtimeWsClient.js";

class FakeWebSocket {
  static readonly OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: string[] = [];

  constructor(readonly url: string) {}

  send(value: string): void {
    this.sent.push(value);
  }

  close(): void {
    this.readyState = 3;
  }

  serverClose(): void {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }
}

function harness() {
  const sockets: FakeWebSocket[] = [];
  const publisher = new RealtimeCursorPublisher({
    url: "ws://relay.test",
    room: "inst-1:room-1",
    clientId: "p1",
    color: "#abc",
    rng: () => 0.5,
    webSocketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  return { publisher, sockets };
}

describe("RealtimeCursorPublisher", () => {
  afterEach(() => vi.useRealTimers());

  it("connects with room, clientId, and color as query params", () => {
    const { publisher, sockets } = harness();
    publisher.start();
    expect(sockets).toHaveLength(1);
    const url = new URL(sockets[0]!.url);
    expect(url.searchParams.get("room")).toBe("inst-1:room-1");
    expect(url.searchParams.get("clientId")).toBe("p1");
    expect(url.searchParams.get("color")).toBe("#abc");
    publisher.stop();
  });

  it("sends cursor_update only while the socket is open", () => {
    const { publisher, sockets } = harness();
    publisher.send(0.5, 0.5); // no socket yet
    publisher.start();
    publisher.send(0.2, 0.8);
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ t: "cursor_update", x: 0.2, y: 0.8 });

    sockets[0]!.readyState = 3;
    publisher.send(0.1, 0.1);
    expect(sockets[0]!.sent).toHaveLength(1);
    publisher.stop();
  });

  it("reconnects on close with exponential backoff, and stop() prevents further reconnects", () => {
    vi.useFakeTimers();
    const { publisher, sockets } = harness();
    publisher.start();
    expect(sockets).toHaveLength(1);
    sockets[0]!.serverClose();
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);

    publisher.stop();
    sockets[1]!.serverClose();
    vi.advanceTimersByTime(20_000);
    expect(sockets).toHaveLength(2);
  });
});
