import { describe, expect, it } from "vitest";
import type { PhaseSnapshotMessage } from "@entertheblackbox/protocol";
import { finalMonitorCountdown, monitorCountdown, monitorCueCountdown, monitorCueShowsCountdown } from "./countdown.js";

const position = (extra: object = {}) => ({
  kind: "position-question", startedAt: 10_000, deadlineAt: 30_000, ...extra,
}) as PhaseSnapshotMessage;
const video = (extra: object = {}) => ({
  kind: "video-position-question", startedAt: 10_000, showAtMs: 2_000,
  openAtMs: 4_000, closeAtMs: 20_000, hideAtMs: 22_000, ...extra,
}) as PhaseSnapshotMessage;

describe("monitor positioning countdown", () => {
  it("uses the authoritative deadline and rounds partial seconds up", () => {
    expect(monitorCountdown(position(), 10_000)).toBe(20);
    expect(monitorCountdown(position(), 28_001)).toBe(2);
    expect(monitorCountdown(position(), 29_999)).toBe(1);
    expect(monitorCountdown(position(), 30_000)).toBeNull();
  });
  it("does not count before the phase or for untimed and unrelated scenes", () => {
    expect(monitorCountdown(position(), 9_999)).toBeNull();
    expect(monitorCountdown(position({ deadlineAt: null }), 15_000)).toBeNull();
    expect(monitorCountdown({ kind: "idle" } as PhaseSnapshotMessage, 15_000)).toBeNull();
    expect(monitorCountdown(null, 15_000)).toBeNull();
  });
  it("counts only in the visible, open video voting window", () => {
    expect(monitorCountdown(video(), 12_000)).toBeNull();
    expect(monitorCountdown(video(), 14_000)).toBe(16);
    expect(monitorCountdown(video(), 29_001)).toBe(1);
    expect(monitorCountdown(video(), 30_000)).toBeNull();
    expect(monitorCountdown(video(), 32_000)).toBeNull();
    expect(monitorCountdown(video({ showAtMs: 6_000 }), 15_000)).toBeNull();
  });
  it("counts a video or narration scene's authored countdown", () => {
    const scene = { kind: "video", startedAt: 10_000, countdown: { startAtMs: 5_000, endAtMs: 35_000 } } as PhaseSnapshotMessage;
    expect(monitorCountdown(scene, 14_999)).toBeNull();
    expect(monitorCountdown(scene, 15_000)).toBe(30);
    expect(monitorCountdown(scene, 44_001)).toBe(1);
    expect(monitorCountdown(scene, 45_000)).toBeNull();
    expect(monitorCountdown({ kind: "narration", startedAt: 0, countdown: { startAtMs: 0, endAtMs: 12_000 } } as PhaseSnapshotMessage, 500)).toBe(12);
    expect(monitorCountdown({ kind: "video", startedAt: 0 } as PhaseSnapshotMessage, 500)).toBeNull();
  });
});


describe("monitor cue countdown", () => {
  const question = { kind: "text" as const, text: "KI?", startMs: 2000, countdownSeconds: 5 };
  const next = { kind: "blank" as const, startMs: 12000 };
  it("counts only the final five seconds, including on late join", () => {
    expect(monitorCueCountdown([question, next], 6999)).toBeNull();
    expect(monitorCueCountdown([question, next], 7000)).toBe(5);
    expect(monitorCueCountdown([question, next], 11001)).toBe(1);
    expect(monitorCueCountdown([question, next], 12000)).toBeNull();
  });
  it("uses the earlier of duration and replacement and keeps gaps black", () => {
    expect(monitorCueCountdown([{ ...question, durationMs: 6000 }, next], 7000)).toBe(1);
    expect(monitorCueCountdown([{ ...question, durationMs: 6000 }, next], 8000)).toBeNull();
    expect(monitorCueCountdown([{ ...question, durationMs: 20000 }, next], 11000)).toBe(1);
  });
  it("has no deadline for indefinite holds or before the cue starts", () => {
    expect(monitorCueCountdown([question], 10000)).toBeNull();
    expect(monitorCueCountdown([question, next], 1000)).toBeNull();
  });
});

describe("monitor countdown placement", () => {
  it("replaces only text-bearing cues; scale images and videos never count down", () => {
    expect(monitorCueShowsCountdown({ kind: "text", text: "KI?", startMs: 0 })).toBe(true);
    expect(monitorCueShowsCountdown({ kind: "vote-result", fallbackText: "", startMs: 0 })).toBe(true);
    expect(monitorCueShowsCountdown({ kind: "placeholder", text: "Q", startMs: 0 })).toBe(true);
    expect(monitorCueShowsCountdown({ kind: "image", src: "scale.png", fit: "contain", startMs: 0 })).toBe(false);
    expect(monitorCueShowsCountdown({ kind: "video", src: "scale.mp4", loop: false, fit: "contain", startMs: 0 })).toBe(false);
    expect(monitorCueShowsCountdown({ kind: "blank", startMs: 0 })).toBe(false);
    expect(monitorCueShowsCountdown(null)).toBe(false);
  });
  it("shows automatic vote and scene countdowns only in the final five seconds", () => {
    expect(finalMonitorCountdown(monitorCountdown(position(), 24_000))).toBeNull();
    expect(finalMonitorCountdown(monitorCountdown(position(), 25_000))).toBe(5);
    expect(finalMonitorCountdown(monitorCountdown(position(), 29_999))).toBe(1);
    expect(finalMonitorCountdown(null)).toBeNull();
  });
});
