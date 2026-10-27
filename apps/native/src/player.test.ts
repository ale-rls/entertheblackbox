import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ServerClock } from '@entertheblackbox/shared';
const mock = vi.hoisted(() => ({ audio: { isLoaded: true, duration: 20, currentTime: 0, playing: false,
  replace: vi.fn(), pause: vi.fn(), play: vi.fn(), seekTo: vi.fn(), setActiveForLockScreen: vi.fn(), remove: vi.fn() } }));
const music = vi.hoisted(() => ({ playing: false, loop: false, volume: 1, play: vi.fn(), pause: vi.fn(), remove: vi.fn(), setActiveForLockScreen: vi.fn(), addListener: vi.fn() }));
vi.mock('expo-audio', () => ({ createAudioPlayer: (source: unknown) => source ? music : mock.audio, setAudioModeAsync: vi.fn() }));
vi.mock('./content', () => ({ localAudio: () => ({ exists: true, uri: 'file://audio.mp3' }) }));
import { ShowPlayer } from './player';
const players: ShowPlayer[] = [];
const cue = { key: 'cue', src: 'voice.mp3', startedAt: 1000, endsAt: 11000, scenarioVersion: 'one' };
function setup(withMusic = false) {
  const clock = new ServerClock(); clock.addSample(5000, 5000, 5000);
  const status = vi.fn();
  const p = new ShowPlayer({ format: 1, revision: 'a'.repeat(64), scenarioVersion: 'one', ...(withMusic ? { backgroundMusic: { src: 'voice.mp3', volume: 0.2 } } : {}), files: [{ src: 'voice.mp3', sha256: 'b'.repeat(64), bytes: 5 }] }, clock, status);
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

it('keeps the native loop untouched across skips, narration end and silent phases, and releases it on leave', async () => {
  const removeListener = vi.fn(); music.addListener.mockReturnValue({ remove: removeListener });
  const { p } = setup(true);
  expect(music.play).not.toHaveBeenCalled();
  p.startMusic(); p.startMusic();
  expect(music.loop).toBe(true); expect(music.volume).toBe(0.2);
  expect(music.play).toHaveBeenCalledOnce();
  p.setCue(cue); await vi.advanceTimersByTimeAsync(250);
  p.setCue({ ...cue, key: 'skip', startedAt: 5000, endsAt: 6000 });
  await vi.advanceTimersByTimeAsync(1000); p.setCue(null);
  expect(music.pause).not.toHaveBeenCalled();
  expect(music.play).toHaveBeenCalledOnce();
  expect(mock.audio.setActiveForLockScreen).not.toHaveBeenCalled();
  p.dispose(); players.splice(players.indexOf(p), 1);
  expect(removeListener).toHaveBeenCalledOnce(); expect(music.remove).toHaveBeenCalledOnce();
});
it('pauses both layers and keeps new cues paused until explicit resume', async () => {
  music.addListener.mockReturnValue({ remove: vi.fn() });
  const { p } = setup(true); p.startMusic(); p.setCue(cue);
  await vi.advanceTimersByTimeAsync(250);
  p.setEnabled(false); expect(music.pause).toHaveBeenCalledOnce();
  p.setCue({ ...cue, key: 'next' }); p.startMusic();
  await vi.advanceTimersByTimeAsync(250);
  expect(mock.audio.play).toHaveBeenCalledOnce(); expect(music.play).toHaveBeenCalledOnce();
  p.setEnabled(true); await vi.advanceTimersByTimeAsync(250);
  expect(mock.audio.play).toHaveBeenCalledTimes(2); expect(music.play).toHaveBeenCalledTimes(2);
});
it('honors lock-screen music pause and resumes narration at current show time', async () => {
  music.addListener.mockReturnValue({ remove: vi.fn() });
  const { p } = setup(true); p.startMusic(); p.setCue(cue);
  const notify = music.addListener.mock.calls[0]![1];
  notify({ playing: true, isBuffering: false }); await vi.advanceTimersByTimeAsync(250);
  notify({ playing: false, isBuffering: false });
  await vi.advanceTimersByTimeAsync(1000); expect(mock.audio.playing).toBe(false);
  notify({ playing: true, isBuffering: false }); await vi.advanceTimersByTimeAsync(250);
  expect(mock.audio.playing).toBe(true); expect(mock.audio.seekTo).toHaveBeenLastCalledWith(5.5);
});
