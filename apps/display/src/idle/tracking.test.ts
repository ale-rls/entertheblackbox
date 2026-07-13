import { describe, expect, it } from "vitest";
import { MARKER_TRACK, MARKER_TRACK_FPS } from "./markerTrack.js";
import { trackedQuadAt } from "./tracking.js";

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
});
