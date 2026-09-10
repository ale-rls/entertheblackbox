export type MarkerTrack = {
  fps: number;
  width: number;
  height: number;
  frames: readonly (readonly number[])[];
};

/**
 * Default QR placement used when a clip has no generated marker track.
 *
 * A real track is a per-frame path of perspective marker corners, produced by
 * `pnpm generate-idle-marker-tracks` from a printed marker visible in the
 * attract footage, so the QR appears fixed to a surface in the shot. Until the
 * production's own attract clips exist there is nothing to track, so this
 * fallback is a single static frame: a centred, axis-aligned square. It keeps
 * the QR readable over any clip and degrades to a plain centred code when the
 * attract playlist is empty.
 *
 * Values are [top-left x/y, top-right x/y, bottom-right x/y, bottom-left x/y]
 * in source-resolution pixels.
 */
export const MARKER_TRACK_FPS = 25;
export const MARKER_TRACK_WIDTH = 1920;
export const MARKER_TRACK_HEIGHT = 1080;

const SQUARE_SIZE = 400;
const LEFT = (MARKER_TRACK_WIDTH - SQUARE_SIZE) / 2;
const RIGHT = LEFT + SQUARE_SIZE;
const TOP = (MARKER_TRACK_HEIGHT - SQUARE_SIZE) / 2;
const BOTTOM = TOP + SQUARE_SIZE;

export const MARKER_TRACK: readonly (readonly number[])[] = [
  [LEFT, TOP, RIGHT, TOP, RIGHT, BOTTOM, LEFT, BOTTOM],
];

export const ORIGINAL_MARKER_TRACK: MarkerTrack = {
  fps: MARKER_TRACK_FPS,
  width: MARKER_TRACK_WIDTH,
  height: MARKER_TRACK_HEIGHT,
  frames: MARKER_TRACK,
};
