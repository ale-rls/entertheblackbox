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
    const value = project().scenario;
    const groups = value.groups!.map((group) => group.id === "a" ? { ...group, id: "actors", label: "The actors" } : group);
    const renamed = updateGroupCatalogue(value, groups, value.initialGroupIds!);
    const phase = renamed.phases.find((phase) => phase.kind === "group-branch")!;
    expect(phase.branches[0]!.groupId).toBe("actors");
    expect(phase.assignment).toEqual({ type: "manual", fallbackGroupId: "actors" });
    expect(renamed.initialGroupIds).toEqual(["actors", "b"]);
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
