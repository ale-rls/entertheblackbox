import {
  MARKER_TRACK,
  MARKER_TRACK_FPS,
} from "./markerTrack.js";

export type Point = readonly [x: number, y: number];
export type Quad = readonly [Point, Point, Point, Point];

const pointAt = (frame: readonly number[], corner: number): Point => [
  frame[corner * 2]!,
  frame[corner * 2 + 1]!,
];

/** Interpolate the precomputed marker track against the video's media clock. */
export function trackedQuadAt(mediaTimeSeconds: number): Quad {
  const duration = MARKER_TRACK.length / MARKER_TRACK_FPS;
  const finiteTime = Number.isFinite(mediaTimeSeconds) ? mediaTimeSeconds : 0;
  const loopTime = ((finiteTime % duration) + duration) % duration;
  const framePosition = loopTime * MARKER_TRACK_FPS;
  const frameIndex = Math.floor(framePosition) % MARKER_TRACK.length;
  const nextIndex = (frameIndex + 1) % MARKER_TRACK.length;
  const mix = framePosition - Math.floor(framePosition);
  const frame = MARKER_TRACK[frameIndex]!;
  const next = MARKER_TRACK[nextIndex]!;

  return [0, 1, 2, 3].map((corner) => {
    const from = pointAt(frame, corner);
    const to = pointAt(next, corner);
    return [
      from[0] + (to[0] - from[0]) * mix,
      from[1] + (to[1] - from[1]) * mix,
    ] as Point;
  }) as unknown as Quad;
}

/** Draw an image into the tracked marker's affine quadrilateral. */
export function drawTrackedQr(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  mediaTimeSeconds: number,
): void {
  const [topLeft, topRight, , bottomLeft] = trackedQuadAt(mediaTimeSeconds);
  const width = image.width;
  const height = image.height;

  context.save();
  context.setTransform(
    (topRight[0] - topLeft[0]) / width,
    (topRight[1] - topLeft[1]) / width,
    (bottomLeft[0] - topLeft[0]) / height,
    (bottomLeft[1] - topLeft[1]) / height,
    topLeft[0],
    topLeft[1],
  );
  context.drawImage(image, 0, 0);
  context.restore();
}
