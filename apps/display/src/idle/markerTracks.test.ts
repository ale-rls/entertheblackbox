import { describe, expect, it } from "vitest";
import { MARKER_TRACKS_BY_FILENAME } from "./markerTracks.js";

describe("per-video marker tracks", () => {
  it("has a frame-aligned track for every bundled attract video", () => {
    expect(Object.keys(MARKER_TRACKS_BY_FILENAME).sort()).toEqual([
      "1.0_25_a_breath.mp4",
      "1.0_25_b_snapshot.mp4",
      "1.0_25_c_advert.mp4",
      "idle-attract.mp4",
    ]);
    expect(MARKER_TRACKS_BY_FILENAME["1.0_25_a_breath.mp4"]).toMatchObject({ fps: 24, width: 1280, height: 704 });
    expect(MARKER_TRACKS_BY_FILENAME["1.0_25_a_breath.mp4"]?.frames).toHaveLength(241);
    expect(MARKER_TRACKS_BY_FILENAME["1.0_25_b_snapshot.mp4"]?.frames).toHaveLength(241);
    expect(MARKER_TRACKS_BY_FILENAME["1.0_25_c_advert.mp4"]?.frames).toHaveLength(481);
    expect(MARKER_TRACKS_BY_FILENAME["idle-attract.mp4"]).toMatchObject({ fps: 25, width: 1280, height: 704 });
    expect(MARKER_TRACKS_BY_FILENAME["idle-attract.mp4"]?.frames).toHaveLength(249);
  });

  it("tracks the snapshot marker above the frame while the board is clipped", () => {
    const clippedFrame = MARKER_TRACKS_BY_FILENAME["1.0_25_b_snapshot.mp4"]?.frames[100];
    expect(clippedFrame?.[1]).toBeLessThan(0);
    expect(clippedFrame?.[3]).toBeLessThan(0);
    expect(clippedFrame?.[5]).toBeGreaterThan(0);
    expect(clippedFrame?.[7]).toBeGreaterThan(0);
  });
});
