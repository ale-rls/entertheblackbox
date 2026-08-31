import {
  ORIGINAL_MARKER_TRACK,
  type MarkerTrack,
} from "./markerTrack.js";

export type Point = readonly [x: number, y: number];
export type Quad = readonly [Point, Point, Point, Point];

/** Compensate for the canvas update landing one paint after the video frame. */
export const TRACK_PRESENTATION_LEAD_SECONDS = 1 / ORIGINAL_MARKER_TRACK.fps;
/** Expand from the black marker into the prop's surrounding white frame. */
export const TRACKED_QR_SCALE = 1.25;
const PERSPECTIVE_MESH_STEPS = 4;

const pointAt = (frame: readonly number[], corner: number): Point => [
  frame[corner * 2]!,
  frame[corner * 2 + 1]!,
];

/** Interpolate one video's precomputed marker track against its media clock. */
export function trackedQuadAt(
  mediaTimeSeconds: number,
  track: MarkerTrack = ORIGINAL_MARKER_TRACK,
): Quad {
  const duration = track.frames.length / track.fps;
  const finiteTime = Number.isFinite(mediaTimeSeconds) ? mediaTimeSeconds : 0;
  const loopTime = ((finiteTime % duration) + duration) % duration;
  const framePosition = loopTime * track.fps;
  const frameIndex = Math.floor(framePosition) % track.frames.length;
  const nextIndex = (frameIndex + 1) % track.frames.length;
  const mix = framePosition - Math.floor(framePosition);
  const frame = track.frames[frameIndex]!;
  const next = track.frames[nextIndex]!;

  return [0, 1, 2, 3].map((corner) => {
    const from = pointAt(frame, corner);
    const to = pointAt(next, corner);
    return [
      from[0] + (to[0] - from[0]) * mix,
      from[1] + (to[1] - from[1]) * mix,
    ] as Point;
  }) as unknown as Quad;
}

const pointOnQuad = (quad: Quad, x: number, y: number): Point => {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  return [
    topLeft[0] * (1 - x) * (1 - y)
      + topRight[0] * x * (1 - y)
      + bottomRight[0] * x * y
      + bottomLeft[0] * (1 - x) * y,
    topLeft[1] * (1 - x) * (1 - y)
      + topRight[1] * x * (1 - y)
      + bottomRight[1] * x * y
      + bottomLeft[1] * (1 - x) * y,
  ];
};

/** Scale a perspective quad around its centre without changing its tracking. */
export function scaleQuad(quad: Quad, scale: number): Quad {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  const center: Point = [
    (topLeft[0] + topRight[0] + bottomRight[0] + bottomLeft[0]) / 4,
    (topLeft[1] + topRight[1] + bottomRight[1] + bottomLeft[1]) / 4,
  ];
  const scalePoint = (point: Point): Point => [
    center[0] + (point[0] - center[0]) * scale,
    center[1] + (point[1] - center[1]) * scale,
  ];
  return [
    scalePoint(topLeft),
    scalePoint(topRight),
    scalePoint(bottomRight),
    scalePoint(bottomLeft),
  ];
}

function drawTriangle(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  source: readonly [Point, Point, Point],
  destination: readonly [Point, Point, Point],
): void {
  const [[x0, y0], [x1, y1], [x2, y2]] = source;
  const [[u0, v0], [u1, v1], [u2, v2]] = destination;
  const denominator = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
  const a = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / denominator;
  const b = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / denominator;
  const c = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / denominator;
  const d = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / denominator;
  const e = (
    u0 * (x1 * y2 - x2 * y1)
    + u1 * (x2 * y0 - x0 * y2)
    + u2 * (x0 * y1 - x1 * y0)
  ) / denominator;
  const f = (
    v0 * (x1 * y2 - x2 * y1)
    + v1 * (x2 * y0 - x0 * y2)
    + v2 * (x0 * y1 - x1 * y0)
  ) / denominator;

  context.save();
  context.beginPath();
  context.moveTo(u0, v0);
  context.lineTo(u1, v1);
  context.lineTo(u2, v2);
  context.closePath();
  context.clip();
  context.setTransform(a, b, c, d, e, f);
  context.drawImage(image, 0, 0);
  context.restore();
}

/** Draw an image through a perspective mesh into the tracked marker. */
export function drawTrackedQr(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  mediaTimeSeconds: number,
  track: MarkerTrack = ORIGINAL_MARKER_TRACK,
): void {
  const quad = scaleQuad(
    trackedQuadAt(mediaTimeSeconds + 1 / track.fps, track),
    TRACKED_QR_SCALE,
  );
  const width = image.width;
  const height = image.height;

  for (let row = 0; row < PERSPECTIVE_MESH_STEPS; row += 1) {
    for (let column = 0; column < PERSPECTIVE_MESH_STEPS; column += 1) {
      const x0 = column / PERSPECTIVE_MESH_STEPS;
      const x1 = (column + 1) / PERSPECTIVE_MESH_STEPS;
      const y0 = row / PERSPECTIVE_MESH_STEPS;
      const y1 = (row + 1) / PERSPECTIVE_MESH_STEPS;
      const sourceTopLeft: Point = [x0 * width, y0 * height];
      const sourceTopRight: Point = [x1 * width, y0 * height];
      const sourceBottomRight: Point = [x1 * width, y1 * height];
      const sourceBottomLeft: Point = [x0 * width, y1 * height];
      const topLeft = pointOnQuad(quad, x0, y0);
      const topRight = pointOnQuad(quad, x1, y0);
      const bottomRight = pointOnQuad(quad, x1, y1);
      const bottomLeft = pointOnQuad(quad, x0, y1);

      drawTriangle(
        context,
        image,
        [sourceTopLeft, sourceTopRight, sourceBottomRight],
        [topLeft, topRight, bottomRight],
      );
      drawTriangle(
        context,
        image,
        [sourceTopLeft, sourceBottomRight, sourceBottomLeft],
        [topLeft, bottomRight, bottomLeft],
      );
    }
  }
}
