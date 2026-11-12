import { describe, expect, it } from "vitest";
import { parseRuntimeScenario } from "@entertheblackbox/studio-adapter";
import { groupPathOf, sceneScreens, type ScreenId } from "./screens.js";

const project = () => parseRuntimeScenario({
  version: "test", entryPhaseId: "intro", cyclesAllowed: false,
  groups: [{ id: "a", label: "Actors", votingMethod: "phone-buttons" }, { id: "b", label: "Builders", color: "#112233" }],
  participantTasks: [{ id: "t1", title: "Pick a door", question: "Which?", notificationBody: "Choose", durationMs: 5000, options: [{ id: "x", label: "X" }] }],
  monitorGroupId: "b",
  phases: [{ kind: "idle", id: "idle" },
    { kind: "narration", id: "intro", text: "Welcome", durationMs: 1000, next: "vid", tabletText: "Sit down", phoneAudioSrc: "intro.mp3",
      monitorCues: { M1: [{ kind: "text", text: "Hello", startMs: 0 }, { kind: "blank", startMs: 500 }], M2: [{ kind: "blank", startMs: 0 }] } },
    { kind: "video", id: "vid", src: "a.mp4", expectedDurationMs: 1000, next: "split", title: "Act 1", taskId: "t1",
      rating: { candidateLabel: "Ann" }, subtitles: [{ text: "Hi there", startAtMs: 0, endAtMs: 500 }] },
    { kind: "group-branch", id: "split", durationMs: 100, assignment: { type: "self-select" },
      branches: [{ groupId: "a", next: "pathA" }, { groupId: "b", next: "pathB" }], next: "vote" },
    { kind: "narration", id: "pathA", text: "A only", durationMs: 1000, next: "vote", monitorCues: { M3: [{ kind: "placeholder", text: "TBD", startMs: 0 }] } },
    { kind: "narration", id: "pathB", text: "B only", durationMs: 1000, next: "vote", monitorCues: { M3: [{ kind: "placeholder", text: "TBD", startMs: 0 }] } },
    { kind: "position-question", id: "vote", text: "Move", durationMs: 100, freezeMs: 0, connectionStaleAfterMs: 1_000, showLiveCounts: false, showCursors: false,
      answerColors: { min: "#ff0000" },
      field: { type: "two-quadrant", axis: "x", variant: "split", labels: { minLabel: "No", maxLabel: "Yes" } }, next: { type: "fixed", target: "idle" } },
  ],
}, { files: [] });

const kinds = (phaseId: string, screen: ScreenId) => sceneScreens(project(), phaseId)!.screens.find((item) => item.id === screen)!.layers.map((layer) => layer.kind);

describe("scene screen minimap", () => {
  it("returns nothing without a selected scene", () => {
    expect(sceneScreens(project(), undefined)).toBeNull();
    expect(sceneScreens(project(), "__studio_entry__")).toBeNull();
  });

  it("maps a narration to text and QR on main, its first monitor cue, and tablet text plus audio on the app", () => {
    const scene = sceneScreens(project(), "intro")!;
    expect(scene.screens.map((screen) => screen.id)).toEqual(["main", "M1", "M2", "M3", "M4", "app", "web"]);
    expect(kinds("intro", "main")).toEqual(["text", "qr", "cursors"]);
    const m1 = scene.screens.find((screen) => screen.id === "M1")!;
    expect(m1.layers).toEqual([{ kind: "text", text: "Hello" }]);
    expect(m1.cueCount).toBe(2);
    expect(kinds("intro", "M2")).toEqual([]);
    expect(kinds("intro", "M4")).toEqual([]);
    expect(kinds("intro", "app")).toEqual(["text", "audio"]);
    expect(kinds("intro", "web")).toEqual([]);
  });

  it("maps a video with title, subtitles, reactions and a task", () => {
    expect(kinds("vid", "main")).toEqual(["video", "title", "subtitles", "rating", "cursors"]);
    expect(kinds("vid", "app")).toEqual(["rating", "task"]);
    expect(kinds("vid", "web")).toEqual(["text", "rating", "task"]);
  });

  it("keeps the main display black during a split and shows self-select buttons on devices", () => {
    expect(kinds("split", "main")).toEqual([]);
    const app = sceneScreens(project(), "split")!.screens.find((screen) => screen.id === "app")!;
    expect(app.layers).toEqual([{ kind: "buttons", options: [{ label: "Actors" }, { label: "Builders", color: "#112233" }] }]);
  });

  it("puts group-path scenes on the group display and drives monitors only for the monitor group", () => {
    expect(groupPathOf(project().scenario, "pathA")).toBe("a");
    expect(groupPathOf(project().scenario, "vote")).toBeUndefined();
    const a = sceneScreens(project(), "pathA")!;
    expect(a.groupPath).toEqual({ id: "a", label: "Actors" });
    expect(a.screens[0]!.label).toBe("Group · Actors");
    expect(kinds("pathA", "M3")).toEqual([]);
    expect(kinds("pathB", "M3")).toEqual(["placeholder"]);
  });

  it("draws the vote field with answer colours, buttons for button groups and a cursor pad for the browser", () => {
    expect(kinds("vote", "main")).toEqual(["field", "text"]);
    const field = sceneScreens(project(), "vote")!.screens[0]!.layers[0]!;
    expect(field.kind === "field" && field.colors.min).toBe("#ff0000");
    expect(kinds("vote", "app")).toEqual(["buttons"]);
    expect(kinds("vote", "web")).toEqual(["cursor-pad"]);
  });
});
