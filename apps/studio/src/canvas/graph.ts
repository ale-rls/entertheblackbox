import type { StudioProject } from "@smartphonecracy/studio-adapter";
import type { Connection, Edge } from "@xyflow/react";

export const ENTRY_NODE_ID = "__studio_entry__";
export const END_NODE_ID = "__studio_end__";
export const FIXED_HANDLE = "next";
export const FOUR_OUTCOME_HANDLES = ["q1", "q2", "q3", "q4", "tie", "empty"] as const;
export const TWO_OUTCOME_HANDLES = ["min", "max", "tie", "empty"] as const;
type Phase = StudioProject["scenario"]["phases"][number];
export type GraphPhase = Exclude<Phase, { kind: "idle" }>;

export function graphPhases(project: StudioProject): GraphPhase[] {
  return project.scenario.phases.filter((phase): phase is GraphPhase => phase.kind !== "idle");
}

export function acceptsInput(project: StudioProject, target: string): boolean {
  return target === END_NODE_ID || project.scenario.phases.some((phase) => phase.id === target);
}

export function withoutOutputEdge(edges: Edge[], source: string | null, sourceHandle: string | null): Edge[] {
  const handle = sourceHandle ?? FIXED_HANDLE;
  return edges.filter((edge) => edge.source !== source || (edge.sourceHandle ?? FIXED_HANDLE) !== handle);
}

export function phaseOutputHandles(phase: Phase | undefined): readonly string[] {
  if (!phase || phase.kind === "idle") return [];
  return (phase.kind === "position-question" || phase.kind === "video-position-question") && phase.next.type === "quadrant-plurality"
    ? phase.field.type === "two-quadrant"
      ? TWO_OUTCOME_HANDLES
      : phase.field.type === "polygon-zones"
        ? [...phase.field.zones.map((zone) => zone.id), "tie", "empty"]
        : FOUR_OUTCOME_HANDLES
    : [FIXED_HANDLE];
}

export function outputHandles(project: StudioProject, source: string): readonly string[] {
  if (source === ENTRY_NODE_ID) return [FIXED_HANDLE];
  if (source === END_NODE_ID) return [];
  return phaseOutputHandles(project.scenario.phases.find((item) => item.id === source));
}

export function runtimeTarget(target: string): string {
  return target === END_NODE_ID ? "idle" : target;
}

export function edgeTarget(target: string): string {
  return target === "idle" ? END_NODE_ID : target;
}

export function replacePluralityLayoutEdges(
  edges: Edge[],
  phase: Extract<Phase, { kind: "position-question" | "video-position-question" }>,
): Edge[] {
  if (phase.next.type !== "quadrant-plurality") return edges;
  const next = phase.next;
  const retained = edges.filter((edge) => edge.source !== phase.id);
  return [
    ...retained,
    ...phaseOutputHandles(phase).map((handle) => {
      const commonTarget = handle === "tie" || handle === "empty"
        ? edges.find((edge) => edge.source === phase.id && edge.sourceHandle === handle)?.target
          ?? edgeTarget(next[handle])
        : END_NODE_ID;
      return { id: `${phase.id}:${handle}`, source: phase.id, sourceHandle: handle, target: commonTarget };
    }),
  ];
}

export function graphEdges(project: StudioProject): Edge[] {
  const edges: Edge[] = [{ id: "entry", source: ENTRY_NODE_ID, sourceHandle: FIXED_HANDLE, target: edgeTarget(project.scenario.entryPhaseId) }];
  for (const phase of project.scenario.phases) {
    if (phase.kind === "idle") continue;
    if (phase.kind === "video") {
      edges.push({ id: `${phase.id}:next`, source: phase.id, sourceHandle: FIXED_HANDLE, target: edgeTarget(phase.next) });
      continue;
    }
    if (phase.next.type === "fixed") {
      const target = phase.next.target;
      edges.push({ id: `${phase.id}:next`, source: phase.id, sourceHandle: FIXED_HANDLE, target: edgeTarget(target) });
      continue;
    }
    for (const handle of outputHandles(project, phase.id)) {
      const target = handle === "tie" || handle === "empty"
        ? phase.next[handle]
        : (phase.next.map as Record<string, string>)[handle]!;
      edges.push({ id: `${phase.id}:${handle}`, source: phase.id, sourceHandle: handle, target: edgeTarget(target) });
    }
  }
  return edges;
}

export function validateConnection(project: StudioProject, edges: Edge[], connection: Connection): string | undefined {
  if (!connection.source || !connection.target) return "Both ends of the connection are required.";
  if (!acceptsInput(project, connection.target) || connection.source === END_NODE_ID) return "Entry only has outputs and End only has inputs.";
  const handle = connection.sourceHandle ?? FIXED_HANDLE;
  if (!outputHandles(project, connection.source).includes(handle)) return "That output does not exist for this node type.";
  if (edges.some((edge) => edge.source === connection.source && (edge.sourceHandle ?? FIXED_HANDLE) === handle)) {
    return connection.source === ENTRY_NODE_ID ? "A show has exactly one entry edge." : "Each output can have only one edge.";
  }
  return undefined;
}

export function pruneEdges(edges: Edge[], nodeIds: ReadonlySet<string>): Edge[] {
  return edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
}

export function applyEdges(project: StudioProject, edges: Edge[]): StudioProject {
  const edgeFor = (source: string, handle: string) => edges.find((edge) => edge.source === source && (edge.sourceHandle ?? FIXED_HANDLE) === handle);
  const entry = edgeFor(ENTRY_NODE_ID, FIXED_HANDLE);
  if (!entry) throw new Error("The entry marker must be connected.");
  const phases = project.scenario.phases.map((phase) => {
    if (phase.kind === "idle") return phase;
    if (phase.kind === "video") {
      const edge = edgeFor(phase.id, FIXED_HANDLE);
      if (!edge) throw new Error(`Phase “${phase.id}” has a dangling next output.`);
      const target = runtimeTarget(edge.target);
      return { ...phase, next: target };
    }
    if (phase.next.type === "fixed") {
      const edge = edgeFor(phase.id, FIXED_HANDLE);
      if (!edge) throw new Error(`Phase “${phase.id}” has a dangling next output.`);
      return { ...phase, next: { ...phase.next, target: runtimeTarget(edge.target) } };
    }
    const handles = outputHandles(project, phase.id);
    const targets = Object.fromEntries(handles.map((handle) => {
      const edge = edgeFor(phase.id, handle);
      if (!edge) throw new Error(`Phase “${phase.id}” has a dangling ${handle} output.`);
      return [handle, runtimeTarget(edge.target)];
    })) as Record<string, string>;
    const map = phase.field.type === "two-quadrant"
      ? { min: targets.min, max: targets.max }
      : phase.field.type === "polygon-zones"
        ? Object.fromEntries(phase.field.zones.map((zone) => [zone.id, targets[zone.id]!]))
        : { q1: targets.q1, q2: targets.q2, q3: targets.q3, q4: targets.q4 };
    return { ...phase, next: { ...phase.next, map, tie: targets.tie, empty: targets.empty } };
  });
  return { ...project, scenario: { ...project.scenario, entryPhaseId: runtimeTarget(entry.target), phases: phases as StudioProject["scenario"]["phases"] } };
}
