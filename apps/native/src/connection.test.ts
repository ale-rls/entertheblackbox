import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeConnection, type Socket } from './connection';
class FakeSocket {
  readyState = 1; send = vi.fn(); close = vi.fn();
  onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null; onerror = null;
  receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
const clients: NativeConnection[] = [];
afterEach(() => { clients.forEach(c => c.stop()); clients.length = 0; vi.useRealTimers(); });
function fixture() {
  const sockets: FakeSocket[] = []; const message = vi.fn(); const saveLease = vi.fn(); const ended = vi.fn();
  const c = new NativeConnection({ origin: 'https://venue.test', installationId: 'i', roomId: 'r', name: 'Test',
    clientVersion: 'test', lease: 'stored-lease', saveLease, message, status: vi.fn(), ended,
    factory: () => { const ws = new FakeSocket(); sockets.push(ws); return ws as unknown as Socket; } });
  clients.push(c); c.start(); sockets[0]!.onopen?.(); return { c, sockets, message, saveLease, ended };
}
describe('native connection lifecycle', () => {
  it('joins with stored identity and ignores events from replaced sockets', () => {
    const { c, sockets, message } = fixture();
    expect(JSON.parse(sockets[0]!.send.mock.calls[0]![0])).toMatchObject({ t: 'join', participantLease: 'stored-lease' });
    c.resume(); sockets[1]!.onopen?.();
    sockets[0]!.receive({ t: 'pong', v: 2, echoClientTime: 1, serverTime: 2 });
    expect(message).not.toHaveBeenCalled();
  });
  it('reconnects after loss but never after explicit stop', () => {
    vi.useFakeTimers(); const { c, sockets } = fixture();
    sockets[0]!.onclose?.({ code: 1006 }); vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2); c.stop(); vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(2);
  });
  it('clears identity and stops reconnecting when the show ends', () => {
    vi.useFakeTimers(); const { sockets, saveLease, ended } = fixture();
    sockets[0]!.onclose?.({ code: 4003 }); vi.advanceTimersByTime(60000);
    expect(saveLease).toHaveBeenCalledWith(null); expect(ended).toHaveBeenCalled(); expect(sockets).toHaveLength(1);
  });
  it('replaces a half-open socket when heartbeat responses cease', () => {
    vi.useFakeTimers(); const { sockets } = fixture(); vi.advanceTimersByTime(30000);
    expect(sockets).toHaveLength(2); expect(sockets[0]!.close).toHaveBeenCalled();
  });
});
