import { describe, expect, it } from "vitest";
import { loopVideoTime } from "./LoopVideo.js";

describe("loopVideoTime", () => {
  it("wraps on the absolute server clock so consecutive scenes continue the loop", () => {
    expect(loopVideoTime(45_000, 20)).toBeCloseTo(5);
    expect(loopVideoTime(65_500, 20)).toBeCloseTo(5.5);
  });
  it("waits for a known duration", () => {
    expect(loopVideoTime(1_000, Number.NaN)).toBeNull();
    expect(loopVideoTime(1_000, 0)).toBeNull();
  });
});
