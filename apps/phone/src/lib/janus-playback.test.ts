// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JanusPlayback } from './janus-playback';
const feed = { server: 'https://janus.test/janus', mountpoint: 101, pin: 'secret', iceServers: [] };
const peers: Peer[] = [];
class Peer {
  connectionState = 'new';
  onconnectionstatechange?: () => void;
  ontrack?: (value: { track: object }) => void;
  close = vi.fn(() => { this.connectionState = 'closed'; });
  constructor() { peers.push(this); }
}
let audio: HTMLAudioElement;
let playback: JanusPlayback;
let refresh: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
let time = 0;
beforeEach(() => {
  vi.useFakeTimers(); peers.length = 0;
  vi.stubGlobal('RTCPeerConnection', Peer);
  vi.stubGlobal('MediaStream', class { constructor(_tracks: object[]) {} });
  // Leave long polling pending; the test controls media/lifecycle events.
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.body) return await new Promise<Response>(() => {});
    const body = JSON.parse(String(init.body));
    return new Response(JSON.stringify(body.janus === 'create' || body.janus === 'attach' ? { data: { id: 1 } } : { janus: 'ack' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  audio = document.createElement('audio');
  time = 0;
  Object.defineProperty(audio, 'currentTime', { get: () => time });
  Object.defineProperty(audio, 'paused', { configurable: true, value: false });
  vi.spyOn(audio, 'play').mockResolvedValue();
  vi.spyOn(audio, 'pause').mockImplementation(() => {});
  refresh = vi.fn(async () => feed);
  playback = new JanusPlayback(audio, JSON.stringify(feed), vi.fn(), refresh);
});
afterEach(() => { playback.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

describe('Janus phone lifecycle', () => {
  it('reuses a healthy peer and preserves a deliberate pause across online/foreground events', async () => {
    playback.play(); await settle();
    peers[0]!.connectionState = 'connected';
    time = 1; audio.dispatchEvent(new Event('timeupdate'));
    expect(playback.state).toBe('playing');
    playback.play(); playback.foreground(); await settle();
    expect(peers).toHaveLength(1);
    playback.pause(); playback.online(); playback.foreground();
    await vi.advanceTimersByTimeAsync(30000);
    expect(playback.state).toBe('paused');
    expect(peers).toHaveLength(1);
    expect(peers[0]!.close).toHaveBeenCalled();
  });
  it('refreshes private credentials on recovery and cannot resurrect playback after disposal', async () => {
    playback.play(); await settle();
    let release!: (value: typeof feed) => void;
    refresh.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    peers[0]!.connectionState = 'failed'; peers[0]!.onconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(500);
    expect(refresh).toHaveBeenCalledTimes(1);
    playback.dispose(); release(feed); await settle();
    expect(peers).toHaveLength(1);
  });
  it('retains playback intent through synchronized-scene suspension but respects pause', async () => {
    playback.play(); await settle();
    playback.setSuspended(true);
    expect(peers[0]!.close).toHaveBeenCalled();
    playback.setSuspended(false); await settle();
    expect(peers).toHaveLength(2);
    playback.setSuspended(true); playback.pause(); playback.setSuspended(false); await settle();
    expect(peers).toHaveLength(2);
  });
  it('surfaces autoplay blocking with a resume gesture', async () => {
    vi.mocked(audio.play).mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    playback.play(); await settle();
    peers[0]!.ontrack?.({ track: {} }); await settle();
    expect(playback.state).toBe('blocked');
    playback.play(); await settle();
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
});
