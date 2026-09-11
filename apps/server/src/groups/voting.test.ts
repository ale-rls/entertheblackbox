import { describe, expect, it } from "vitest";
import { quadrantOfField } from "@entertheblackbox/shared";
import { acceptsVotingInput, pointForOutcome, votingOptions } from "./voting.js";

describe("group voting methods", () => {
  it("keeps legacy cursor and physical input while enforcing configured methods", () => {
    expect(acceptsVotingInput(undefined, "physical")).toBe(true);
    expect(acceptsVotingInput(undefined, "phone-cursor")).toBe(true);
    expect(acceptsVotingInput(undefined, "phone-buttons")).toBe(false);
    expect(acceptsVotingInput("phone-buttons", "phone-buttons")).toBe(true);
    expect(acceptsVotingInput("phone-buttons", "physical")).toBe(false);
  });

  it("maps every button outcome to a point understood by the existing vote engine", () => {
    const field = {
      type: "four-quadrant" as const,
      xAxis: { minLabel: "left", maxLabel: "right" },
      yAxis: { minLabel: "front", maxLabel: "back" },
    };
    expect(votingOptions({
      kind: "position-question", id: "q", text: "Choose", field,
      durationMs: 1_000, freezeMs: 0, connectionStaleAfterMs: 1_000,
      showLiveCounts: true, next: { type: "fixed", target: "idle" },
    })).toHaveLength(4);
    for (const outcome of ["q1", "q2", "q3", "q4"]) {
      const point = pointForOutcome(field, outcome);
      expect(point).not.toBeNull();
      expect(quadrantOfField(field, point!.x, point!.y)).toBe(outcome);
    }
    expect(pointForOutcome(field, "unknown")).toBeNull();
  });
});
