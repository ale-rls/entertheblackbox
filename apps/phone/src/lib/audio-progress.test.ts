import { describe, expect, it } from "vitest";
import { AudioProgress, DriftWatch, catchUpTarget, drifted } from "./audio-progress";

describe("audio recovery grace", () => {
  it("gives each reconnect a full buffering window after a stall", () => {
    const progress = new AudioProgress();
    progress.reset(12, 0);
    expect(progress.stalled(12, 15_000)).toBe(true);
    progress.reset(0, 15_500);
    expect(progress.stalled(0, 20_000)).toBe(false);
    expect(progress.stalled(0, 30_500)).toBe(true);
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

describe("drifted", () => {
  it("tolerates the shallow buffer-ahead of normal live delivery", () => {
    expect(drifted(101.5, 100)).toBe(false);
  });
  it("tolerates iOS Safari's normal several-second read-ahead (SPEC §4.3)", () => {
    expect(drifted(107, 100)).toBe(false);
  });
  it("flags a caught-up backlog as drift so the phone can resync", () => {
    expect(drifted(112, 100)).toBe(true);
  });
});

describe("catchUpTarget", () => {
  it("leaves shallow, healthy buffer-ahead alone", () => {
    expect(catchUpTarget(101.5, 100)).toBeNull();
  });
  it("jumps forward once backlog exceeds the tolerance, landing just behind the buffered edge", () => {
    expect(catchUpTarget(105, 100)).toBe(104.5);
  });
  it("never returns a target behind current position", () => {
    expect(catchUpTarget(100, 100)).toBeNull();
  });
});

describe("DriftWatch", () => {
  it("does not fire on a single bursty drifted sample", () => {
    const watch = new DriftWatch();
    expect(watch.persists(true, 0)).toBe(false);
  });
  it("fires once drift has held for the hold window", () => {
    const watch = new DriftWatch();
    expect(watch.persists(true, 0)).toBe(false);
    expect(watch.persists(true, 9_000)).toBe(false);
    expect(watch.persists(true, 10_000)).toBe(true);
  });
  it("clears the clock once the backlog resolves on its own", () => {
    const watch = new DriftWatch();
    expect(watch.persists(true, 0)).toBe(false);
    expect(watch.persists(false, 5_000)).toBe(false);
    expect(watch.persists(true, 10_000)).toBe(false);
  });
});
