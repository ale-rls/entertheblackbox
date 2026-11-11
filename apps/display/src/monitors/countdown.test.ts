import { describe, expect, it } from "vitest";
import type { PhaseSnapshotMessage } from "@entertheblackbox/protocol";
import { monitorCountdown } from "./countdown.js";

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
});
