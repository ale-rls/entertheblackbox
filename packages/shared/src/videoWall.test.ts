import { describe, expect, it } from "vitest";
import {
  wallCropFraction, wallVideoFrame,
  DEFAULT_WALL_LAYOUT, duplicateWallLabels, parseWallSliceFileName, wallCorrection, wallFfmpegCommand, wallPlaybackPosition,
  wallSlicePlan, wallSlotForLabel, wallSlotIds, type WallLayout,
} from "./videoWall.js";

// 2×2 wall of 160×90 mm screens with 20 mm gaps: 340×200 mm. Source 3400×2000 → exactly 10 px/mm.
const layout: WallLayout = {
  cols: 2, rows: 2,
  screen: { widthMm: 160, heightMm: 90, widthPx: 1920, heightPx: 1080 },
  gapMm: { x: 20, y: 20 },
  source: { widthPx: 3400, heightPx: 2000, fps: 25 },
  fit: "fill",
  slots: { A1: "T01", A2: "t02 ", B1: "T03", B2: "T01", Z9: "T09" },
};

describe("wall slots and labels", () => {
  it("names slots row-major from A1 and finds a tablet's slot", () => {
    expect(wallSlotIds(layout)).toEqual(["A1", "A2", "B1", "B2"]);
    expect(wallSlotForLabel(layout, "T02")).toBe("A2");
    expect(wallSlotForLabel(layout, "T09")).toBeNull();
    expect(duplicateWallLabels(layout)).toEqual(["t01"]);
  });

  it("parses slice file names", () => {
    expect(parseWallSliceFileName("ocean-2__B12.mp4")).toEqual({ clip: "ocean-2", slot: "B12" });
    for (const bad of ["ocean_B1.mp4", "ocean__b1.mp4", "ocean__B1.mov", "../x__A1.mp4", "__A1.mp4"]) expect(parseWallSliceFileName(bad)).toBeNull();
  });
});

describe("slice calculator", () => {
  it("skips the source behind the gaps and gives Premiere and export settings", () => {
    const plan = wallSlicePlan(layout);
    expect(plan.wallMm).toEqual({ width: 340, height: 200 });
    expect(plan.pxPerMm).toBe(10);
    expect(plan.slices.map((s) => [s.id, s.crop])).toEqual([
      ["A1", { x: 0, y: 0, w: 1600, h: 900 }],
      ["A2", { x: 1800, y: 0, w: 1600, h: 900 }],
      ["B1", { x: 0, y: 1100, w: 1600, h: 900 }],
      ["B2", { x: 1800, y: 1100, w: 1600, h: 900 }],
    ]);
    // Crop is smaller than the tablet: exported at crop size, Premiere at 100 %.
    expect(plan.slices[3]!.export).toEqual({ widthPx: 1600, heightPx: 900 });
    expect(plan.slices[3]!.premiere).toEqual({ scalePercent: 100, positionX: -100, positionY: -100 });
    expect(plan.gaps).toEqual([{ x: 1600, y: 0, w: 200, h: 2000 }, { x: 0, y: 900, w: 3400, h: 200 }]);
  });

  it("never upscales past the tablet and centres the wall in fill and fit modes", () => {
    const small = wallSlicePlan({ ...layout, screen: { ...layout.screen, widthPx: 800, heightPx: 450 } });
    expect(small.slices[0]!.export).toEqual({ widthPx: 800, heightPx: 450 });
    expect(small.slices[0]!.premiere).toMatchObject({ scalePercent: 50, positionX: 850, positionY: 500 });

    const wide = { ...layout, source: { ...layout.source, widthPx: 6800 } };
    // fill: the wall height fills the 2000 px; wall is centred horizontally.
    expect(wallSlicePlan(wide).wallPx).toEqual({ x: 1700, y: 0, w: 3400, h: 2000 });
    // fit: the wall is scaled to the full width, and reaches above and below the frame.
    const fit = wallSlicePlan({ ...wide, fit: "fit" });
    expect(fit.pxPerMm).toBe(20);
    expect(fit.slices[0]!.crop).toEqual({ x: 0, y: -1000, w: 3200, h: 1800 });
  });

  it("writes ffmpeg commands, padding with black when a slice reaches past the frame", () => {
    const plan = wallSlicePlan(layout);
    expect(wallFfmpegCommand(layout, plan.slices[1]!, "master.mov", "ocean")).toBe(
      'ffmpeg -i "master.mov" -vf "crop=1600:900:1800:0,scale=1600:900" -r 25 -an -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 -g 25 -keyint_min 25 -sc_threshold 0 -movflags +faststart ocean__A2.mp4');
    const fit = { ...layout, source: { ...layout.source, widthPx: 6800 }, fit: "fit" as const };
    expect(wallFfmpegCommand(fit, wallSlicePlan(fit).slices[0]!, "m.mov", "x")).toContain('-vf "pad=6800:3000:0:1000:black,crop=3200:1800:0:0,scale=1920:1080"');
  });

  it("has a sane default layout", () => {
    const plan = wallSlicePlan(DEFAULT_WALL_LAYOUT);
    expect(plan.slices).toHaveLength(12);
    expect(plan.slices.every((s) => s.export.widthPx % 2 === 0 && s.export.heightPx % 2 === 0)).toBe(true);
  });
});

