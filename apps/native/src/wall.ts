import type { WallMessage, WallStatusMessage } from '@entertheblackbox/protocol';
import { wallCorrection, wallCropFraction, wallPlaybackPosition, wallVideoFrame } from '@entertheblackbox/shared';

export type WallRegion = NonNullable<NonNullable<WallMessage['clip']>['region']>;

/**
 * Where to draw an uncut wall video so this tablet's region fills the screen.
 * Uses the video's real pixel size once known (falls back to the layout's
 * master size). Null when the whole video should simply fill the screen.
 */
export function wallViewFrame(region: WallRegion | undefined, slot: string, video: { width: number; height: number } | null, screen: { width: number; height: number } | null) {
  if (!region || !screen || !(screen.width > 0) || !(screen.height > 0)) return null;
  const width = video && video.width > 0 ? video.width : region.sourceWidthPx;
  const height = video && video.height > 0 ? video.height : region.sourceHeightPx;
  const crop = wallCropFraction({
    cols: region.cols, rows: region.rows, fit: region.fit, gapMm: { x: region.gapXMm, y: region.gapYMm },
    screen: { widthMm: region.screenWidthMm, heightMm: region.screenHeightMm, widthPx: 1, heightPx: 1 },
  }, width, height, slot);
  return crop ? wallVideoFrame(crop, screen.width, screen.height) : null;
}

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

/**
 * Box for the wall video on a portrait-locked screen. For a tablet mounted in
 * landscape the box is the screen with width and height swapped, centred and
 * rotated, so the video is upright on the wall. `screen` inside the box is
 * what the crop maths should use.
 */
export function wallRotatedBox(device: { width: number; height: number }, rotation: 0 | 90 | -90 | undefined) {
  if (!rotation) return { style: { left: 0, top: 0, width: device.width, height: device.height }, screen: device };
  const width = device.height, height = device.width;
  return {
    style: { left: (device.width - width) / 2, top: (device.height - height) / 2, width, height, transform: [{ rotate: `${rotation}deg` }] },
    screen: { width, height },
  };
}
