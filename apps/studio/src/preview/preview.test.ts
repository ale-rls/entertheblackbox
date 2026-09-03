import { describe, expect, it } from "vitest";
import scenario from "../../../../content/scenarios/dev.json";
import manifest from "../../../../content/media-manifest.json";
import { quadrantOfField, type FourQuadrantField, type TwoQuadrantField } from "../../../../packages/shared/src/index.js";
import { importRuntime } from "../io.js";
import { advancePreview, continueAfterResolution, outcomeVotes, resolvePreview, startPreview } from "./preview.js";
const project = importRuntime(scenario, manifest).project;
describe("outcome preview", () => {
  it("walks video and fixed phases manually", () => {
    let preview = advancePreview(startPreview(project));
    expect(preview.phaseId).toBe("question-fixed");
    preview = resolvePreview(preview, "q4");
    expect(preview.resolution).toMatchObject({ winner: "fixed", resolvedTarget: "question-quadrant", freezeMs: 3000 });
    expect(continueAfterResolution(preview).phaseId).toBe("question-quadrant");
  });
  it("can begin at a selected Studio node", () => {
    expect(startPreview(project, "question-quadrant").phaseId).toBe("question-quadrant");
    expect(() => startPreview(project, "missing-node")).toThrow("does not exist");
  });
  it("uses shared resolution parity for filtering, tie and empty", () => {
    let preview = startPreview({ ...project, scenario: { ...project.scenario, entryPhaseId: "question-quadrant" } });
    preview = resolvePreview(preview, "tie", false, false);
    expect(preview.resolution).toMatchObject({ winner: "tie", quadrantCounts: { q1: 1, q2: 1, q3: 0, q4: 0 }, includedTotal: 2, excludedTotal: 0 });
    preview = resolvePreview(preview, "empty");
    expect(preview.resolution).toMatchObject({ winner: "empty", resolvedTarget: "idle", includedTotal: 0, excludedTotal: 1 });
    preview = resolvePreview(preview, "q1", true, true);
    expect(preview.resolution).toMatchObject({ winner: "q1", quadrantCounts: { q1: 3, q2: 0, q3: 0, q4: 0 }, includedByStatus: { valid: 1, stale: 1, disconnected: 1 } });
  });
  it("models abandoned solo as disconnected", () => {
    const preview = resolvePreview(startPreview({ ...project, scenario: { ...project.scenario, entryPhaseId: "question-quadrant" } }), "abandoned-solo", true, false);
    expect(preview.resolution?.votes[0]).toMatchObject({ participantId: "solo", status: "disconnected" });
    expect(preview.resolution).toMatchObject({ winner: "q4", includedTotal: 1 });
  });
  it("uses the same shared oracle for two-quadrant min/max, tie, and empty", () => {
    const two = startPreview({ ...project, scenario: { ...project.scenario, entryPhaseId: "question-two-quadrant" } });
    expect(resolvePreview(two, "min", false, false).resolution).toMatchObject({ field: { type: "two-quadrant", axis: "x" }, winner: "min", quadrantCounts: { min: 1, max: 0 }, resolvedTarget: "idle" });
    expect(resolvePreview(two, "max", true, true).resolution).toMatchObject({ winner: "max", quadrantCounts: { min: 0, max: 3 } });
    expect(resolvePreview(two, "tie", false, false).resolution).toMatchObject({ winner: "tie", quadrantCounts: { min: 1, max: 1 } });
    expect(resolvePreview(two, "empty").resolution).toMatchObject({ winner: "empty", quadrantCounts: { min: 0, max: 0 } });
  });

  it("previews a curated random tie outcome pool", () => {
    const curated = {
      ...project,
      scenario: {
        ...project.scenario,
        entryPhaseId: "question-quadrant",
        phases: project.scenario.phases.map((phase) => phase.id === "question-quadrant" && phase.kind === "position-question" && phase.next.type === "quadrant-plurality"
          ? { ...phase, next: { ...phase.next, tieBreak: { type: "kleroterion" as const, candidates: ["q3", "q4"] } } }
          : phase),
      },
    };
    const resolution = resolvePreview(startPreview(curated as unknown as typeof project), "tie", false, false).resolution;
    expect(resolution?.tieBreak?.candidates).toEqual(["q3", "q4"]);
    expect(["q3", "q4"]).toContain(resolution?.tieBreak?.selected);
    const question = curated.scenario.phases.find((phase) => phase.id === "question-quadrant");
    if (!question || question.kind !== "position-question" || question.next.type !== "quadrant-plurality") throw new Error("question fixture missing");
    expect(resolution?.resolvedTarget).toBe((question.next.map as Record<string, string>)[resolution!.tieBreak!.selected]);
  });

  it("places forced-outcome votes inside the correct region of a perspective-skewed arena quad", () => {
    // A genuinely skewed trapezoid so the round-trip only passes if pointFor
    // actually accounts for the quad's shape rather than a symmetric offset.
    const arena = {
      type: "quad" as const,
      corners: [
        { x: 0.1, y: 0.1 },
        { x: 0.6, y: 0.15 },
        { x: 0.9, y: 0.9 },
        { x: 0.2, y: 0.85 },
      ] as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
    };
    const four: FourQuadrantField = {
      type: "four-quadrant",
      xAxis: { minLabel: "left", maxLabel: "right" },
      yAxis: { minLabel: "top", maxLabel: "bottom" },
      arena,
    };
    for (const quadrant of ["q1", "q2", "q3", "q4"] as const) {
      const [vote] = outcomeVotes(four, quadrant, false, false);
      expect(quadrantOfField(four, vote!.x!, vote!.y!)).toBe(quadrant);
    }

    const twoX: TwoQuadrantField = { type: "two-quadrant", axis: "x", variant: "spectrum", labels: { minLabel: "left", maxLabel: "right" }, arena };
    for (const quadrant of ["min", "max"] as const) {
      const [vote] = outcomeVotes(twoX, quadrant, false, false);
      expect(quadrantOfField(twoX, vote!.x!, vote!.y!)).toBe(quadrant);
    }
  });
});
