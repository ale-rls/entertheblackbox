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

const twoQuadrantPhase = {
  ...phase,
  field: {
    type: "two-quadrant",
    axis: "x",
    labels: { minLabel: "Fakt", maxLabel: "Lüge" },
    arena: { type: "ellipse", centerX: 0.5, centerY: 0.6, radiusX: 0.42, radiusY: 0.24 },
  },
} satisfies VideoQuestionPhase;

const zonesPhase = {
  ...phase,
  field: {
    type: "polygon-zones",
    zones: [
      { id: "apollon", label: "Apollo", points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 1 }, { x: 0, y: 1 }] },
      { id: "dionysos", label: "Dionysos", points: [{ x: 0.35, y: 0 }, { x: 0.65, y: 0 }, { x: 0.65, y: 1 }, { x: 0.35, y: 1 }] },
    ],
  },
} satisfies VideoQuestionPhase;

function clockAt(now: number): ServerClock {
  return {
    now: () => now,
    remainingUntil: (deadlineAt: number) => Math.max(0, deadlineAt - now),
  } as ServerClock;
}

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

  it("never renders the dark scrim", () => {
    const html = renderToStaticMarkup(
      <VideoQuestionOverlay phase={phase} clock={clockAt(17_000)} liveField={null} liveCounts={null} resolution={null} />,
    );
    expect(html).not.toContain("question-scrim");
  });

  it("hides counts and the voting-state pill for a four-quadrant field", () => {
    const html = renderToStaticMarkup(
      <VideoQuestionOverlay
        phase={phase}
        clock={clockAt(17_000)}
        liveField={phase.field}
        liveCounts={{ q1: 1, q2: 2, q3: 3, q4: 4 }}
        resolution={null}
      />,
    );
    expect(html).not.toContain("quadrant-count");
    expect(html).not.toContain("voting-state");
  });

  it("keeps counts and the voting-state pill for the polygon-zones statue picker", () => {
    const html = renderToStaticMarkup(
      <VideoQuestionOverlay
        phase={zonesPhase}
        clock={clockAt(17_000)}
        liveField={zonesPhase.field}
        liveCounts={{ apollon: 3, dionysos: 1 }}
        resolution={null}
      />,
    );
    expect(html).toContain("zone-count");
    expect(html).toContain("voting-state");
    expect(html).toContain("Voting open");
  });

  it("shows a configurable centered countdown and only blinks the resolved winner after close", () => {
    const closeAt = twoQuadrantPhase.startedAt + twoQuadrantPhase.closeAtMs;

    // Outside the default final 5 seconds the countdown stays hidden.
    const early = renderToStaticMarkup(
      <VideoQuestionOverlay phase={twoQuadrantPhase} clock={clockAt(closeAt - 10_000)} liveField={null} liveCounts={null} resolution={null} />,
    );
    expect(early).not.toContain("countdown");

    const final = renderToStaticMarkup(
      <VideoQuestionOverlay
        phase={twoQuadrantPhase}
        clock={clockAt(closeAt - 2_000)}
        liveField={twoQuadrantPhase.field}
        liveCounts={{ min: 5, max: 2 }}
        resolution={null}
      />,
    );
    expect(final).toContain("vote-close-countdown");
    expect(final).not.toContain("arena-region-blink");
  });
});
