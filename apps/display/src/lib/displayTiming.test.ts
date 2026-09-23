import { afterEach, expect, it, vi } from "vitest";
import { ServerClock } from "@entertheblackbox/shared";
import type { PhaseSnapshotMessage } from "@entertheblackbox/protocol";
import { readDisplayTiming } from "./displayTiming.js";
const phase = { kind: "video", startedAt: 1000, syncVideoOffsetMs: 200 } as PhaseSnapshotMessage;
const media = (values = {}) => ({ currentTime: 3.4, duration: 10, readyState: 4, paused: false, seeking: false, ended: false, error: null, ...values }) as HTMLMediaElement;
afterEach(() => vi.useRealTimers());
it("reports main and extra positions against corrected cue time", () => {
  vi.useFakeTimers(); vi.setSystemTime(4000);
  const clock = new ServerClock(); clock.addSample(4000, 4000, 4500);
  expect(readDisplayTiming(clock, phase, media(), media({ currentTime: 2.8 }))).toMatchObject({ calibrated: true, offsetMs: 500, elapsedMs: 3500,
    media: [{ role: "main", targetMs: 3300, driftMs: 100, state: "playing" }, { role: "extra", targetMs: 3300, driftMs: -500 }] });
});
it("does not label a held final frame as drifting beyond media duration", () => {
  vi.useFakeTimers(); vi.setSystemTime(20000);
  const clock = new ServerClock(); clock.addSample(20000, 20000, 20000);
  expect(readDisplayTiming(clock, phase, media({ currentTime: 9.999, paused: true }), null).media[0]).toMatchObject({ targetMs: 10000, driftMs: -1, state: "ended" });
  expect(readDisplayTiming(clock, null, media(), null).media).toEqual([]);
});
