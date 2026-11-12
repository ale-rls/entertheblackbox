import { describe, expect, it } from "vitest";
import { parseRuntimeScenario } from "@entertheblackbox/studio-adapter";
import { setGroupOptions, updateGroupCatalogue } from "./groups.js";
import { applyEdges, graphEdges, phaseOutputHandles, reconcilePhaseOutputEdges } from "../canvas/graph.js";
import { nodeDataForPhase } from "../canvas/nodes.js";
import { renamePhase } from "./model.js";
import { advancePreview, startPreview } from "../preview/preview.js";

const project = () => parseRuntimeScenario({
  version: "test", entryPhaseId: "split", cyclesAllowed: false,
  groups: [{ id: "a", label: "Actors" }, { id: "b", label: "Builders" }, { id: "c", label: "Chorus" }], initialGroupIds: ["a", "b"],
  phases: [{ kind: "idle", id: "idle" },
    { kind: "group-branch", id: "split", durationMs: 100, assignment: { type: "manual", fallbackGroupId: "a" },
      branches: [{ groupId: "a", next: "scene", weight: 2 }, { groupId: "b", next: "idle" }], next: "idle" },
    { kind: "position-question", id: "scene", text: "Move", durationMs: 100, freezeMs: 0, connectionStaleAfterMs: 1_000, showLiveCounts: false,
      field: { type: "two-quadrant", axis: "x", variant: "split", labels: { minLabel: "No", maxLabel: "Yes" } }, next: { type: "fixed", target: "idle" } },
  ],
}, { files: [] });
const split = (value = project()) => value.scenario.phases.find((phase) => phase.kind === "group-branch")!;

describe("editable group scene options", () => {
  it("adds catalogue groups to existing scenes and preserves authored connections and weights", () => {
    const value = project();
    const phase = setGroupOptions(split(value), ["a", "b", "c"]);
    expect(phase.branches[0]).toEqual({ groupId: "a", next: "scene", weight: 2 });
    const edges = reconcilePhaseOutputEdges(graphEdges(value), phase);
    expect(phaseOutputHandles(phase)).toEqual(["group:a", "group:b", "group:c", "next"]);
    const edited = { ...value, scenario: { ...value.scenario, phases: value.scenario.phases.map((old) => old.id === phase.id ? phase : old) as typeof value.scenario.phases } };
    const compiled = applyEdges(edited, edges);
    expect(split(compiled).branches.map((branch) => branch.next)).toEqual(["scene", "idle", "idle"]);
    expect(nodeDataForPhase(phase, value.scenario.groups).outcomes?.map((port) => port.label)).toEqual(["Actors", "Builders", "Chorus", "Rejoin (all groups)"]);
  });

  it("removes scene options and their edges, repairing fallback assignments", () => {
    const value = project();
    const expanded = setGroupOptions(split(value), ["a", "b", "c"]);
    const phase = setGroupOptions(expanded, ["b", "c"]);
    expect(phase.assignment).toEqual({ type: "manual", fallbackGroupId: "b" });
    expect(reconcilePhaseOutputEdges(graphEdges(value), phase).some((edge) => edge.sourceHandle === "group:a")).toBe(false);
    expect(() => setGroupOptions(phase, ["b"])).toThrow(/at least two/);
    expect(() => setGroupOptions(phase, ["b", "b"])).toThrow(/different/);
  });

  it("renames groups throughout the scenario and blocks deletions that leave an invalid scene", () => {
    const value = { ...project().scenario, monitorGroupId: "a", groupByClient: { native: "a", web: "c" } };
    const groups = value.groups!.map((group) => group.id === "a" ? { ...group, id: "actors", label: "The actors" } : group);
    const renamed = updateGroupCatalogue(value, groups, value.initialGroupIds!);
    const phase = renamed.phases.find((phase) => phase.kind === "group-branch")!;
    expect(phase.branches[0]!.groupId).toBe("actors");
    expect(phase.assignment).toEqual({ type: "manual", fallbackGroupId: "actors" });
    expect(renamed.monitorGroupId).toBe("actors");
    expect(renamed.initialGroupIds).toEqual(["actors", "b"]);
    expect(renamed.groupByClient).toEqual({ native: "actors", web: "c" });
    expect(() => updateGroupCatalogue(value, value.groups!.filter((group) => group.id !== "a"), ["b", "c"])).toThrow(/fewer than two/);
    expect(() => updateGroupCatalogue(value, [value.groups![0]!], ["a"])).toThrow(/at least two/);
  });

  it("round trips distinct ports, renames path targets and previews the chosen group", () => {
    const value = project();
    expect(applyEdges(value, graphEdges(value)).scenario).toEqual(value.scenario);
    expect(split(renamePhase(value, "scene", "renamed")).branches[0]!.next).toBe("renamed");
    const preview = startPreview(value);
    expect(advancePreview(preview, "a").phaseId).toBe("scene");
    expect(advancePreview(preview, "b").phaseId).toBe("idle");
    expect(() => advancePreview(preview, "unknown")).toThrow(/Unknown group/);
  });
});

