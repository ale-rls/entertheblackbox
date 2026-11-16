import { describe, expect, it } from "vitest";
import { narrationPhaseSchema, videoPhaseSchema } from "./schema.js";
import { sceneCountdownPings, sceneCountdownSeconds } from "./scene-countdown.js";

const narration = { kind: "narration", id: "n", text: "Bauen", durationMs: 40_000, next: "end" };
const video = { kind: "video", id: "v", src: "v.mp4", expectedDurationMs: 40_000, next: "end" };

describe("scene countdown", () => {
  it("validates on video and narration scenes and stays inside the scene", () => {
    expect(narrationPhaseSchema.safeParse({ ...narration, countdown: { startAtMs: 5_000, endAtMs: 35_000, pingSeconds: 5 } }).success).toBe(true);
    expect(videoPhaseSchema.safeParse({ ...video, countdown: { startAtMs: 0, endAtMs: 40_000 } }).success).toBe(true);
    expect(narrationPhaseSchema.safeParse({ ...narration, countdown: { startAtMs: 0, endAtMs: 40_001 } }).success).toBe(false);
    expect(videoPhaseSchema.safeParse({ ...video, countdown: { startAtMs: 0, endAtMs: 40_001 } }).success).toBe(false);
    expect(videoPhaseSchema.safeParse({ ...video, countdown: { startAtMs: 10_000, endAtMs: 10_000 } }).success).toBe(false);
    expect(videoPhaseSchema.safeParse({ ...video, countdown: { startAtMs: 0, endAtMs: 1_000, pingSeconds: 61 } }).success).toBe(false);
  });

  it("counts whole seconds left inside its window only", () => {
    const countdown = { startAtMs: 5_000, endAtMs: 35_000, pingSeconds: 5 };
    expect(sceneCountdownSeconds(countdown, 4_999)).toBeNull();
    expect(sceneCountdownSeconds(countdown, 5_000)).toBe(30);
    expect(sceneCountdownSeconds(countdown, 30_001)).toBe(5);
    expect(sceneCountdownSeconds(countdown, 34_999)).toBe(1);
    expect(sceneCountdownSeconds(countdown, 35_000)).toBeNull();
    expect(sceneCountdownSeconds(undefined, 10_000)).toBeNull();
  });

  it("pings only in the final pingSeconds", () => {
    const countdown = { startAtMs: 0, endAtMs: 25_000, pingSeconds: 5 };
    expect(sceneCountdownPings(countdown, 6)).toBe(false);
    expect(sceneCountdownPings(countdown, 5)).toBe(true);
    expect(sceneCountdownPings({ startAtMs: 0, endAtMs: 25_000 }, 1)).toBe(false);
    expect(sceneCountdownPings(countdown, null)).toBe(false);
  });
});
