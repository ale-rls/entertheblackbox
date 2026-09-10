import { describe, expect, it } from "vitest";
import { MARKER_TRACK, MARKER_TRACK_FPS } from "./markerTrack.js";
import type { MarkerTrack } from "./markerTrack.js";
import {
  drawTrackedQr,
  scaleQuad,
  TRACK_PRESENTATION_LEAD_SECONDS,
  TRACKED_QR_SCALE,
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
    const expected = first.map(
      (value, index) => value + (second[index]! - value) / 2,
    );
    halfway.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!));
  });

  it("uses the selected video's frames and fps", () => {
    const track: MarkerTrack = {
      fps: 10,
      width: 100,
      height: 100,
      frames: [
        [0, 0, 10, 0, 10, 10, 0, 10],
        [10, 10, 20, 10, 20, 20, 10, 20],
      ],
    };
    trackedQuadAt(0.05, track).flat().forEach((value, index) => {
      expect(value).toBeCloseTo([5, 5, 15, 5, 15, 15, 5, 15][index]!);
    });
  });

  it("wraps exactly with the looping video", () => {
    const duration = MARKER_TRACK.length / MARKER_TRACK_FPS;
    expect(trackedQuadAt(duration).flat()).toEqual(MARKER_TRACK[0]);
    expect(trackedQuadAt(Number.NaN).flat()).toEqual(MARKER_TRACK[0]);
  });

  it("enlarges the tracked marker around its centre", () => {
    expect(scaleQuad(
      [[0, 0], [8, 0], [8, 8], [0, 8]],
      1.25,
    )).toEqual([[-1, -1], [9, -1], [9, 9], [-1, 9]]);
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
    expect(points).toContainEqual(
      scaleQuad(
        trackedQuadAt(TRACK_PRESENTATION_LEAD_SECONDS),
        TRACKED_QR_SCALE,
      )[2],
    );
  });
});
