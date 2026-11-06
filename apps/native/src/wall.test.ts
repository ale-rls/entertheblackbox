import { describe, expect, it } from 'vitest';
import type { WallMessage } from '@entertheblackbox/protocol';
import { acceptWall, syncWallPlayer, wallStatus, type WallPlayer } from './wall';

const message = (seq: number): WallMessage => ({ t: 'wall', v: 2, seq, clip: null, startAt: null, loop: true });
const player = (currentTime: number, playing = false): WallPlayer & { calls: string[] } => {
  const calls: string[] = [];
  return { currentTime, duration: 10, playbackRate: 1, playing, calls, play() { calls.push('play'); }, pause() { calls.push('pause'); } };
};

describe('wall messages', () => {
  it('keeps the newest message only', () => {
    expect(acceptWall(null, message(3))?.seq).toBe(3);
    expect(acceptWall(message(3), message(2))?.seq).toBe(3);
    expect(acceptWall(message(3), message(4))?.seq).toBe(4);
  });
});

describe('syncWallPlayer', () => {
  it('holds the first frame before the start time', () => {
    const p = player(2, true);
    expect(syncWallPlayer(p, 5_000, true, 4_000)).toEqual({ state: 'ready' });
    expect(p.calls).toEqual(['pause']);
    expect(p.currentTime).toBe(0);
    expect(syncWallPlayer(player(0), null, true, 4_000)).toEqual({ state: 'ready' });
  });

  it('starts on time, nudges small drift and seeks large drift', () => {
    const p = player(0);
    expect(syncWallPlayer(p, 1_000, false, 1_000)).toEqual({ state: 'playing', driftMs: 0 });
    expect(p.calls).toEqual(['play']);
    const ahead = player(2.1, true);
    expect(syncWallPlayer(ahead, 1_000, false, 3_000)).toEqual({ state: 'playing', driftMs: 100 });
    expect(ahead.playbackRate).toBe(0.95);
    const lost = player(0.5, true);
    syncWallPlayer(lost, 1_000, false, 6_000);
    expect(lost.currentTime).toBe(5);
    expect(lost.playbackRate).toBe(1);
  });

  it('wraps for loops and stops at the end otherwise', () => {
    const p = player(9.98, true);
    expect(syncWallPlayer(p, 0, true, 10_010).driftMs).toBe(-30);
    const end = player(10, true);
    expect(syncWallPlayer(end, 0, false, 12_000)).toEqual({ state: 'ended' });
    expect(end.calls).toEqual(['pause']);
  });
});

describe('wallStatus', () => {
  it('reports download, show mode and playback in that order', () => {
    expect(wallStatus(null, { state: 'idle' }, true, null)).toEqual({ clip: null, state: 'idle' });
    expect(wallStatus('ocean', { state: 'error', detail: 'Verification failed' }, true, null)).toEqual({ clip: 'ocean', state: 'error', detail: 'Verification failed' });
    expect(wallStatus('ocean', { state: 'ready', uri: 'file:///x' }, false, { state: 'playing', driftMs: 3 })).toEqual({ clip: 'ocean', state: 'ready', detail: 'Not in show mode' });
    expect(wallStatus('ocean', { state: 'ready', uri: 'file:///x' }, true, { state: 'playing', driftMs: 3 })).toEqual({ clip: 'ocean', state: 'playing', driftMs: 3 });
  });
});
