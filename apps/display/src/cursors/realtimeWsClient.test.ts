import { afterEach, describe, expect, it, vi } from "vitest";
import { Backoff } from "../lib/backoff.js";
import { RealtimeWsClient } from "./realtimeWsClient.js";

class FakeWebSocket {
  static readonly OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {}

  close(): void {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }

  serverMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function harness(backoff?: Backoff) {
  const sockets: FakeWebSocket[] = [];
  const snapshots: unknown[] = [];
  const updates: unknown[] = [];
  const leaves: string[] = [];
  const client = new RealtimeWsClient({
    url: "ws://relay.test",
    room: "inst-1:room-1",
    onSnapshot: (cursors) => snapshots.push(cursors),
    onUpdate: (cursor) => updates.push(cursor),
    onLeave: (clientId) => leaves.push(clientId),
    ...(backoff === undefined ? {} : { backoff }),
    webSocketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  return { client, sockets, snapshots, updates, leaves };
}

describe("RealtimeWsClient", () => {
  afterEach(() => vi.useRealTimers());

  it("connects with the room as a query param", () => {
    const { client, sockets } = harness();
    client.start();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toBe("ws://relay.test/?room=inst-1%3Aroom-1&role=display");
    client.stop();
  });

  it("dispatches cursor_snapshot, cursor_update, and cursor_leave to their callbacks", () => {
    const { client, sockets, snapshots, updates, leaves } = harness();
    client.start();
    sockets[0]!.serverMessage({
      t: "cursor_snapshot",
      cursors: [{ clientId: "a", color: "#fff", x: 0.1, y: 0.2 }],
    });
    sockets[0]!.serverMessage({ t: "cursor_update", clientId: "b", color: "#000", x: 0.5, y: 0.5 });
    sockets[0]!.serverMessage({ t: "cursor_leave", clientId: "a" });
    sockets[0]!.serverMessage({ t: "cursor_join", clientId: "c", color: "#111" });

    expect(snapshots).toEqual([[{ clientId: "a", color: "#fff", x: 0.1, y: 0.2 }]]);
    expect(updates).toEqual([{ clientId: "b", color: "#000", x: 0.5, y: 0.5 }]);
    expect(leaves).toEqual(["a"]);
    client.stop();
  });

  it("dispatches every cursor in a cursor_batch to onUpdate", () => {
    const { client, sockets, updates } = harness();
    client.start();
    sockets[0]!.serverMessage({
      t: "cursor_batch",
      cursors: [
        { clientId: "a", color: "#fff", x: 0.1, y: 0.2 },
        { clientId: "b", color: "#000", x: 0.5, y: 0.5 },
      ],
    });

    expect(updates).toEqual([
      { clientId: "a", color: "#fff", x: 0.1, y: 0.2 },
      { clientId: "b", color: "#000", x: 0.5, y: 0.5 },
    ]);
    client.stop();
  });

  it("drops malformed messages without throwing", () => {
    const { client, sockets, updates } = harness();
    client.start();
    expect(() => {
      sockets[0]!.serverMessage("not json{{{");
      sockets[0]!.serverMessage({ t: "cursor_update", clientId: "a", color: "#fff", x: "nope", y: 0.5 });
      sockets[0]!.serverMessage(null);
      sockets[0]!.serverMessage(42);
    }).not.toThrow();
    expect(updates).toEqual([]);
    client.stop();
  });

  it("reconnects on close with backoff, and stop() prevents further reconnects", () => {
    vi.useFakeTimers();
    const { client, sockets } = harness(new Backoff({ rng: () => 0.5 }));

    client.start();
    expect(sockets).toHaveLength(1);
    sockets[0]!.close();
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);

    client.stop();
    sockets[1]!.close();
    vi.advanceTimersByTime(20_000);
    expect(sockets).toHaveLength(2);
  });
});
