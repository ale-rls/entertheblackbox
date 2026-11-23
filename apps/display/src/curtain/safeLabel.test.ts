import { describe, expect, it } from "vitest";
import { safeLabelX } from "./CurtainStage.js";

describe("safeLabelX", () => {
  it("keeps a label centred on its pool when it fits", () => {
    expect(safeLabelX(960, 200, 1920, 0.05)).toBe(960);
  });
  it("moves the end labels of a scale inward to stay inside the side safe area", () => {
    // 5% of 1920 = 96 px kept clear: a 300 px word must be centred at least 96 + 150 from the edge.
    expect(safeLabelX(40, 300, 1920, 0.05)).toBe(246);
    expect(safeLabelX(1900, 300, 1920, 0.05)).toBe(1920 - 246);
  });
  it("centres a label wider than the safe width", () => {
    expect(safeLabelX(100, 1900, 1920, 0.05)).toBe(960);
  });
});
