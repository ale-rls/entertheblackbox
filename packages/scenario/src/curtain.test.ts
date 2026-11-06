import { describe, expect, it } from "vitest";
import { curtainStagePhaseIds, scenarioSchema, validateScenario } from "./index.js";

function scenario(overrides: { field?: unknown; curtainSrc?: string | null; answerColors?: Record<string, string> } = {}) {
  const field = overrides.field ?? { type: "two-quadrant", axis: "x", variant: "split", labels: { minLabel: "No", maxLabel: "Yes" } };
  return scenarioSchema.parse({
    version: "t",
    entryPhaseId: "split",
    groups: [
      { id: "theater", label: "Theater", votingMethod: "phone-cursor", voteTreatment: "curtain-light" },
      { id: "ki", label: "KI", votingMethod: "phone-cursor" },
    ],
    ...(overrides.curtainSrc === null ? {} : { curtainLight: { src: overrides.curtainSrc ?? "curtain.mp4" } }),
    phases: [
      { kind: "idle", id: "idle" },
      {
        kind: "group-branch", id: "split", assignment: { type: "self-select" }, durationMs: 1000, next: "reunion",
        branches: [{ groupId: "theater", next: "theater-vote" }, { groupId: "ki", next: "ki-vote" }],
      },
      ...["theater-vote", "ki-vote"].map((id) => ({
        kind: "position-question", id, text: "Q?", durationMs: 1000, freezeMs: 0, connectionStaleAfterMs: 1000,
        showLiveCounts: false, field, next: { type: "fixed", target: "reunion" },
        ...(overrides.answerColors ? { answerColors: overrides.answerColors } : {}),
      })),
      { kind: "narration", id: "reunion", text: "Together", durationMs: 1000, next: "idle" },
    ],
  });
}

const manifest = { files: [{ src: "curtain.mp4", bytes: 1, hash: "x" }] };

describe("curtain-light stages", () => {
  it("covers only votes on the curtain group's own path", () => {
    expect([...curtainStagePhaseIds(scenario())]).toEqual(["theater-vote"]);
  });

  it("accepts a two-way vote once the default gap is applied", () => {
    const result = validateScenario(scenario(), manifest);
    expect(result.errors).toEqual([]);
  });

  it("requires the shared curtain video, from the media library", () => {
    expect(validateScenario(scenario({ curtainSrc: null })).errors.map((issue) => issue.code)).toContain("curtain-light");
    expect(validateScenario(scenario(), { files: [] }).errors.map((issue) => issue.code)).toContain("missing-media");
  });

  it("rejects layouts with no neutral entry or an unusable answer", () => {
    const covering = { type: "polygon-zones", zones: [
      { id: "a", label: "A", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
      { id: "b", label: "B", points: [{ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.5 }, { x: 0.501, y: 0.501 }] },
    ] };
    const messages = validateScenario(scenario({ field: covering }), manifest).errors.map((issue) => issue.message).join("\n");
    expect(messages).toMatch(/no neutral space/);
    expect(messages).toMatch(/answer "b" has no usable counting area/);
  });

  it("warns about labels too long to read and colours for unknown answers", () => {
    const field = { type: "two-quadrant", axis: "x", variant: "split", labels: { minLabel: "A rather long answer label for a pool", maxLabel: "Yes" } };
    const warnings = validateScenario(scenario({ field, answerColors: { nope: "#ffffff" } }), manifest).warnings.map((issue) => issue.message).join("\n");
    expect(warnings).toMatch(/may not be readable/);
    expect(warnings).toMatch(/unknown answer "nope"/);
  });
});