describe("tablet text by group", () => {
  it("survives import and follows group renames and removals", () => {
    const value = parseRuntimeScenario({
      version: "test", entryPhaseId: "scene", cyclesAllowed: false,
      groups: [{ id: "a", label: "Actors" }, { id: "b", label: "Builders" }, { id: "c", label: "Chorus" }],
      phases: [{ kind: "idle", id: "idle" },
        { kind: "narration", id: "scene", text: "Display", durationMs: 100, next: "idle",
          tabletText: "Everyone", tabletTextByGroup: { a: "Actors only", b: "" } }],
    }, { files: [] });
    const scene = (s: typeof value.scenario) => s.phases.find((phase) => phase.id === "scene") as { tabletText?: string; tabletTextByGroup?: Record<string, string> };
    expect(scene(value.scenario)).toMatchObject({ tabletText: "Everyone", tabletTextByGroup: { a: "Actors only", b: "" } });
    const renamed = updateGroupCatalogue(value.scenario, [{ id: "actors", label: "Actors" }, { id: "b", label: "Builders" }, { id: "c", label: "Chorus" }], []);
    expect(scene(renamed).tabletTextByGroup).toEqual({ actors: "Actors only", b: "" });
    const removed = updateGroupCatalogue(renamed, [{ id: "actors", label: "Actors" }, { id: "c", label: "Chorus" }], []);
    expect(scene(removed).tabletTextByGroup).toEqual({ actors: "Actors only" });
  });
});

describe("tablet script groups", () => {
  it("carries scene groups and speakers through group renames and removals", () => {
    const value = parseRuntimeScenario({
      version: "test", entryPhaseId: "scene", cyclesAllowed: false,
      groups: [{ id: "a", label: "Actors" }, { id: "b", label: "Builders" }, { id: "c", label: "Chorus" }],
      actorScript: { title: "Act", text: "A: one\n\nB: two", speakersByGroup: { a: "A", b: "B" } },
      phases: [{ kind: "idle", id: "idle" },
        { kind: "narration", id: "scene", text: "Display", durationMs: 100, next: "idle", tabletScript: { fromParagraph: 0, toParagraph: 1, groupIds: ["a", "b"] } }],
    }, { files: [] });
    const scene = (s: typeof value.scenario) => (s.phases.find((phase) => phase.id === "scene") as { tabletScript?: { groupIds: string[] } }).tabletScript;
    const renamed = updateGroupCatalogue(value.scenario, [{ id: "actors", label: "Actors" }, { id: "b", label: "Builders" }, { id: "c", label: "Chorus" }], []);
    expect([scene(renamed)?.groupIds, renamed.actorScript?.speakersByGroup]).toEqual([["actors", "b"], { actors: "A", b: "B" }]);
    const removed = updateGroupCatalogue(renamed, [{ id: "actors", label: "Actors" }, { id: "c", label: "Chorus" }], []);
    expect([scene(removed)?.groupIds, removed.actorScript?.speakersByGroup]).toEqual([["actors"], { actors: "A" }]);
  });
});
