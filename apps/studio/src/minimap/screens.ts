import type { StudioProject } from "@entertheblackbox/studio-adapter";
import { resolveAnswerColors, type PositionField } from "../../../../packages/shared/src/index.js";
import { scriptParagraphs } from "../../../../packages/scenario/src/actor-script.js";
import { curtainStagePhaseIds } from "../../../../packages/scenario/src/index.js";

type Scenario = StudioProject["scenario"];
type Phase = Scenario["phases"][number];
type MonitorCue = NonNullable<NonNullable<Extract<Phase, { kind: "video" }>["monitorCues"]>["M1"]>[number];

export type ScreenId = "main" | "M1" | "M2" | "M3" | "M4" | "app" | "web";
export type ScreenOption = { label: string; color?: string };

/** One visible element on a screen, drawn schematically by the minimap. */
export type ScreenLayer =
  | { kind: "video"; src: string; loop?: boolean }
  | { kind: "image"; src: string }
  | { kind: "attract" }
  | { kind: "title"; text: string }
  | { kind: "text"; text: string; color?: string }
  | { kind: "placeholder"; text: string }
  | { kind: "subtitles" }
  | { kind: "qr" }
  | { kind: "field"; field: PositionField; colors: Record<string, string>; curtain: boolean }
  | { kind: "cursors" }
  | { kind: "rating" }
  | { kind: "cursor-pad" }
  | { kind: "buttons"; options: ScreenOption[] }
  | { kind: "script"; lines: string[] }
  | { kind: "task"; title: string }
  | { kind: "audio" };

export type Screen = {
  id: ScreenId;
  label: string;
  orientation: "landscape" | "portrait";
  layers: ScreenLayer[];
  /** Total timed cues on a stage monitor; the minimap draws the first. */
  cueCount?: number;
};

export type SceneScreens = { phaseId: string; groupPath?: { id: string; label: string }; screens: Screen[] };

const MONITORS = ["M1", "M2", "M3", "M4"] as const;

function successors(phase: Phase): string[] {
  switch (phase.kind) {
    case "idle": return [];
    case "video":
    case "narration": return [phase.next];
    case "group-branch": return [phase.next, ...phase.branches.flatMap((branch) => branch.next ? [branch.next] : [])];
    default: return phase.next.type === "fixed" ? [phase.next.target] : [...Object.values(phase.next.map as Record<string, string>), phase.next.tie, phase.next.empty];
  }
}

/** The group whose independent path contains this scene, if any. Paths end at their split's reunion. */
export function groupPathOf(scenario: Scenario, phaseId: string): string | undefined {
  const byId = new Map(scenario.phases.map((phase) => [phase.id, phase]));
  for (const split of scenario.phases) {
    if (split.kind !== "group-branch") continue;
    for (const branch of split.branches) {
      if (!branch.next) continue;
      const seen = new Set<string>();
      const queue = [branch.next];
      while (queue.length) {
        const id = queue.shift()!;
        if (id === split.next || id === split.id || seen.has(id)) continue;
        seen.add(id);
        if (id === phaseId) return branch.groupId;
        const phase = byId.get(id);
        if (phase) queue.push(...successors(phase));
      }
    }
  }
  return undefined;
}

const isVote = (phase: Phase): phase is Extract<Phase, { kind: "position-question" | "video-position-question" }> =>
  phase.kind === "position-question" || phase.kind === "video-position-question";

function answerOptions(phase: Extract<Phase, { kind: "position-question" | "video-position-question" }>): ScreenOption[] {
  const colors = resolveAnswerColors(phase.field, phase.answerColors);
  const field = phase.field;
  const labels: Array<[string, string]> = field.type === "polygon-zones"
    ? field.zones.map((zone) => [zone.id, zone.label])
    : field.type === "two-quadrant"
      ? [["min", field.labels.minLabel], ["max", field.labels.maxLabel]]
      : [["q2", `${field.xAxis.minLabel} / ${field.yAxis.minLabel}`], ["q1", `${field.xAxis.maxLabel} / ${field.yAxis.minLabel}`], ["q3", `${field.xAxis.minLabel} / ${field.yAxis.maxLabel}`], ["q4", `${field.xAxis.maxLabel} / ${field.yAxis.maxLabel}`]];
  return labels.map(([id, label]) => colors[id] ? { label, color: colors[id] } : { label });
}

