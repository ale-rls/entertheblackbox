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
  const sockets: FakeSocket[] = []; const message = vi.fn(); const saveLease = vi.fn(); const ended = vi.fn(); const status = vi.fn();
  const c = new NativeConnection({ origin: 'https://venue.test', installationId: 'i', roomId: 'r', name: 'Test',
    clientVersion: 'test', lease: 'stored-lease', saveLease, message, status, ended,
    factory: () => { const ws = new FakeSocket(); sockets.push(ws); return ws as unknown as Socket; } });
  clients.push(c); c.start(); sockets[0]!.onopen?.(); return { c, sockets, message, saveLease, ended, status };
}
describe('native connection lifecycle', () => {
  it('reports whether a message actually left the tablet', () => {
    const { c, sockets } = fixture();
    expect(c.send({ t: 'button_vote', v: 2, sessionId: 's', phaseEpoch: 1, outcome: 'A' })).toBe(true);
    sockets[0]!.readyState = 3;
    expect(c.send({ t: 'button_vote', v: 2, sessionId: 's', phaseEpoch: 1, outcome: 'A' })).toBe(false);
    expect(sockets[0]!.send).toHaveBeenCalledTimes(3);
  });
  it('joins with stored identity and ignores events from replaced sockets', () => {
    const { c, sockets, message } = fixture();
    expect(JSON.parse(sockets[0]!.send.mock.calls[0]![0])).toMatchObject({ t: 'join', participantLease: 'stored-lease' });
    c.resume(); sockets[1]!.onopen?.();
    sockets[0]!.receive({ t: 'pong', v: 2, echoClientTime: 1, serverTime: 2 });
    expect(message).not.toHaveBeenCalled();
  });
  it('accepts a restarted server’s wall welcome and drops older frames on the same socket', () => {
    vi.useFakeTimers();
    const { sockets, message } = fixture();
    const welcome = { t: 'wall', v: 2, seq: 0, clip: null, startAt: null, loop: true };
    const playing = { ...welcome, seq: 9, startAt: 100,
      clip: { id: 'intro', slot: 'A1', url: '/media/intro.mp4', bytes: 10, sha256: 'a'.repeat(64) } };
    sockets[0]!.receive(playing);
    sockets[0]!.onclose?.({ code: 1006 });
    vi.advanceTimersByTime(1000);
    sockets[1]!.onopen?.();
    sockets[1]!.receive(welcome);
    sockets[0]!.receive(playing);
    const loaded = { ...playing, seq: 2, startAt: null };
    sockets[1]!.receive(loaded);
    sockets[1]!.receive({ ...welcome, seq: 1 });
    expect(message.mock.calls).toEqual([[playing], [welcome], [loaded]]);
  });
  it('reconnects after loss but never after explicit stop', () => {
    vi.useFakeTimers(); const { c, sockets } = fixture();
    sockets[0]!.onclose?.({ code: 1006 }); vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2); c.stop(); vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(2);
  });
  it('waits for the server retry delay even when foregrounded, then joins with the stored lease', () => {
    vi.useFakeTimers();
    const { c, sockets, message, saveLease, status } = fixture();
    const retry = { t: 'join_rejected', v: 2, reason: 'rate_limited', retryAfterMs: 4_000 };
    sockets[0]!.receive(retry);
    expect(status).toHaveBeenLastCalledWith('Rate limited — retrying');
    expect(message).not.toHaveBeenCalled();
    expect(sockets[0]!.close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    c.resume();
    vi.advanceTimersByTime(2_999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1]!.onopen?.();
    expect(JSON.parse(sockets[1]!.send.mock.calls[0]![0])).toMatchObject({ t: 'join', participantLease: 'stored-lease' });
    const identity = {
      t: 'identity', v: 2, clientId: 'visitor', color: '#ffffff', sessionId: 'show',
      participantLease: 'renewed-lease', leaseExpiresAt: Date.now() + 10_000,
    };
    sockets[1]!.receive(identity);
    expect(status).toHaveBeenLastCalledWith('Connected');
    expect(message).toHaveBeenCalledWith(identity);
    expect(saveLease).toHaveBeenCalledWith('renewed-lease');
  });
  it('cancels the rate-limit retry when the participant leaves', () => {
    vi.useFakeTimers();
    const { c, sockets } = fixture();
    sockets[0]!.receive({ t: 'join_rejected', v: 2, reason: 'rate_limited', retryAfterMs: 4_000 });
    c.stop();
    c.resume();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });
  it('uses a one-minute fallback when the rate limit has no retry delay', () => {
    vi.useFakeTimers();
    const { sockets, message } = fixture();
    sockets[0]!.receive({ t: 'join_rejected', v: 2, reason: 'rate_limited' });
    expect(message).not.toHaveBeenCalled();
    vi.advanceTimersByTime(59_999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
  });
  it('stops on a permanent rejection', () => {
    vi.useFakeTimers();
    const { c, sockets, message, status } = fixture();
    const rejection = { t: 'join_rejected', v: 2, reason: 'update_required' };
    sockets[0]!.receive(rejection);
    expect(message).toHaveBeenCalledWith(rejection);
    expect(status).toHaveBeenLastCalledWith('Join rejected: update_required');
    c.resume();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
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
