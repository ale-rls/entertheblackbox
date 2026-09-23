import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi } from 'vitest';
import { AudioDelivery } from './audio-delivery';
import type { Phase } from '@entertheblackbox/scenario';
const person = { clientId: 'one', name: 'One' };
const phase = (src: string): Phase => ({ kind: 'video', id: src, src: 'picture.mp4', phoneAudioSrc: src, expectedDurationMs: 10000, next: 'idle' });
async function fixture() {
  const mediaDir = await mkdtemp(join(tmpdir(), 'janus-parity-'));
  await Promise.all(['a.mp3', 'b.mp3', 'music.mp3'].map(src => writeFile(join(mediaDir, src), src)));
  const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify(
    String(url).endsWith('/listen') ? { mountpoint: 101, pin: 'private-pin' } : {})));
  const config = { mediaDir, audio: { url: 'http://icecast', token: 'ice-secret', publicUrl: 'https://icecast' },
    janusAudio: { url: 'http://janus-bridge', token: 'janus-secret', publicUrl: 'https://janus', iceServers: [] } };
  return { request, audio: new AudioDelivery(config, vi.fn(), vi.fn(), request as typeof fetch) };
}

describe('parallel audio delivery', () => {
  it('routes private registration, group cues, music and soundcheck to the chosen backend', async () => {
    const { request, audio } = await fixture();
    audio.transition(phase('a.mp3'), () => null, Date.now() - 2000);
    expect(await audio.register(person, 'janus')).toEqual({ janus: { server: 'https://janus/janus', mountpoint: 101, pin: 'private-pin', iceServers: [] } });
    await audio.register({ clientId: 'two', name: 'Two' }, 'icecast');
    request.mockClear();
    audio.transitionParticipants(['one'], phase('b.mp3'), Date.now() - 500);
    await audio.register(person, 'janus');
    const plays = request.mock.calls.filter(([url]) => String(url).endsWith('/play'));
    expect(plays).toHaveLength(1);
    expect(String(plays[0]![0])).toBe('http://janus-bridge/players/one/play');
    expect(JSON.parse(String(plays[0]![1]?.body)).offsetSeconds).toBeGreaterThanOrEqual(.5);
    await audio.setMusic('music.mp3', .3);
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/music'))).toHaveLength(2);
    request.mockClear();
    await audio.soundcheck('a.mp3', 'one');
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/play')).map(([url]) => String(url))).toEqual(['http://janus-bridge/players/one/play']);
    await audio.stop();
  });

  it('revokes the old transport before reusing the participant on another route', async () => {
    const { request, audio } = await fixture();
    await audio.register(person, 'janus');
    request.mockClear();
    await audio.register(person, 'icecast');
    expect(request.mock.calls[0]).toMatchObject(['http://janus-bridge/players/one', { method: 'DELETE' }]);
    await audio.stop();
  });

  it('cannot create a new route registration after session end during old-route release', async () => {
    const { request, audio } = await fixture();
    await audio.register(person, 'icecast');
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    request.mockImplementation(async (url, init) => {
      if (init?.method === 'DELETE') await blocked;
      return new Response('{}');
    });
    const changing = audio.register(person, 'janus');
    const queued = audio.register(person, 'janus');
    const results = Promise.allSettled([changing, queued]);
    await vi.waitFor(() => expect(request.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
    audio.endSession();
    release();
    expect((await results).every(result => result.status === 'rejected')).toBe(true);
    expect(request.mock.calls.some(([url]) => String(url).startsWith('http://janus-bridge/players'))).toBe(false);
    await audio.stop();
  });
});
