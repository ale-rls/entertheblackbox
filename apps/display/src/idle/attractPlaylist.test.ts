import { describe, expect, it } from "vitest";
import { pickInitialAttractIndex, pickNextAttractIndex } from "./attractPlaylist.js";

describe("attract playlist", () => {
  it("chooses the initial clip across the full playlist", () => {
    expect(pickInitialAttractIndex(3, () => 0)).toBe(0);
    expect(pickInitialAttractIndex(3, () => 0.999)).toBe(2);
  });

  it("never chooses the current clip when alternatives exist", () => {
    for (let current = 0; current < 4; current += 1) {
      for (const random of [0, 0.24, 0.5, 0.75, 0.999]) {
        expect(pickNextAttractIndex(current, 4, () => random)).not.toBe(current);
      }
    }
  });

  it("keeps a single-video playlist on its only clip", () => {
    expect(pickNextAttractIndex(0, 1, () => 0.5)).toBe(0);
  });
});
