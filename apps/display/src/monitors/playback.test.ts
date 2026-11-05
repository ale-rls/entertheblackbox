import { describe, expect, it } from "vitest";
import { monitorVideoTime } from "./playback.js";
describe("monitor video clock", () => {
  it("seeks late arrivals, holds finite endings and wraps loops", () => {
    expect(monitorVideoTime(4500, 10, false)).toEqual({ time: 4.5, playing: true });
    expect(monitorVideoTime(12000, 10, false)).toEqual({ time: 9.999, playing: false });
    expect(monitorVideoTime(24500, 10, true)).toEqual({ time: 4.5, playing: true });
    expect(monitorVideoTime(20000, 10, true)).toEqual({ time: 0, playing: true });
  });
  it("does not play a future cue or unknown-duration media", () => {
    expect(monitorVideoTime(-10, 10, true).playing).toBe(false);
    expect(monitorVideoTime(100, NaN, true).playing).toBe(false);
  });
});
