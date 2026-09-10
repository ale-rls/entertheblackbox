import { describe, expect, it } from "vitest";
import { parseRuntimeScenario } from "@smartphonecracy/studio-adapter";
import scenario from "../../../../content/scenarios/dev.json";
import manifest from "../../../../content/media-manifest.json";
import { changePhaseKind, componentTypeForPhase, phaseIdError, phaseKindForComponentType, QUESTION_DEFAULTS, renamePhase } from "./model.js";
import { SessionHistory } from "./history.js";

describe("properties inspector model", () => {
  it("validates unique IDs and remaps graph targets plus keyed extensions", () => {
    const project = parseRuntimeScenario({ ...scenario, phases: scenario.phases.map((phase) => phase.id === "question-fixed" ? { ...phase, futureFlag: "kept" } : phase) }, manifest);
    expect(phaseIdError(project, "question-fixed", "idle")).toMatch("unique");
    const renamed = renamePhase(project, "question-fixed", "opening-question");
    expect(renamed.scenario.entryPhaseId).toBe("intro-video");
    const intro = renamed.scenario.phases.find((phase) => phase.id === "intro-video");
    expect(intro?.kind === "video" ? intro.next : undefined).toBe("opening-question");
    expect(JSON.stringify(renamed.runtimeExtensions.scenario)).toContain("opening-question");
    expect(JSON.stringify(renamed.runtimeExtensions.scenario)).not.toContain("question-fixed");
  });

  it("uses the director-approved defaults for new questions", () => {
    const question = changePhaseKind({ id: "idle", kind: "idle" }, "position-question");
    expect(question).toMatchObject({ field: { type: "four-quadrant" }, durationMs: QUESTION_DEFAULTS.durationMs, freezeMs: QUESTION_DEFAULTS.freezeMs, showLiveCounts: true, next: { countedStatuses: ["valid", "stale", "disconnected"] } });
  });

  it("maps runtime phases to every authorable component type", () => {
    expect(componentTypeForPhase({ id: "video", kind: "video", src: "clip.mp4", expectedDurationMs: 1_000, next: "idle" })).toBe("video");
    expect(componentTypeForPhase({ id: "still", kind: "video", src: "still.png", audioSrc: "voice.mp3", tailDurationMs: 1_000, expectedDurationMs: 2_000, next: "idle" })).toBe("image-audio");
    expect(phaseKindForComponentType("image-audio-position-question")).toBe("video-position-question");
  });

  it("undoes destructive type changes with their old connections", () => {
    const history = new SessionHistory({ kind: "position-question", edges: ["q1", "q2", "q3", "q4", "tie", "empty"] });
    history.apply({ kind: "video", edges: [] });
    expect(history.value.edges).toEqual([]);
    expect(history.undo().edges).toEqual(["q1", "q2", "q3", "q4", "tie", "empty"]);
    expect(history.redo().kind).toBe("video");
  });
});
