import { describe, expect, it } from "vitest";
import type { MonitorCue } from "@entertheblackbox/scenario";
import { isAdjacentMonitorVideoCut, MONITOR_CUT_HOLD_MS, monitorVideoTime } from "./playback.js";
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

describe("monitor video cuts", () => {
  const first = { kind: "video", src: "a.mp4", startMs: 0, fit: "cover", loop: false } as const;
  const next = { ...first, src: "b.mp4", startMs: 2000 } as const;

  it("allows a brief hold at an uninterrupted cut and expires it during a stall", () => {
    const cues = [first, next];
    expect(isAdjacentMonitorVideoCut(cues, first.startMs, next, next.startMs)).toBe(true);
    expect(isAdjacentMonitorVideoCut(cues, first.startMs, next, next.startMs + MONITOR_CUT_HOLD_MS)).toBe(false);
  });

  it("clears for authored gaps and when an intervening cue was skipped", () => {
    const blank: MonitorCue = { kind: "blank", startMs: 1900 };
    expect(isAdjacentMonitorVideoCut([{ ...first, durationMs: 1900 }, next], first.startMs, next, next.startMs)).toBe(false);
    expect(isAdjacentMonitorVideoCut([first, blank, next], first.startMs, blank, blank.startMs)).toBe(false);
    expect(isAdjacentMonitorVideoCut([first, blank, next], first.startMs, next, next.startMs)).toBe(false);
  });
});