describe("wall playback timing", () => {
  it("computes the shared position: waiting, playing, looping and ended", () => {
    expect(wallPlaybackPosition(null, 5_000, 10, false)).toEqual({ state: "waiting", seconds: 0 });
    expect(wallPlaybackPosition(6_000, 5_000, 10, false)).toEqual({ state: "waiting", seconds: 0 });
    expect(wallPlaybackPosition(1_000, 3_500, 10, false)).toEqual({ state: "playing", seconds: 2.5 });
    expect(wallPlaybackPosition(1_000, 13_500, 10, true)).toEqual({ state: "playing", seconds: 2.5 });
    expect(wallPlaybackPosition(1_000, 13_500, 10, false)).toEqual({ state: "ended", seconds: 10 });
  });

  it("nudges the rate for small drift, seeks for large drift, and handles the loop point", () => {
    expect(wallCorrection(5.01, 5, 10, false)).toMatchObject({ seek: false, rate: 1 });
    expect(wallCorrection(5.1, 5, 10, false)).toMatchObject({ seek: false, rate: 0.95 });
    expect(wallCorrection(4.96, 5, 10, false)).toMatchObject({ seek: false, rate: 1.02 });
    expect(wallCorrection(6, 5, 10, false)).toMatchObject({ seek: true, rate: 1 });
    const wrap = wallCorrection(9.95, 0.05, 10, true);
    expect(wrap.drift).toBeCloseTo(-0.1);
    expect(wrap.seek).toBe(false);
  });
});

describe("uncut video cropping", () => {
  it("gives each position its region of the frame as fractions, matching the slice calculator", () => {
    // Same 2×2 layout on a small 340×200 video: exactly 1 px per mm.
    expect(wallCropFraction(layout, 340, 200, "B2")).toEqual({ x: 180 / 340, y: 110 / 200, w: 160 / 340, h: 90 / 200 });
    const plan = wallSlicePlan(layout);
    const big = wallCropFraction(layout, 3400, 2000, "A2")!;
    expect(big.x * 3400).toBeCloseTo(plan.slices[1]!.crop.x);
    expect(big.w * 3400).toBeCloseTo(plan.slices[1]!.crop.w);
    expect(wallCropFraction(layout, 340, 200, "C1")).toBeNull();
    expect(wallCropFraction(layout, 340, 200, "A3")).toBeNull();
    expect(wallCropFraction(layout, 0, 200, "A1")).toBeNull();
  });

  it("sizes the enlarged video so the region fills the tablet", () => {
    const crop = wallCropFraction(layout, 340, 200, "B2")!;
    const frame = wallVideoFrame(crop, 1600, 900);
    expect(frame.width).toBeCloseTo(3400);
    expect(frame.height).toBeCloseTo(2000);
    expect(frame.left).toBeCloseTo(-1800);
    expect(frame.top).toBeCloseTo(-1100);
  });
});
