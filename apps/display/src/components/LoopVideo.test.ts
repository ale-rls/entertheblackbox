import { describe, expect, it } from "vitest";
import { loopVideoTime } from "./LoopVideo.js";

describe("loopVideoTime", () => {
  it("wraps on the absolute server clock so consecutive scenes continue the loop", () => {
    expect(loopVideoTime(45_000, 20)).toBeCloseTo(5);
    expect(loopVideoTime(65_500, 20)).toBeCloseTo(5.5);
  });
  it("starts from the first frame at the anchor (where its run of scenes began)", () => {
    expect(loopVideoTime(45_000, 20, 44_000)).toBeCloseTo(1);
    expect(loopVideoTime(65_500, 20, 44_000)).toBeCloseTo(1.5);
    // A display clock slightly behind the anchor holds the first frame.
    expect(loopVideoTime(43_900, 20, 44_000)).toBe(0);
  });
  it("waits for a known duration", () => {
    expect(loopVideoTime(1_000, Number.NaN)).toBeNull();
    expect(loopVideoTime(1_000, 0)).toBeNull();
  });
});
