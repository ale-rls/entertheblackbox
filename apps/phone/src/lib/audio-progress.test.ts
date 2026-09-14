import { describe, expect, it } from "vitest";
import { AudioProgress } from "./audio-progress";

describe("audio recovery grace", () => {
  it("gives each reconnect a full buffering window after a stall", () => {
    const progress = new AudioProgress();
    progress.reset(12, 0);
    expect(progress.stalled(12, 15_000)).toBe(true);
    progress.reset(0, 15_500);
    expect(progress.stalled(0, 20_000)).toBe(false);
    expect(progress.stalled(0, 30_500)).toBe(true);
  });
  it("accepts a shorter grace window for a stream that already recovered once", () => {
    const progress = new AudioProgress();
    progress.reset(12, 0);
    expect(progress.stalled(12, 4_000, 5_000)).toBe(false);
    expect(progress.stalled(12, 5_500, 5_000)).toBe(true);
  });
  it("preserves advancing playback and resets grace on visibility resume", () => {
    const progress = new AudioProgress();
    progress.reset(0, 0);
    expect(progress.stalled(5, 5000)).toBe(false);
    expect(progress.stalled(10, 60_000)).toBe(false);
    progress.reset(10, 120_000);
    expect(progress.stalled(10, 125_000)).toBe(false);
  });
});
