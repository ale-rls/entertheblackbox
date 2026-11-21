import { describe, expect, it } from "vitest";
import { anyMonitorCountdown, shownMonitorCountdown, shownMonitorCountdownText, type MonitorCountdownPhase } from "./monitor-countdown.js";

const text = (extra: object = {}) => ({ kind: "text" as const, startMs: 0, text: "Feld", ...extra });
const vote = (monitorCues: MonitorCountdownPhase["monitorCues"]): MonitorCountdownPhase => ({
  kind: "video-position-question", startedAt: 10_000, showAtMs: 0, openAtMs: 0, closeAtMs: 20_000, hideAtMs: 22_000, monitorCues,
});

describe("what the monitors count down", () => {
  it("shows the final seconds of a vote on text monitors only", () => {
    const phase = vote({ M1: [text()], M2: [{ kind: "image", startMs: 0, src: "scale.png", fit: "contain" }] });
    expect(anyMonitorCountdown(phase, 10_000 + 14_000)).toBeNull();
    expect(anyMonitorCountdown(phase, 10_000 + 15_001)).toBe(5);
    expect(shownMonitorCountdown(phase.monitorCues!.M2!, phase, 10_000 + 15_001)).toBeNull();
    expect(anyMonitorCountdown(phase, 10_000 + 19_999)).toBe(1);
    expect(anyMonitorCountdown(phase, 10_000 + 20_000)).toBeNull();
    expect(anyMonitorCountdown(phase, 10_000 + 19_000, true)).toBeNull();
  });

  it("keeps an authored per-cue countdown at its own length", () => {
    const phase = vote({ M3: [text({ countdownSeconds: 30, durationMs: 40_000 })] });
    expect(anyMonitorCountdown(phase, 10_000 + 10_001)).toBe(30);
  });

  it("is silent with no monitor cues", () => {
    expect(anyMonitorCountdown(vote(undefined), 10_000 + 19_000)).toBeNull();
    expect(anyMonitorCountdown(null, 0)).toBeNull();
  });
});

describe("monitor amount countdowns", () => {
  it("shows a cue's countdownFrom amount over its countdown window", () => {
    const cues = [{ kind: "text" as const, text: "HACK", startMs: 0, durationMs: 60_000, countdownSeconds: 60, countdownFrom: 2_000_000 }];
    const phase = { kind: "video", startedAt: 1_000, monitorCues: { M1: cues } };
    expect(shownMonitorCountdownText(cues, phase, 1_000 + 45_000)).toBe("500.000");
    expect(shownMonitorCountdownText([{ ...cues[0]!, countdownFrom: undefined }], phase, 1_000 + 45_000)).toBe("15");
  });
});

