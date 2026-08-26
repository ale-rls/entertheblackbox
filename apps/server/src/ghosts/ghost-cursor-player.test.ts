import { afterEach, describe, expect, it, vi } from "vitest";
import { GHOST_TICK_INTERVAL_MS, GhostCursorPlayer, interpolate, type GhostCursorPlayerOptions, type GhostPool } from "./ghost-cursor-player.js";

function makePlayer(overrides: Partial<GhostCursorPlayerOptions> = {}) {
  const frames: unknown[] = [];
  const pool: GhostPool = overrides.pool ?? { tracks: [] };
  const player = new GhostCursorPlayer({
    pool,
    targetAudienceSize: () => 2,
    liveConnectedCount: () => 0,
    sessionStartedAt: () => 0,
    onFrame: (frame) => frames.push(frame),
    now: () => 0,
    colorFor: (id) => `color-${id}`,
    ...overrides,
  });
  return { player, frames };
}

describe("interpolate", () => {
  it("holds the first sample before it, and the last sample after it", () => {
    const samples = [{ t: 100, x: 0, y: 0 }, { t: 200, x: 1, y: 1 }];
    expect(interpolate(samples, 0)).toEqual({ x: 0, y: 0 });
    expect(interpolate(samples, 100)).toEqual({ x: 0, y: 0 });
    expect(interpolate(samples, 300)).toEqual({ x: 1, y: 1 });
  });

  it("linearly interpolates between the bracketing pair", () => {
    const samples = [{ t: 0, x: 0, y: 0 }, { t: 100, x: 1, y: 1 }, { t: 200, x: 1, y: 0 }];
    expect(interpolate(samples, 50)).toEqual({ x: 0.5, y: 0.5 });
    expect(interpolate(samples, 150)).toEqual({ x: 1, y: 0.5 });
  });
});

describe("GhostCursorPlayer", () => {
  afterEach(() => vi.useRealTimers());

  it("emits no ghosts with an empty pool or no active session", () => {
    const { player, frames } = makePlayer({ sessionStartedAt: () => null });
    player.selectForSession(0);
    expect(frames).toEqual([[]]);
  });

  it("selects up to targetAudienceSize recordings and replays them at session-relative elapsed time", () => {
    const pool: GhostPool = {
      tracks: [
        { recordingId: "rec-a", samples: [{ t: 0, x: 0, y: 0 }, { t: 1_000, x: 1, y: 1 }] },
        { recordingId: "rec-b", samples: [{ t: 0, x: 1, y: 0 }, { t: 1_000, x: 0, y: 1 }] },
      ],
    };
    const { player, frames } = makePlayer({ pool, targetAudienceSize: () => 2, sessionStartedAt: () => 1_000 });
    player.selectForSession(1_000);
    player.onPhaseChanged(1_500);
    const frame = frames.at(-1) as Array<{ clientId: string; x: number; y: number; ghost: boolean }>;
    expect(frame).toHaveLength(2);
    expect(frame.map((c) => c.clientId).sort()).toEqual(["ghost:rec-a", "ghost:rec-b"]);
    expect(frame.every((c) => c.ghost)).toBe(true);
    // sessionElapsed = 1500 - 1000 = 500 -> halfway between each track's two samples.
    expect(frame.find((c) => c.clientId === "ghost:rec-a")).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it("caps the rendered set at max(0, targetAudienceSize - liveConnectedCount), recomputed on phase change", () => {
    const pool: GhostPool = {
      tracks: [
        { recordingId: "rec-a", samples: [{ t: 0, x: 0, y: 0 }] },
        { recordingId: "rec-b", samples: [{ t: 0, x: 0, y: 0 }] },
      ],
    };
    let live = 0;
    const { player, frames } = makePlayer({ pool, targetAudienceSize: () => 2, liveConnectedCount: () => live, sessionStartedAt: () => 0 });
    player.selectForSession(0);
    expect((frames.at(-1) as unknown[]).length).toBe(2);

    live = 1;
    player.onPhaseChanged(0);
    expect((frames.at(-1) as unknown[]).length).toBe(1);

    live = 2;
    player.onPhaseChanged(0);
    expect(frames.at(-1)).toEqual([]);
  });

  it("silently skips a roster member with no samples rather than erroring", () => {
    const pool: GhostPool = { tracks: [{ recordingId: "rec-empty", samples: [] }] };
    const { player, frames } = makePlayer({ pool, targetAudienceSize: () => 1, sessionStartedAt: () => 0 });
    player.selectForSession(0);
    expect(frames.at(-1)).toEqual([]);
  });

  it("clear() drops the roster and emits an empty frame until the next selectForSession", () => {
    const pool: GhostPool = { tracks: [{ recordingId: "rec-a", samples: [{ t: 0, x: 0, y: 0 }] }] };
    const { player, frames } = makePlayer({ pool, targetAudienceSize: () => 1, sessionStartedAt: () => 0 });
    player.selectForSession(0);
    expect((frames.at(-1) as unknown[]).length).toBe(1);
    player.clear();
    expect(frames.at(-1)).toEqual([]);
    player.onPhaseChanged(0);
    expect(frames.at(-1)).toEqual([]);
  });

  it("ticks on its own timer while started", () => {
    vi.useFakeTimers();
    const pool: GhostPool = { tracks: [{ recordingId: "rec-a", samples: [{ t: 0, x: 0, y: 0 }] }] };
    const { player, frames } = makePlayer({ pool, targetAudienceSize: () => 1, sessionStartedAt: () => 0, now: () => 0 });
    player.start();
    player.start();
    player.selectForSession(0);
    const countAfterSelect = frames.length;
    vi.advanceTimersByTime(GHOST_TICK_INTERVAL_MS * 3);
    expect(frames.length).toBe(countAfterSelect + 3);
    player.stop();
    vi.advanceTimersByTime(GHOST_TICK_INTERVAL_MS * 3);
    expect(frames.length).toBe(countAfterSelect + 3);
  });
});
