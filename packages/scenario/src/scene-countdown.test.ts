import { describe, expect, it } from "vitest";
import { narrationPhaseSchema, videoPhaseSchema } from "./schema.js";
import { countdownAmount, formatCountdownAmount, sceneCountdownPings, sceneCountdownSeconds, sceneCountdownText } from "./scene-countdown.js";

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

describe("amount countdowns", () => {
  it("maps the time left onto the amount and reaches 0 only at the end", () => {
    expect(countdownAmount(2_000_000, 60_000, 60_000)).toBe(2_000_000);
    expect(countdownAmount(2_000_000, 30_000, 60_000)).toBe(1_000_000);
    expect(countdownAmount(2_000_000, 1, 60_000)).toBe(34);
    expect(countdownAmount(2_000_000, 0, 60_000)).toBe(0);
    expect(countdownAmount(2_000_000, 90_000, 60_000)).toBe(2_000_000);
  });

  it("groups thousands with dots", () => {
    expect(formatCountdownAmount(2_000_000)).toBe("2.000.000");
    expect(formatCountdownAmount(1_234)).toBe("1.234");
    expect(formatCountdownAmount(999)).toBe("999");
  });

  it("shows seconds without countFrom and the amount with it", () => {
    const window = { startAtMs: 0, endAtMs: 60_000 };
    expect(sceneCountdownText(window, 15_000)).toBe("45");
    expect(sceneCountdownText({ ...window, countFrom: 2_000_000 }, 15_000)).toBe("1.500.000");
    expect(sceneCountdownText({ ...window, countFrom: 2_000_000 }, 60_000)).toBeNull();
  });
});

