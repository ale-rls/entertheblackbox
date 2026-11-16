import { describe, expect, it } from "vitest";
import { videoPositionQuestionPhaseSchema } from "./schema.js";
import { voteCountdownSeconds, withVoteCountdownSeconds } from "./vote-countdown.js";

describe("vote countdown length", () => {
  it("defaults to 5 and prefers the free length over the legacy field", () => {
    expect(voteCountdownSeconds({})).toBe(5);
    expect(voteCountdownSeconds({ closeCountdownSeconds: 10 })).toBe(10);
    expect(voteCountdownSeconds({ closeCountdownSeconds: 5, voteCountdownSeconds: 12 })).toBe(12);
  });

  it("keeps 5 and 10 in the legacy field and other lengths out of it", () => {
    expect(withVoteCountdownSeconds({ voteCountdownSeconds: 12 }, 10)).toEqual({ closeCountdownSeconds: 10 });
    expect(withVoteCountdownSeconds({ closeCountdownSeconds: 5 as const }, 12)).toEqual({ voteCountdownSeconds: 12 });
    expect(withVoteCountdownSeconds({}, 0)).toEqual({ voteCountdownSeconds: 1 });
    expect(withVoteCountdownSeconds({}, 99)).toEqual({ voteCountdownSeconds: 60 });
  });

  it("validates the free length and stays readable by the legacy schema", () => {
    const base = {
      kind: "video-position-question", id: "q", src: "q.mp4", expectedDurationMs: 30_000, text: "Q?",
      showAtMs: 0, openAtMs: 1_000, closeAtMs: 20_000, hideAtMs: 25_000, connectionStaleAfterMs: 10_000, showLiveCounts: false,
      field: { type: "two-quadrant", axis: "x", variant: "split", labels: { minLabel: "A", maxLabel: "B" } },
      next: { type: "fixed", target: "end" },
    };
    expect(videoPositionQuestionPhaseSchema.safeParse({ ...base, voteCountdownSeconds: 12 }).success).toBe(true);
    expect(videoPositionQuestionPhaseSchema.safeParse({ ...base, voteCountdownSeconds: 0 }).success).toBe(false);
    expect(videoPositionQuestionPhaseSchema.safeParse({ ...base, voteCountdownSeconds: 61 }).success).toBe(false);
    expect(videoPositionQuestionPhaseSchema.safeParse({ ...base, voteCountdownSeconds: 2.5 }).success).toBe(false);
  });
});