function mainLayers(scenario: Scenario, phase: Phase, groupId: string | undefined): ScreenLayer[] {
  const layers: ScreenLayer[] = [];
  // Cursors render unless the scene opts out.
  const cursors = phase.kind !== "idle" && phase.kind !== "group-branch" && phase.showCursors !== false;
  switch (phase.kind) {
    case "idle":
      return [{ kind: "attract" }];
    case "group-branch":
      return [];
    case "video":
      layers.push(phase.audioSrc ? { kind: "image", src: phase.src } : { kind: "video", src: phase.src });
      if (phase.title) layers.push({ kind: "title", text: phase.title });
      if (phase.subtitles?.length) layers.push({ kind: "subtitles" });
      if (phase.rating) layers.push({ kind: "rating" });
      break;
    case "narration": {
      if (phase.title) layers.push({ kind: "title", text: phase.title });
      const text = (groupId !== undefined ? phase.textByGroup?.[groupId] : undefined) ?? phase.text;
      layers.push({ kind: "text", text }, { kind: "qr" });
      break;
    }
    case "position-question":
    case "video-position-question": {
      if (phase.kind === "video-position-question") layers.push(phase.audioSrc ? { kind: "image", src: phase.src } : { kind: "video", src: phase.src });
      if (phase.title && phase.kind === "position-question") layers.push({ kind: "title", text: phase.title });
      layers.push({ kind: "field", field: phase.field, colors: resolveAnswerColors(phase.field, phase.answerColors), curtain: curtainStagePhaseIds(scenario).has(phase.id) });
      layers.push({ kind: "text", text: phase.text });
      if (phase.kind === "video-position-question" && phase.subtitles?.length) layers.push({ kind: "subtitles" });
      if (phase.kind === "video-position-question" && phase.rating) layers.push({ kind: "rating" });
      break;
    }
  }
  if (cursors) layers.push({ kind: "cursors" });
  return layers;
}

function monitorLayer(cue: MonitorCue | undefined, color: string | undefined): ScreenLayer[] {
  if (!cue || cue.kind === "blank") return [];
  switch (cue.kind) {
    case "placeholder": return [{ kind: "placeholder", text: cue.text }];
    case "text": return cue.text.trim() ? [{ kind: "text", text: cue.text, ...(color ? { color } : {}) }] : [];
    case "image": return [{ kind: "image", src: cue.src }, ...(cue.text ? [{ kind: "text" as const, text: cue.text, ...(color ? { color } : {}) }] : [])];
    case "video": return [{ kind: "video", src: cue.src, loop: cue.loop }];
  }
  return [];
}

function monitorScreens(scenario: Scenario, phase: Phase, groupId: string | undefined): Screen[] {
  // Monitors follow an independent group path only when the show hands them to that group.
  const driven = groupId === undefined || scenario.monitorGroupId === groupId;
  const colors = isVote(phase) && phase.answerColors ? Object.values(resolveAnswerColors(phase.field, phase.answerColors)) : [];
  return MONITORS.map((id, index) => {
    const cues = driven ? phase.monitorCues?.[id] ?? [] : [];
    return { id, label: id, orientation: "landscape", layers: monitorLayer(cues[0], colors[index]), ...(cues.length > 1 ? { cueCount: cues.length } : {}) };
  });
}

function groupChoices(scenario: Scenario, phase: Phase): ScreenOption[] {
  if (phase.kind !== "group-branch" || phase.assignment.type !== "self-select") return [];
  return phase.branches.map((branch) => {
    const group = scenario.groups?.find((item) => item.id === branch.groupId);
    return { label: group?.label ?? branch.groupId, ...(group?.color ? { color: group.color } : {}) };
  });
}

/** Groups this scene's participants can belong to: the path's group, or every group on the shared timeline. */
function audienceGroups(scenario: Scenario, groupId: string | undefined) {
  const groups = scenario.groups ?? [];
  return groupId === undefined ? groups : groups.filter((group) => group.id === groupId);
}

