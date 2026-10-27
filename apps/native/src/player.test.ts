import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ServerClock } from '@entertheblackbox/shared';
const mock = vi.hoisted(() => ({ audio: { isLoaded: true, duration: 20, currentTime: 0, playing: false,
  replace: vi.fn(), pause: vi.fn(), play: vi.fn(), seekTo: vi.fn(), setActiveForLockScreen: vi.fn(), remove: vi.fn() } }));
vi.mock('expo-audio', () => ({ createAudioPlayer: () => mock.audio, setAudioModeAsync: vi.fn() }));
vi.mock('./content', () => ({ localAudio: () => ({ exists: true, uri: 'file://audio.mp3' }) }));
import { ShowPlayer } from './player';
const players: ShowPlayer[] = [];
const cue = { key: 'cue', src: 'voice.mp3', startedAt: 1000, endsAt: 11000, scenarioVersion: 'one' };
function setup() {
  const clock = new ServerClock(); clock.addSample(5000, 5000, 5000);
  const status = vi.fn();
  const p = new ShowPlayer({ format: 1, revision: 'a'.repeat(64), scenarioVersion: 'one', files: [{ src: 'voice.mp3', sha256: 'b'.repeat(64), bytes: 5 }] }, clock, status);
  players.push(p); return { p, status };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(5000); vi.clearAllMocks();
  mock.audio.currentTime = 0; mock.audio.playing = false;
  mock.audio.play.mockImplementation(() => { mock.audio.playing = true; });
  mock.audio.pause.mockImplementation(() => { mock.audio.playing = false; });
  mock.audio.seekTo.mockImplementation(async (seconds: number) => { mock.audio.currentTime = seconds; });
});
afterEach(() => { players.splice(0).forEach(p => p.dispose()); vi.useRealTimers(); });
it('seeks a late join instead of replaying the opening and stops at cue end', async () => {
  const { p } = setup(); p.setCue(cue); await vi.advanceTimersByTimeAsync(250);
  expect(mock.audio.seekTo).toHaveBeenCalledWith(4.25); expect(mock.audio.play).toHaveBeenCalledOnce();
  vi.setSystemTime(11000); await vi.advanceTimersByTimeAsync(250); expect(mock.audio.playing).toBe(false);
});
it('fails closed on a different show version or missing source', async () => {
  const { p, status } = setup(); p.setCue({ ...cue, scenarioVersion: 'other' }); await vi.advanceTimersByTimeAsync(250);
  expect(status).toHaveBeenCalledWith(expect.stringContaining('Show changed')); expect(mock.audio.play).not.toHaveBeenCalled();
  p.setCue({ ...cue, src: 'missing.mp3' }); expect(status).toHaveBeenCalledWith(expect.stringContaining('Missing downloaded'));
});
it('does not start an old cue when a pending seek finishes after a silent transition', async () => {
  let finish!: () => void; mock.audio.seekTo.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const { p } = setup(); p.setCue(cue); await vi.advanceTimersByTimeAsync(250);
  p.setCue(null); finish(); await Promise.resolve(); expect(mock.audio.play).not.toHaveBeenCalled();
});
it('honors a native pause until explicitly resumed at the current show position', async () => {
  const { p } = setup(); p.setCue(cue); await vi.advanceTimersByTimeAsync(250);
  mock.audio.playing = false; await vi.advanceTimersByTimeAsync(500);
  expect(mock.audio.play).toHaveBeenCalledOnce();
  p.setEnabled(true); await vi.advanceTimersByTimeAsync(250); expect(mock.audio.play).toHaveBeenCalledTimes(2);
});
