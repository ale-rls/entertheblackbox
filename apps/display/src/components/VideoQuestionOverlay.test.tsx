import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ServerClock } from "../lib/serverClock.js";
import { VideoQuestionOverlay, videoQuestionStage, type VideoQuestionPhase } from "./VideoQuestionOverlay.js";

const phase = {
  kind: "video-position-question",
  id: "video-vote",
  title: "Internal curator title",
  src: "question.mp4",
  expectedDurationMs: 45_000,
  text: "Choose the future you want",
  field: {
    type: "four-quadrant",
    xAxis: { minLabel: "Harder", maxLabel: "Easier" },
    yAxis: { minLabel: "More important", maxLabel: "Less important" },
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

  it("shows only the question text when an internal title is also present", () => {
    const clock = {
      now: () => 17_000,
      remainingUntil: (deadlineAt: number) => deadlineAt - 17_000,
    } as ServerClock;
    const html = renderToStaticMarkup(
      <VideoQuestionOverlay
        phase={phase}
        clock={clock}
        liveField={null}
        liveCounts={null}
        resolution={null}
      />,
    );

    expect(html).toContain("Choose the future you want");
    expect(html).not.toContain("Internal curator title");
    expect(html).not.toContain("<h2");
  });
});
