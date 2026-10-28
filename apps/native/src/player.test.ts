import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ServerClock } from '@entertheblackbox/shared';
const scheduler = vi.hoisted(() => ({
  listeners: [] as ((event: { paused: boolean; reason: string }) => void)[],
  timing: [] as { id: string; state: string; positionMs: number | null; targetMs: number | null; driftMs: number | null; error: string | null }[],
  configure: vi.fn(async () => {}), setClock: vi.fn(), setLayer: vi.fn(async (_id: string, _layer: unknown) => {}), clearLayer: vi.fn(async (_id: string) => {}),
  pause: vi.fn(async () => {}), resume: vi.fn(async () => {}), reset: vi.fn(async () => {}),
  getTiming: vi.fn(), removeListener: vi.fn(), addListener: vi.fn(),
}));
vi.mock('@entertheblackbox/expo-audio-scheduler', () => ({ default: scheduler }));
vi.mock('./content', () => ({ localAudio: (sha: string) => ({ exists: !sha.startsWith('0'), uri: `file://${sha.slice(0, 1)}.mp3` }) }));
import { ShowPlayer } from './player';
const players: ShowPlayer[] = [];
const cue = { key: 'cue', src: 'voice.mp3', startedAt: 1000, endsAt: 11000, scenarioVersion: 'one' };
const files = [{ src: 'voice.mp3', sha256: 'b'.repeat(64), bytes: 5 }, { src: 'bed.mp3', sha256: 'c'.repeat(64), bytes: 5 }];
function setup({ withMusic = false, calibrated = true } = {}) {
  const clock = new ServerClock(); if (calibrated) clock.addSample(5000, 5000, 5000);
  const status = vi.fn();
  const p = new ShowPlayer({ format: 1, revision: 'a'.repeat(64), scenarioVersion: 'one', ...(withMusic ? { backgroundMusic: { src: 'bed.mp3', volume: 0.2 } } : {}), files }, clock, status);
  players.push(p); return { p, status, clock };
}
const emit = (paused: boolean, reason: string) => scheduler.listeners.forEach(listener => listener({ paused, reason }));
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(5000); vi.clearAllMocks();
  scheduler.listeners = []; scheduler.timing = [];
  scheduler.getTiming.mockImplementation(() => scheduler.timing);
  scheduler.addListener.mockImplementation((_event: string, listener: (event: { paused: boolean; reason: string }) => void) => {
    scheduler.listeners.push(listener); return { remove: scheduler.removeListener };
  });
});
afterEach(() => { players.splice(0).forEach(p => p.dispose()); vi.useRealTimers(); });
it('hands the cue to the native scheduler on the server clock, so a late join starts mid-clip natively', () => {
  const { p } = setup(); p.setCue(cue);
  expect(scheduler.setClock).toHaveBeenCalledWith(5000);
  expect(scheduler.setLayer).toHaveBeenCalledWith('cue', { uri: 'file://b.mp3', startAt: 1000, endAt: 11000 });
});
it('waits for a measured clock before scheduling, then schedules from housekeeping', async () => {
  const { p, status, clock } = setup({ calibrated: false }); p.setCue(cue);
  expect(scheduler.setLayer).not.toHaveBeenCalled(); expect(status).toHaveBeenCalledWith('Waiting for clock');
  clock.addSample(5000, 5000, 5000); await vi.advanceTimersByTimeAsync(500);
  expect(scheduler.setLayer).toHaveBeenCalledOnce();
});
it('fails closed on a different show version or missing source', () => {
  const { p, status } = setup(); p.setCue({ ...cue, scenarioVersion: 'other' });
  expect(status).toHaveBeenCalledWith(expect.stringContaining('Show changed')); expect(scheduler.setLayer).not.toHaveBeenCalled();
  expect(scheduler.clearLayer).toHaveBeenCalledWith('cue');
  p.setCue({ ...cue, src: 'missing.mp3' }); expect(status).toHaveBeenCalledWith(expect.stringContaining('Missing downloaded'));
});
it('clears the cue layer on a silent phase and reschedules only on a real cue change', () => {
  const { p } = setup(); p.setCue(cue); p.setCue({ ...cue });
  expect(scheduler.setLayer).toHaveBeenCalledOnce();
  p.setCue({ ...cue, endsAt: 12000 }); expect(scheduler.setLayer).toHaveBeenCalledTimes(2);
  p.setCue(null); expect(scheduler.clearLayer).toHaveBeenCalledWith('cue');
});
it('starts the looping bed once and leaves it alone across cue changes, then releases everything on leave', () => {
  const { p } = setup({ withMusic: true });
  p.startMusic(); p.startMusic();
  expect(scheduler.setLayer).toHaveBeenCalledOnce();
  expect(scheduler.setLayer).toHaveBeenCalledWith('bed', { uri: 'file://c.mp3', loop: true, volume: 0.2 });
  p.setCue(cue); p.setCue(null);
  expect(scheduler.setLayer.mock.calls.filter(call => call[0] === 'bed')).toHaveLength(1);
  expect(scheduler.clearLayer).not.toHaveBeenCalledWith('bed');
  p.dispose(); players.splice(players.indexOf(p), 1);
  expect(scheduler.removeListener).toHaveBeenCalledOnce(); expect(scheduler.reset).toHaveBeenCalledOnce();
});
it('refuses to start without downloaded background music', () => {
  expect(() => new ShowPlayer({ format: 1, revision: 'a'.repeat(64), scenarioVersion: 'one', backgroundMusic: { src: 'bed.mp3', volume: 0.2 },
    files: [{ src: 'bed.mp3', sha256: '0'.repeat(64), bytes: 5 }] }, new ServerClock(), vi.fn())).toThrow('Missing downloaded background music');
});
it('pauses and resumes every layer natively on device pause', () => {
  const { p, status } = setup(); p.setEnabled(false);
  expect(scheduler.pause).toHaveBeenCalledOnce(); expect(status).toHaveBeenLastCalledWith('Paused on this device');
  p.setEnabled(true); expect(scheduler.resume).toHaveBeenCalledOnce();
});
it('mirrors lock-screen and interruption pauses from native code', () => {
  const { status } = setup();
  emit(true, 'remote'); expect(status).toHaveBeenLastCalledWith('Paused — use Resume at show position');
  emit(false, 'remote'); expect(status).toHaveBeenLastCalledWith('Playing');
  status.mockClear(); emit(true, 'api'); expect(status).not.toHaveBeenCalled();
});
it('reports native layer timing as main narration and extra music', () => {
  const { p } = setup({ withMusic: true }); p.setCue(cue);
  scheduler.timing = [
    { id: 'bed', state: 'playing', positionMs: 1200, targetMs: null, driftMs: null, error: null },
    { id: 'cue', state: 'playing', positionMs: 4010, targetMs: 4000, driftMs: 10, error: null },
  ];
  expect(p.timing().media).toEqual([
    { role: 'main', positionMs: 4010, targetMs: 4000, driftMs: 10, state: 'playing' },
    { role: 'extra', positionMs: 1200, targetMs: null, driftMs: null, state: 'playing' },
  ]);
});
it('sends explicit nulls when iOS omits empty timing fields', () => {
  const { p } = setup({ withMusic: true });
  scheduler.timing = [{ id: 'bed', state: 'playing', positionMs: 1200 } as unknown as typeof scheduler.timing[number]];
  expect(p.timing().media).toEqual([{ role: 'extra', positionMs: 1200, targetMs: null, driftMs: null, state: 'playing' }]);
});