function appLayers(scenario: Scenario, phase: Phase, groupId: string | undefined): ScreenLayer[] {
  const layers: ScreenLayer[] = [];
  if (phase.kind !== "idle" && phase.kind !== "group-branch") {
    const text = ((groupId !== undefined ? phase.tabletTextByGroup?.[groupId] : undefined) ?? phase.tabletText ?? Object.values(phase.tabletTextByGroup ?? {}).find((value) => value.trim()))?.trim();
    if (text) layers.push({ kind: "text", text });
    if (phase.tabletScript && scenario.actorScript) {
      const lines = scriptParagraphs(scenario.actorScript.text).slice(phase.tabletScript.fromParagraph, phase.tabletScript.toParagraph + 1).join("\n").split("\n");
      if (lines.length) layers.push({ kind: "script", lines });
    }
  }
  const choices = groupChoices(scenario, phase);
  if (choices.length) layers.push({ kind: "buttons", options: choices });
  if (isVote(phase) && audienceGroups(scenario, groupId).some((group) => group.votingMethod === "phone-buttons")) layers.push({ kind: "buttons", options: answerOptions(phase) });
  if ((phase.kind === "video" || phase.kind === "video-position-question") && phase.rating) layers.push({ kind: "rating" });
  if ("taskId" in phase && phase.taskId) layers.push({ kind: "task", title: scenario.participantTasks?.find((task) => task.id === phase.taskId)?.title ?? phase.taskId });
  const audio = phase.kind === "group-branch"
    ? phase.branches.some((branch) => branch.phoneAudioSrc)
    : phase.kind !== "idle" && (!!phase.phoneAudioSrc || Object.keys(phase.phoneAudioByGroup ?? {}).length > 0);
  if (audio) layers.push({ kind: "audio" });
  return layers;
}

function webLayers(scenario: Scenario, phase: Phase, groupId: string | undefined): ScreenLayer[] {
  const layers: ScreenLayer[] = [];
  // The browser shows active subtitles, else the scene title, as its phase text.
  if ((phase.kind === "video" || phase.kind === "video-position-question") && phase.subtitles?.length) layers.push({ kind: "text", text: phase.subtitles[0]!.text });
  else if ("title" in phase && phase.title && phase.kind !== "group-branch") layers.push({ kind: "title", text: phase.title });
  const choices = groupChoices(scenario, phase);
  if (choices.length) layers.push({ kind: "buttons", options: choices });
  if (isVote(phase)) {
    const groups = audienceGroups(scenario, groupId);
    const cursor = groups.length === 0 || groups.some((group) => group.votingMethod !== "phone-buttons" && group.votingMethod !== "physical");
    if (cursor) layers.push({ kind: "cursor-pad" });
    else if (groups.some((group) => group.votingMethod === "phone-buttons")) layers.push({ kind: "buttons", options: answerOptions(phase) });
  }
  if ((phase.kind === "video" || phase.kind === "video-position-question") && phase.rating) layers.push({ kind: "rating" });
  if ("taskId" in phase && phase.taskId) layers.push({ kind: "task", title: scenario.participantTasks?.find((task) => task.id === phase.taskId)?.title ?? phase.taskId });
  return layers;
}

/** What one scene puts on every screen, or null when the id is not a scene (entry/end nodes, nothing selected). */
export function sceneScreens(project: StudioProject, phaseId: string | undefined): SceneScreens | null {
  const scenario = project.scenario;
  const phase = phaseId === undefined ? undefined : scenario.phases.find((item) => item.id === phaseId);
  if (!phase) return null;
  const groupId = groupPathOf(scenario, phase.id);
  const group = groupId === undefined ? undefined : { id: groupId, label: scenario.groups?.find((item) => item.id === groupId)?.label ?? groupId };
  return {
    phaseId: phase.id,
    ...(group ? { groupPath: group } : {}),
    screens: [
      { id: "main", label: group ? `Group · ${group.label}` : "Main", orientation: "landscape", layers: mainLayers(scenario, phase, groupId) },
      ...monitorScreens(scenario, phase, groupId),
      { id: "app", label: "App", orientation: "portrait", layers: appLayers(scenario, phase, groupId) },
      { id: "web", label: "Web", orientation: "landscape", layers: webLayers(scenario, phase, groupId) },
    ],
  };
}
