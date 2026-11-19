import { afterEach, expect, it, vi } from 'vitest';
import { PhoneConnection } from './connection';

class Socket {
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror = null;
  send = vi.fn();
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('honors server retry time, retries automatically, and cancels pending recovery on stop', () => {
  vi.useFakeTimers(); vi.setSystemTime(0); vi.stubGlobal('WebSocket', Socket);
  const sockets: Socket[] = [];
  const onMessage = vi.fn();
  const connection = new PhoneConnection({ url: 'ws://test', installationId: 'i', roomId: 'r', name: 'A', clientVersion: 'test', onMessage, rng: () => 0.5,
    storage: { getItem: () => 'saved-lease', setItem: vi.fn(), removeItem: vi.fn() },
    webSocketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket; } });
  connection.start(); sockets[0]!.onopen!();
  sockets[0]!.onmessage!({ data: JSON.stringify({ t: 'join_rejected', v: 2, reason: 'rate_limited', retryAfterMs: 2000 }) });
  expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ reason: 'rate_limited' }));
  vi.advanceTimersByTime(1999); expect(sockets).toHaveLength(1);
  vi.advanceTimersByTime(1); expect(sockets).toHaveLength(2);
  sockets[1]!.onopen!();
  expect(JSON.parse(sockets[1]!.send.mock.calls[0]![0])).toMatchObject({ t: 'join', participantLease: 'saved-lease' });
  sockets[1]!.onmessage!({ data: JSON.stringify({ t: 'join_rejected', v: 2, reason: 'rate_limited', retryAfterMs: 2000 }) });
  connection.stop(); vi.advanceTimersByTime(60_000); expect(sockets).toHaveLength(2);
});

function silentSetup() {
  vi.useFakeTimers(); vi.setSystemTime(0); vi.stubGlobal('WebSocket', Socket);
  const sockets: Socket[] = [];
  const lost = vi.fn();
  const connection = new PhoneConnection({ url: 'ws://test', installationId: 'i', roomId: 'r', name: 'A', clientVersion: 'test', onMessage: vi.fn(), onSocketLost: lost, rng: () => 0.5,
    storage: { getItem: () => 'saved-lease', setItem: vi.fn(), removeItem: vi.fn() },
    webSocketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket; } });
  connection.start(); sockets[0]!.onopen!();
  const pong = (socket: Socket) => socket.onmessage!({ data: JSON.stringify({ t: 'pong', v: 2, echoClientTime: Date.now(), serverTime: Date.now() }) });
  return { connection, sockets, lost, pong };
}

it('replaces a socket that stays open but stops answering, and rejoins with its lease', () => {
  const { connection, sockets, lost } = silentSetup();
  vi.advanceTimersByTime(20_000); expect(sockets).toHaveLength(1);
  vi.advanceTimersByTime(10_000); expect(sockets).toHaveLength(2);
  expect(lost).toHaveBeenCalledTimes(1);
  // The old socket's late close must not start a second reconnect.
  sockets[0]!.close(); vi.advanceTimersByTime(1_000); expect(sockets).toHaveLength(2);
  sockets[1]!.onopen!();
  expect(JSON.parse(sockets[1]!.send.mock.calls[0]![0])).toMatchObject({ t: 'join', participantLease: 'saved-lease' });
  connection.stop();
});

it('keeps a socket that answers its pings', () => {
  const { connection, sockets, pong } = silentSetup();
  for (let i = 0; i < 30; i += 1) { vi.advanceTimersByTime(10_000); pong(sockets[0]!); }
  expect(sockets).toHaveLength(1);
  connection.stop();
});

it('on resume, pings a fresh socket but replaces a quiet one at once', () => {
  const { connection, sockets, pong } = silentSetup();
  vi.advanceTimersByTime(5_000); pong(sockets[0]!);
  connection.resume(); expect(sockets).toHaveLength(1);
  expect(sockets[0]!.send.mock.calls.at(-1)![0]).toContain('"t":"ping"');
  vi.advanceTimersByTime(14_000);
  connection.resume(); expect(sockets).toHaveLength(2);
  connection.stop();
});

it('on resume, waits out a server rate limit', () => {
  const { connection, sockets } = silentSetup();
  sockets[0]!.onmessage!({ data: JSON.stringify({ t: 'join_rejected', v: 2, reason: 'rate_limited', retryAfterMs: 5_000 }) });
  connection.resume(); expect(sockets).toHaveLength(1);
  vi.advanceTimersByTime(5_000); expect(sockets).toHaveLength(2);
  connection.stop();
});
