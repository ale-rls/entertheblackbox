import { describe, expect, it } from "vitest";
import { parseRuntimeScenario } from "@smartphonecracy/studio-adapter";
import scenario from "../../../../content/scenarios/dev.json";
import manifest from "../../../../content/media-manifest.json";
import { acceptsInput, applyEdges, END_NODE_ID, ENTRY_NODE_ID, graphEdges, graphPhases, outputHandles, phaseOutputHandles, pruneEdges, reconcilePhaseOutputEdges, replacePluralityLayoutEdges, validateConnection, withoutOutputEdge } from "./graph.js";

const project = () => parseRuntimeScenario(structuredClone(scenario), manifest);

describe("Studio canvas graph", () => {
  it("represents the runtime idle phase only through the editor End node", () => {
    const value = project();
    expect(value.scenario.phases.some((phase) => phase.kind === "idle")).toBe(true);
    expect(graphPhases(value).map((phase) => phase.id)).not.toContain("idle");
    expect(graphEdges(value).some((edge) => edge.target === END_NODE_ID)).toBe(true);
  });

  it("renders the typed runtime outputs and compiles editor markers away", () => {
    const value = project();
    const edges = graphEdges(value);
    expect(outputHandles(value, "question-quadrant")).toEqual(["q1", "q2", "q3", "q4", "tie", "empty"]);
    expect(outputHandles(value, "question-two-quadrant")).toEqual(["min", "max", "tie", "empty"]);
    expect(acceptsInput(value, "question-quadrant")).toBe(true);
    expect(acceptsInput(value, END_NODE_ID)).toBe(true);
    expect(acceptsInput(value, ENTRY_NODE_ID)).toBe(false);
    expect(edges.find((edge) => edge.source === ENTRY_NODE_ID)).toBeTruthy();
    expect(edges.some((edge) => edge.target === END_NODE_ID)).toBe(true);
    expect(applyEdges(value, edges).scenario).toEqual(value.scenario);
  });

  it("keeps two-quadrant handles correlated with their min/max runtime map", () => {
    const value = project();
    const edges = graphEdges(value);
    expect(edges.filter((edge) => edge.source === "question-two-quadrant").map((edge) => edge.sourceHandle)).toEqual(["min", "max", "tie", "empty"]);
    expect(validateConnection(value, edges.filter((edge) => edge.source !== "question-two-quadrant"), { source: "question-two-quadrant", sourceHandle: "q1", target: END_NODE_ID, targetHandle: null })).toMatch(/does not exist/);
    expect(applyEdges(value, edges).scenario.phases.find((phase) => phase.id === "question-two-quadrant")).toMatchObject({ field: { type: "two-quadrant", axis: "x" }, next: { map: { min: "idle", max: "idle" } } });
  });

  it("derives node handles directly from the current phase shape", () => {
    const phases = project().scenario.phases;
    expect(phaseOutputHandles(phases.find((phase) => phase.id === "question-quadrant"))).toEqual(["q1", "q2", "q3", "q4", "tie", "empty"]);
    expect(phaseOutputHandles(phases.find((phase) => phase.id === "question-two-quadrant"))).toEqual(["min", "max", "tie", "empty"]);
    expect(phaseOutputHandles(phases.find((phase) => phase.id === "question-fixed"))).toEqual(["next"]);
  });

  it("round-trips polygon-zone outputs by their authored zone IDs", () => {
    const value = project();
    const election = {
      kind: "position-question" as const,
      id: "statue-election",
      text: "Choose a statue",
      field: {
        type: "polygon-zones" as const,
        zones: [
          { id: "openapollo", label: "OpenApollo", points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 1 }, { x: 0, y: 1 }] },
          { id: "dionysos69", label: "Dionysos69", points: [{ x: 0.35, y: 0 }, { x: 0.65, y: 0 }, { x: 0.65, y: 1 }, { x: 0.35, y: 1 }] },
          { id: "kassandra", label: "Kassandra", points: [{ x: 0.7, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.7, y: 1 }] },
        ],
      },
      durationMs: 90_000,
      freezeMs: 10_000,
      connectionStaleAfterMs: 10_000,
      showLiveCounts: false,
      next: {
        type: "quadrant-plurality" as const,
        map: { openapollo: "intro-video", dionysos69: "question-fixed", kassandra: "idle" },
        tie: "idle",
        empty: "idle",
        countedStatuses: ["valid" as const, "stale" as const, "disconnected" as const],
      },
    };
    const withElection = parseRuntimeScenario({
      ...value.scenario,
      phases: [...value.scenario.phases, election],
    }, value.manifest);
    const handles = outputHandles(withElection, election.id);
    expect(handles).toEqual(["openapollo", "dionysos69", "kassandra", "tie", "empty"]);
    const edges = graphEdges(withElection);
    expect(edges.filter((edge) => edge.source === election.id).map((edge) => edge.sourceHandle)).toEqual(handles);
    expect(applyEdges(withElection, edges).scenario.phases.find((phase) => phase.id === election.id)).toEqual(election);

    const addedZone = { id: "sokrates", label: "Sokrates", points: [{ x: 0.4, y: 0.2 }, { x: 0.6, y: 0.2 }, { x: 0.5, y: 0.5 }] };
    const expanded = { ...election, field: { ...election.field, zones: [...election.field.zones, addedZone] }, next: { ...election.next, map: { ...election.next.map, sokrates: "idle" } } };
    const expandedProject = parseRuntimeScenario({ ...withElection.scenario, phases: withElection.scenario.phases.map((phase) => phase.id === election.id ? expanded : phase) }, withElection.manifest);
    const expandedPhase = expandedProject.scenario.phases.find((phase) => phase.id === election.id)!;
    const expandedEdges = reconcilePhaseOutputEdges(edges, expandedPhase);
    expect(expandedEdges.find((edge) => edge.sourceHandle === "openapollo")?.target).toBe("intro-video");
    expect(expandedEdges.find((edge) => edge.sourceHandle === "sokrates")?.target).toBe(END_NODE_ID);

    const reduced = { ...expanded, field: { ...expanded.field, zones: [addedZone] }, next: { ...expanded.next, map: { sokrates: "idle" } } };
    const reducedProject = parseRuntimeScenario({ ...expandedProject.scenario, phases: expandedProject.scenario.phases.map((phase) => phase.id === election.id ? reduced : phase) }, expandedProject.manifest);
    const reducedPhase = reducedProject.scenario.phases.find((phase) => phase.id === election.id)!;
    const reducedEdges = reconcilePhaseOutputEdges(expandedEdges, reducedPhase);
    expect(reducedEdges.filter((edge) => edge.source === election.id).map((edge) => edge.sourceHandle)).toEqual(["sokrates", "tie", "empty"]);
  });

  it("preserves tie and empty routes when replacing only spatial layout outputs", () => {
    const value = project();
    const original = value.scenario.phases.find((phase) => phase.id === "question-quadrant");
    if (!original || original.kind !== "position-question" || original.field.type !== "four-quadrant" || original.next.type !== "quadrant-plurality") throw new Error("fixture question missing");
    const labels = original.field.xAxis;
    const routed = {
      ...original,
      next: { ...original.next, tie: "intro-video", empty: "question-fixed" },
    };
    const routedProject = {
      ...value,
      scenario: { ...value.scenario, phases: value.scenario.phases.map((phase) => phase.id === routed.id ? routed : phase) as typeof value.scenario.phases },
    };
    const switched = {
      ...routed,
      field: { type: "two-quadrant" as const, axis: "x" as const, variant: "spectrum" as const, labels },
      next: { ...routed.next, map: { min: "idle", max: "idle" } },
    };
    const switchedProject = {
      ...routedProject,
      scenario: { ...routedProject.scenario, phases: routedProject.scenario.phases.map((phase) => phase.id === switched.id ? switched : phase) as typeof routedProject.scenario.phases },
    };
    const nextEdges = replacePluralityLayoutEdges(graphEdges(routedProject), switched);
    expect(nextEdges.find((edge) => edge.id === `${switched.id}:tie`)?.target).toBe("intro-video");
    expect(nextEdges.find((edge) => edge.id === `${switched.id}:empty`)?.target).toBe("question-fixed");
    expect(applyEdges(switchedProject, nextEdges).scenario.phases.find((phase) => phase.id === switched.id)).toMatchObject({
      next: { map: { min: "idle", max: "idle" }, tie: "intro-video", empty: "question-fixed" },
    });
  });

  it("enforces one edge per typed output while allowing shared targets", () => {
    const value = project();
    const edges = graphEdges(value).filter((edge) => edge.source !== "question-quadrant");
    expect(validateConnection(value, edges, { source: "question-quadrant", sourceHandle: "q1", target: END_NODE_ID, targetHandle: null })).toBeUndefined();
    const withQ1 = [...edges, { id: "q1", source: "question-quadrant", sourceHandle: "q1", target: END_NODE_ID }];
    expect(validateConnection(value, withQ1, { source: "question-quadrant", sourceHandle: "q2", target: END_NODE_ID, targetHandle: null })).toBeUndefined();
    expect(validateConnection(value, withQ1, { source: "question-quadrant", sourceHandle: "q1", target: "intro-video", targetHandle: null })).toMatch(/only one edge/);
    expect(validateConnection(value, edges, { source: ENTRY_NODE_ID, sourceHandle: "next", target: "intro-video", targetHandle: null })).toMatch(/exactly one entry/);
    expect(validateConnection(value, edges, { source: "question-quadrant", sourceHandle: "q1", target: "missing", targetHandle: null })).toMatch(/only has inputs/);
    const rewiringEntry = withoutOutputEdge(graphEdges(value), ENTRY_NODE_ID, "next");
    expect(validateConnection(value, rewiringEntry, { source: ENTRY_NODE_ID, sourceHandle: "next", target: "question-fixed", targetHandle: "input" })).toBeUndefined();
    expect(rewiringEntry.some((edge) => edge.source === ENTRY_NODE_ID)).toBe(false);
  });

  it("cleans every attached edge when a node is deleted and rejects dangling compile", () => {
    const value = project();
    const edges = graphEdges(value);
    const remaining = new Set([ENTRY_NODE_ID, END_NODE_ID, "idle", "intro-video", "question-quadrant"]);
    const pruned = pruneEdges(edges, remaining);
    expect(pruned.some((edge) => edge.source === "question-fixed" || edge.target === "question-fixed")).toBe(false);
    expect(() => applyEdges(value, pruned)).toThrow(/dangling/);
  });
});
