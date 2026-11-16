import { describe, expect, it, vi } from "vitest";
import type { Phase } from "@entertheblackbox/scenario";
import { SurfaceCueScheduler, surfaceDeviceOrder } from "./surface-cues.js";

const effect = { kind: "breathe" as const, color: "#ffffff", periodMs: 2000 };
const scene = (surfaceCues: unknown): Phase => ({ kind: "narration", id: "t7", text: "T7", durationMs: 60_000, next: "idle", surfaceCues } as Phase);

function setup(now = 0) {
  const clock = { now };
  let running: unknown = null;
  const runner = {
    start: vi.fn((e: unknown) => { running = e; return 1; }),
    stop: vi.fn(() => { running = null; return 1; }),
    get state() { return running as never; },
  };
  const scheduler = new SurfaceCueScheduler(runner, () => ["a", "b"], { now: () => clock.now });
  return { clock, runner, scheduler };
}

describe("surface cue scheduler", () => {
  it("fires cues on the scene timeline and fills effect defaults", () => {
    vi.useFakeTimers();
    try {
      const { runner, scheduler } = setup();
      scheduler.enterPhase(scene([{ atMs: 0, action: "start", effect }, { atMs: 5000, action: "start", effect: { ...effect, kind: "wave", periodMs: 800, brightness: 0.5 } }, { atMs: 9000, action: "stop" }]), 0);
      expect(runner.start).toHaveBeenCalledWith({ kind: "breathe", color: "#ffffff", color2: "#ffffff", periodMs: 2000, brightness: 1 }, ["a", "b"]);
      vi.advanceTimersByTime(5000);
      expect(runner.start).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "wave", periodMs: 800, brightness: 0.5 }), ["a", "b"]);
      vi.advanceTimersByTime(4000);
      expect(runner.stop).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("catches up on only the latest due cue when entering late, and cancels pending cues on scene change", () => {
    vi.useFakeTimers();
    try {
      const { runner, scheduler } = setup(7000);
      scheduler.enterPhase(scene([{ atMs: 0, action: "start", effect }, { atMs: 6000, action: "start", effect: { ...effect, kind: "rainbow" } }, { atMs: 20_000, action: "stop" }]), 0);
      expect(runner.start).toHaveBeenCalledOnce();
      expect(runner.start).toHaveBeenCalledWith(expect.objectContaining({ kind: "rainbow" }), ["a", "b"]);
      scheduler.enterPhase({ kind: "video", id: "next", src: "x.mp4", expectedDurationMs: 1000, next: "idle" } as Phase, 7000);
      vi.advanceTimersByTime(30_000);
      expect(runner.stop).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("stops a cue-started effect at idle but leaves an operator's effect running", () => {
    const { runner, scheduler } = setup();
    scheduler.enterPhase(scene([{ atMs: 0, action: "start", effect }]), 0);
    scheduler.enterPhase({ kind: "idle", id: "idle" } as Phase, 0);
    expect(runner.stop).toHaveBeenCalledOnce();

    scheduler.enterPhase(scene([{ atMs: 0, action: "start", effect }]), 0);
    scheduler.operatorOverride();
    scheduler.enterPhase({ kind: "idle", id: "idle" } as Phase, 0);
    expect(runner.stop).toHaveBeenCalledOnce();
  });

  it("drops the scene's remaining cues when the operator takes over", () => {
    vi.useFakeTimers();
    try {
      const { runner, scheduler } = setup();
      scheduler.enterPhase(scene([{ atMs: 1000, action: "start", effect }]), 0);
      scheduler.operatorOverride();
      vi.advanceTimersByTime(2000);
      expect(runner.start).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("orders devices by natural label", () => {
    expect(surfaceDeviceOrder([{ clientId: "x", name: "T10" }, { clientId: "y", name: "T2" }, { clientId: "z", name: "T1" }])).toEqual(["z", "y", "x"]);
  });
});
