import { describe, expect, it } from "vitest";
import type { VideoQuestionPhase } from "./VideoQuestionOverlay.js";
import { videoQuestionStage } from "./VideoQuestionOverlay.js";

const phase = {
  kind: "video-position-question",
  id: "video-vote",
  src: "question.mp4",
  expectedDurationMs: 45_000,
  text: "Choose",
  field: {
    type: "four-quadrant",
    xAxis: { minLabel: "Left", maxLabel: "Right" },
    yAxis: { minLabel: "Top", maxLabel: "Bottom" },
  },
  showAtMs: 15_000,
  openAtMs: 16_000,
  closeAtMs: 36_000,
  hideAtMs: 41_000,
  connectionStaleAfterMs: 10_000,
  showLiveCounts: true,
  next: { type: "fixed", target: "idle" },
  scenarioVersion: "1",
  startedAt: 1_000,
  deadlineAt: 51_000,
} satisfies VideoQuestionPhase;

describe("videoQuestionStage", () => {
  it("follows the show, open, close, and hide boundaries", () => {
    expect(videoQuestionStage(phase, 15_999)).toBe("hidden");
    expect(videoQuestionStage(phase, 16_000)).toBe("shown");
    expect(videoQuestionStage(phase, 17_000)).toBe("open");
    expect(videoQuestionStage(phase, 37_000)).toBe("closed");
    expect(videoQuestionStage(phase, 42_000)).toBe("hidden");
  });
});
