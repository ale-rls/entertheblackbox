import type { WallMessage, WallStatusMessage } from '@entertheblackbox/protocol';
import { wallCorrection, wallPlaybackPosition } from '@entertheblackbox/shared';

/** Latest `wall` message wins; late or reordered messages are dropped. */
export function acceptWall(current: WallMessage | null, next: WallMessage): WallMessage | null {
  return current && next.seq <= current.seq ? current : next;
}

/** The subset of expo-video's VideoPlayer the sync loop drives (a plain object in tests). */
export interface WallPlayer {
  currentTime: number;
  readonly duration: number;
  playbackRate: number;
  readonly playing: boolean;
  play(): void;
  pause(): void;
}

export type WallPlayback = { state: 'ready' | 'playing' | 'ended'; driftMs?: number };

/**
 * One correction step: hold the first frame until `startAt`, then keep the
 * player on the shared clock: nudge the rate for small drift, seek for large.
 */
export function syncWallPlayer(player: WallPlayer, startAt: number | null, loop: boolean, serverNow: number): WallPlayback {
  const duration = player.duration;
  const target = wallPlaybackPosition(startAt, serverNow, duration, loop);
  if (target.state === 'waiting') {
    if (player.playing) player.pause();
    if (player.currentTime > 0.05) player.currentTime = 0;
    player.playbackRate = 1;
    return { state: 'ready' };
  }
  if (target.state === 'ended') {
    if (player.playing) player.pause();
    return { state: 'ended' };
  }
  const correction = wallCorrection(player.currentTime, target.seconds, duration, loop);
  if (correction.seek) { player.currentTime = target.seconds; player.playbackRate = 1; }
  else player.playbackRate = correction.rate;
  if (!player.playing) player.play();
  return { state: 'playing', driftMs: Math.round(correction.drift * 1000) };
}

export type WallSliceState = { state: 'idle' | 'downloading' | 'ready' | 'error'; uri?: string; detail?: string };

/** What this tablet tells the server, from download state, show mode and playback. */
export function wallStatus(clip: string | null, slice: WallSliceState, showMode: boolean, playback: WallPlayback | null): Omit<WallStatusMessage, 't' | 'v'> {
  if (!clip || slice.state === 'idle') return { clip: null, state: 'idle' };
  if (slice.state !== 'ready') return { clip, state: slice.state, ...(slice.detail ? { detail: slice.detail } : {}) };
  if (!showMode) return { clip, state: 'ready', detail: 'Not in show mode' };
  if (!playback) return { clip, state: 'ready' };
  return { clip, state: playback.state, ...(playback.driftMs === undefined ? {} : { driftMs: playback.driftMs }) };
}
