import { describe, expect, it } from "vitest";
import { MARKER_TRACK, MARKER_TRACK_FPS } from "./markerTrack.js";
import {
  drawTrackedQr,
  TRACK_PRESENTATION_LEAD_SECONDS,
  trackedQuadAt,
} from "./tracking.js";

describe("trackedQuadAt", () => {
  it("starts at the first tracked marker frame", () => {
    expect(trackedQuadAt(0).flat()).toEqual(MARKER_TRACK[0]);
  });

  it("interpolates smoothly between video frames", () => {
    const halfway = trackedQuadAt(0.5 / MARKER_TRACK_FPS).flat();
    const first = MARKER_TRACK[0]!;
    const second = MARKER_TRACK[1]!;
    expect(halfway).toEqual(
      first.map((value, index) => value + (second[index]! - value) / 2),
    );
  });

  it("wraps exactly with the looping video", () => {
    const duration = MARKER_TRACK.length / MARKER_TRACK_FPS;
    expect(trackedQuadAt(duration).flat()).toEqual(MARKER_TRACK[0]);
    expect(trackedQuadAt(Number.NaN).flat()).toEqual(MARKER_TRACK[0]);
  });

  it("renders every perspective-mesh triangle with a one-frame lead", () => {
    const points: number[][] = [];
    let drawCount = 0;
    const context = {
      save() {},
      beginPath() {},
      moveTo(x: number, y: number) { points.push([x, y]); },
      lineTo(x: number, y: number) { points.push([x, y]); },
      closePath() {},
      clip() {},
      setTransform() {},
      drawImage() { drawCount += 1; },
      restore() {},
    } as unknown as CanvasRenderingContext2D;
    const image = { width: 512, height: 512 } as CanvasImageSource & {
      width: number;
      height: number;
    };

    drawTrackedQr(context, image, 0);

    expect(drawCount).toBe(32);
    expect(points).toContainEqual(trackedQuadAt(TRACK_PRESENTATION_LEAD_SECONDS)[2]);
  });
});
