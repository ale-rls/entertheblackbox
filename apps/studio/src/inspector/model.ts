import { compileStudioGraph, type StudioProject } from "@smartphonecracy/studio-adapter";

export type Phase = StudioProject["scenario"]["phases"][number];
export type PhaseKind = Phase["kind"];
export type AuthorablePhaseKind = Exclude<PhaseKind, "idle">;
export type AuthorableComponentType =
  | "video"
  | "image-audio"
  | "position-question"
  | "video-position-question"
  | "image-audio-position-question";

export function componentTypeForPhase(phase: Phase): AuthorableComponentType | "idle" {
  if (phase.kind === "idle" || phase.kind === "position-question") return phase.kind;
  if (phase.kind === "video-position-question") {
    return phase.audioSrc === undefined ? "video-position-question" : "image-audio-position-question";
  }
  return phase.audioSrc === undefined ? "video" : "image-audio";
}

export function phaseKindForComponentType(type: AuthorableComponentType): AuthorablePhaseKind {
  if (type === "image-audio") return "video";
  if (type === "image-audio-position-question") return "video-position-question";
  return type;
}

export function isImageAudioComponentType(type: AuthorableComponentType): boolean {
  return type === "image-audio" || type === "image-audio-position-question";
}

export const QUESTION_DEFAULTS = {
  durationMs: 60_000,
  freezeMs: 5_000,
  showLiveCounts: true,
  countedStatuses: ["valid", "stale", "disconnected"] as const,
};

export function phaseIdError(project: StudioProject, currentId: string, nextId: string): string | undefined {
  if (currentId === "idle" && nextId !== "idle") return "The idle runtime ID is fixed.";
  if (!nextId.trim()) return "Runtime ID is required.";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(nextId)) return "Use letters, numbers, hyphens, or underscores.";
  if (nextId !== currentId && project.scenario.phases.some((phase) => phase.id === nextId)) return "Runtime ID must be unique.";
  return undefined;
}

export function renamePhase(project: StudioProject, currentId: string, nextId: string): StudioProject {
  const problem = phaseIdError(project, currentId, nextId);
  if (problem) throw new Error(problem);
  const remap = (value: string) => value === currentId ? nextId : value;
  const phases = project.scenario.phases.map((phase) => {
    const id = remap(phase.id);
    if (phase.kind === "idle") return { ...phase, id };
    if (phase.kind === "video") return { ...phase, id, next: remap(phase.next) };
    if (phase.next.type === "fixed") return { ...phase, id, next: { ...phase.next, target: remap(phase.next.target) } };
    return { ...phase, id, next: { ...phase.next, map: Object.fromEntries(Object.entries(phase.next.map).map(([key, value]) => [key, remap(value)])) as typeof phase.next.map, tie: remap(phase.next.tie), empty: remap(phase.next.empty) } };
  }) as StudioProject["scenario"]["phases"];
  const extensions = structuredClone(project.runtimeExtensions.scenario);
  const phaseSidecar = (extensions.phases as { __studioItems?: Record<string, unknown> } | undefined)?.__studioItems;
  if (phaseSidecar && Object.hasOwn(phaseSidecar, currentId)) {
    phaseSidecar[nextId] = phaseSidecar[currentId];
    delete phaseSidecar[currentId];
  }
  return { ...project, scenario: { ...project.scenario, entryPhaseId: remap(project.scenario.entryPhaseId), phases }, runtimeExtensions: { ...project.runtimeExtensions, scenario: extensions } };
}

export function changePhaseKind(phase: Phase, kind: PhaseKind): Phase {
  if (phase.kind === kind) return phase;
  if (kind === "idle") return { id: "idle", kind };
  if (kind === "video") return { id: phase.id, kind, src: "media/new-video.mp4", expectedDurationMs: 1_000, next: "idle" };
  if (kind === "video-position-question") return {
    id: phase.id,
    kind,
    src: "media/new-video.mp4",
    expectedDurationMs: 40_000,
    text: "New position question",
    field: {
      type: "four-quadrant",
      xAxis: { minLabel: "Left", maxLabel: "Right" },
      yAxis: { minLabel: "Top", maxLabel: "Bottom" },
    },
    showAtMs: 0,
    openAtMs: 15_000,
    closeAtMs: 20_000,
    hideAtMs: 25_000,
    closeCountdownSeconds: 5,
    connectionStaleAfterMs: 10_000,
    showLiveCounts: QUESTION_DEFAULTS.showLiveCounts,
    next: { type: "quadrant-plurality", map: { q1: "idle", q2: "idle", q3: "idle", q4: "idle" }, tie: "idle", empty: "idle", countedStatuses: [...QUESTION_DEFAULTS.countedStatuses] },
  };
  return {
    id: phase.id, kind, text: "New position question",
    field: {
      type: "four-quadrant",
      xAxis: { minLabel: "Left", maxLabel: "Right" },
      yAxis: { minLabel: "Top", maxLabel: "Bottom" },
    },
    durationMs: QUESTION_DEFAULTS.durationMs, freezeMs: QUESTION_DEFAULTS.freezeMs,
    connectionStaleAfterMs: 10_000, showLiveCounts: QUESTION_DEFAULTS.showLiveCounts,
    next: { type: "quadrant-plurality", map: { q1: "idle", q2: "idle", q3: "idle", q4: "idle" }, tie: "idle", empty: "idle", countedStatuses: [...QUESTION_DEFAULTS.countedStatuses] },
  };
}

export function compiledJson(project: StudioProject): string {
  try { return JSON.stringify(compileStudioGraph(project).scenario, null, 2); }
  catch (error) { return `Cannot compile yet: ${error instanceof Error ? error.message : String(error)}`; }
}
