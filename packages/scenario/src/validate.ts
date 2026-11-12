import { taskAudioSources } from './tasks.js';
import { admissionSources } from './admission.js';
import { monitorMediaSources } from "./monitors.js";
import { curtainLightIssues } from "./curtain.js";
import { scriptParagraphs } from "./actor-script.js";
import type { MediaManifest, Phase, Scenario } from "./schema.js";

/**
 * Graph-level validation (plan §5). Structural checks (shapes, ranges,
 * complete quadrant maps, counted statuses) are enforced by the Zod
 * schemas; this module checks cross-phase consistency.
 */

export type ScenarioIssue = {
  severity: "error" | "warning";
  code:
    | "duplicate-phase-id"
    | "missing-idle-phase"
    | "unknown-entry-phase"
    | "broken-target"
    | "unknown-group"
    | "unknown-question"
    | "invalid-group-branch"
    | "immediate-group-reunion"
    | "missing-media"
    | "unreachable-phase"
    | "unmarked-cycle"
    | "curtain-light"
    | "script-cue"
    | "unused-rank-outcome";
  phaseId?: string;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  errors: ScenarioIssue[];
  warnings: ScenarioIssue[];
};

/** All outgoing phase targets, labelled for error messages. */
export function targetsOf(phase: Phase): Array<{ label: string; target: string }> {
  switch (phase.kind) {
    case "idle":
      return [];
    case "video":
    case "narration":
      return [{ label: "next", target: phase.next }];
    case "group-branch":
      return [{ label: "next", target: phase.next }, ...phase.branches.flatMap((branch) =>
        branch.next === undefined ? [] : [{ label: `branches.${branch.groupId}.next`, target: branch.next }])];
    case "position-question":
    case "video-position-question": {
      const next = phase.next;
      if (next.type === "fixed") {
        return [{ label: "next.target", target: next.target }];
      }
      const mapped = Object.entries(next.map).map(([key, target]) => ({
        label: `next.map.${key}`,
        target,
      }));
      return [
        ...mapped,
        { label: "next.tie", target: next.tie },
        { label: "next.empty", target: next.empty },
      ];
    }
  }
}

export function validateScenario(
  scenario: Scenario,
  mediaManifest?: MediaManifest,
): ValidationResult {
  const errors: ScenarioIssue[] = [];
  const warnings: ScenarioIssue[] = [];

  for (const path of scenario.admission?.paths ?? []) if (!scenario.groups?.some(g => g.id === path.groupId)) errors.push({ severity: 'error', code: 'unknown-group', message: `Admission references unknown group ${path.groupId}` });
  for (const src of admissionSources(scenario.admission)) if (mediaManifest && !mediaManifest.files.some(f => f.src === src)) errors.push({ severity: 'error', code: 'missing-media', message: `Admission audio missing from manifest: ${src}` });
  const scriptLength = scenario.actorScript ? scriptParagraphs(scenario.actorScript.text).length : 0;
  for (const phase of scenario.phases) for (const cue of phase.scriptCues ?? []) {
    if (cue.paragraph >= scriptLength) errors.push({
      severity: "error", code: "script-cue", phaseId: phase.id,
      message: scriptLength === 0
        ? `Script cue at ${cue.startMs} ms needs an actor script on the show`
        : `Script cue at ${cue.startMs} ms points to paragraph ${cue.paragraph + 1}, but the script has ${scriptLength}`,
    });
  }
  const byId = new Map<string, Phase>();
  const groupIds = new Set((scenario.groups ?? []).map((group) => group.id));
  for (const groupId of Object.keys(scenario.actorScript?.speakersByGroup ?? {})) if (!groupIds.has(groupId)) errors.push({
    severity: "error", code: "unknown-group", message: `Actor script speaker is set for unknown group "${groupId}"`,
  });
  for (const phase of scenario.phases) {
    const tablet = phase.kind === "idle" || phase.kind === "group-branch" ? undefined : phase.tabletScript;
    if (!tablet) continue;
    if (tablet.toParagraph >= scriptLength) errors.push({
      severity: "error", code: "script-cue", phaseId: phase.id,
      message: scriptLength === 0 ? "Tablet script needs an actor script on the show"
        : `Tablet script ends at paragraph ${tablet.toParagraph + 1}, but the script has ${scriptLength}`,
    });
    for (const groupId of tablet.groupIds) if (!groupIds.has(groupId)) errors.push({
      severity: "error", code: "unknown-group", phaseId: phase.id, message: `Tablet script shows to unknown group "${groupId}"`,
    });
  }
  if (scenario.monitorGroupId !== undefined && !groupIds.has(scenario.monitorGroupId)) errors.push({
    severity: "error", code: "unknown-group", message: `monitorGroupId references unknown group "${scenario.monitorGroupId}"`,
  });
  for (const phase of scenario.phases) {
    if (byId.has(phase.id)) {
      errors.push({
        severity: "error",
        code: "duplicate-phase-id",
        phaseId: phase.id,
        message: `duplicate phase id "${phase.id}"`,
      });
    }
    byId.set(phase.id, phase);
  }

  if (!byId.has("idle")) {
    errors.push({
      severity: "error",
      code: "missing-idle-phase",
      message: 'scenario must contain the "idle" phase',
    });
  }

  if (!byId.has(scenario.entryPhaseId)) {
    errors.push({
      severity: "error",
      code: "unknown-entry-phase",
      phaseId: scenario.entryPhaseId,
      message: `entryPhaseId "${scenario.entryPhaseId}" does not match any phase`,
    });
  }

  for (const phase of scenario.phases) {
    for (const { label, target } of targetsOf(phase)) {
      if (!byId.has(target)) {
        errors.push({
          severity: "error",
          code: "broken-target",
          phaseId: phase.id,
          message: `phase "${phase.id}" ${label} points to unknown phase "${target}"`,
        });
      }
    }
    if (phase.kind === "group-branch") {
      for (const branch of phase.branches) if (branch.next === phase.next) warnings.push({
        severity: "warning", code: "immediate-group-reunion", phaseId: phase.id,
        message: `Group "${branch.groupId}" starts at the reunion of "${phase.id}" and will immediately finish. Use a separate entry scene if it should run its own path.`,
      });
      const referenced = [
        ...(phase.sourceGroupIds ?? []),
        ...phase.branches.map((branch) => branch.groupId),
        ...(phase.assignment.type === "vote" ? [...Object.values(phase.assignment.map), phase.assignment.fallbackGroupId] : []),
        ...(phase.assignment.type === "manual" ? [phase.assignment.fallbackGroupId] : []),
      ];
      for (const groupId of new Set(referenced)) if (!groupIds.has(groupId)) errors.push({
        severity: "error", code: "unknown-group", phaseId: phase.id,
        message: `group branch "${phase.id}" references unknown group "${groupId}"`,
      });
      const outputs = new Set(phase.branches.map((branch) => branch.groupId));
      const assignedGroups = phase.assignment.type === "vote"
        ? [...Object.values(phase.assignment.map), phase.assignment.fallbackGroupId]
        : phase.assignment.type === "manual" ? [phase.assignment.fallbackGroupId] : [];
      for (const groupId of new Set(assignedGroups)) if (!outputs.has(groupId)) errors.push({
        severity: "error", code: "invalid-group-branch", phaseId: phase.id,
        message: `group branch "${phase.id}" assigns "${groupId}" but does not expose it as an output`,
      });
      if (phase.assignment.type === "vote") {
        const questionId = phase.assignment.questionId;
        if (!scenario.phases.some((candidate) => candidate.id === questionId
          && (candidate.kind === "position-question" || candidate.kind === "video-position-question"))) errors.push({
            severity: "error", code: "unknown-question", phaseId: phase.id,
            message: `group branch "${phase.id}" references unknown position question "${questionId}"`,
          });
      }
    } else if (phase.kind !== "idle") {
      for (const groupId of Object.keys(phase.phoneAudioByGroup ?? {})) if (!groupIds.has(groupId)) errors.push({
        severity: "error", code: "unknown-group", phaseId: phase.id,
        message: `phase "${phase.id}" targets unknown group "${groupId}"`,
      });
      for (const groupId of Object.keys(phase.tabletTextByGroup ?? {})) if (!groupIds.has(groupId)) errors.push({
        severity: "error", code: "unknown-group", phaseId: phase.id,
        message: `phase "${phase.id}" shows tablet text to unknown group "${groupId}"`,
      });
    }
    if (phase.kind === "narration" && phase.textByGroup) {
      for (const groupId of Object.keys(phase.textByGroup)) if (!groupIds.has(groupId)) errors.push({
        severity: "error", code: "unknown-group", phaseId: phase.id,
        message: `phase "${phase.id}" targets unknown group "${groupId}"`,
      });
    }
  }
  for (const [client, groupId] of Object.entries(scenario.groupByClient ?? {})) if (groupId !== undefined && !groupIds.has(groupId)) errors.push({
    severity: "error", code: "unknown-group", message: `groupByClient.${client} references unknown group "${groupId}"`,
  });
  for (const groupId of scenario.initialGroupIds ?? []) if (!groupIds.has(groupId)) errors.push({
    severity: "error", code: "unknown-group", message: `initialGroupIds references unknown group "${groupId}"`,
  });

  if (mediaManifest) {
    const known = new Set(mediaManifest.files.map((f) => f.src));
    for (const phase of scenario.phases) {
      const sources = [
        ...monitorMediaSources(phase.monitorCues),
        ...(phase.kind === "idle" ? [] : phase.kind === "group-branch"
          ? phase.branches.flatMap((branch) => branch.phoneAudioSrc ? [branch.phoneAudioSrc] : [])
          : [
              ...(phase.phoneAudioSrc ? [phase.phoneAudioSrc] : []),
              ...Object.values(phase.phoneAudioByGroup ?? {}),
              ...(phase.kind === "position-question" || phase.kind === "narration" ? [] : [phase.src, ...(phase.audioSrc ? [phase.audioSrc] : []), ...(phase.extraAudioSrc ? [phase.extraAudioSrc] : [])]),
            ]),
      ];
      for (const src of sources) {
        if (known.has(src)) continue;
        errors.push({
          severity: "error",
          code: "missing-media",
          phaseId: phase.id,
          message: `media phase "${phase.id}" references "${src}" which is not in the media manifest`,
        });
      }
    }
  }

  for (const issue of curtainLightIssues(scenario, mediaManifest)) (issue.severity === "error" ? errors : warnings).push(issue);

  // Reachability from the entry phase; idle is always considered live
  // because every session returns to it.
  if (byId.has(scenario.entryPhaseId)) {
    const reachable = new Set<string>(["idle"]);
    const queue = [scenario.entryPhaseId];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      const phase = byId.get(id);
      if (!phase) continue;
      for (const { target } of targetsOf(phase)) {
        if (byId.has(target)) queue.push(target);
      }
    }
    for (const phase of scenario.phases) {
      if (!reachable.has(phase.id)) {
        warnings.push({
          severity: "warning",
          code: "unreachable-phase",
          phaseId: phase.id,
          message: `phase "${phase.id}" is not reachable from entry "${scenario.entryPhaseId}"`,
        });
      }
    }
  }

  // Cycle detection (iterative DFS with colors). Cycles are errors unless
  // the scenario explicitly marks them as intentional.
  if (!scenario.cyclesAllowed) {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const id of byId.keys()) color.set(id, WHITE);

    const reportCycle = (from: string, to: string) =>
      errors.push({
        severity: "error",
        code: "unmarked-cycle",
        phaseId: from,
        message: `cycle detected via "${from}" → "${to}"; set cyclesAllowed: true if intentional`,
      });

    for (const start of byId.keys()) {
      if (color.get(start) !== WHITE) continue;
      const stack: Array<{ id: string; nexts: string[]; i: number }> = [];
      color.set(start, GRAY);
      const startPhase = byId.get(start)!;
      stack.push({
        id: start,
        nexts: targetsOf(startPhase).map((t) => t.target).filter((t) => byId.has(t)),
        i: 0,
      });
      while (stack.length > 0) {
        const frame = stack[stack.length - 1]!;
        if (frame.i < frame.nexts.length) {
          const nextId = frame.nexts[frame.i]!;
          frame.i += 1;
          const c = color.get(nextId);
          if (c === GRAY) {
            reportCycle(frame.id, nextId);
          } else if (c === WHITE) {
            color.set(nextId, GRAY);
            const nextPhase = byId.get(nextId)!;
            stack.push({
              id: nextId,
              nexts: targetsOf(nextPhase).map((t) => t.target).filter((t) => byId.has(t)),
              i: 0,
            });
          }
        } else {
          color.set(frame.id, BLACK);
          stack.pop();
        }
      }
    }
  }

  if (scenario.handoverTaskId && !scenario.participantTasks?.some(t => t.id === scenario.handoverTaskId)) errors.push({ severity: 'error', code: 'broken-target', message: `Unknown handover task ${scenario.handoverTaskId}` });
  const taskIds = new Set<string>();
  for (const task of scenario.participantTasks ?? []) {
    if (taskIds.has(task.id)) errors.push({ severity: 'error', code: 'broken-target', message: `Duplicate task ${task.id}` });
    taskIds.add(task.id);
    for (const option of task.options) {
      if (option.groupId && !scenario.groups?.some(g => g.id === option.groupId)) errors.push({ severity: 'error', code: 'unknown-group', message: `Task ${task.id} assigns unknown group ${option.groupId}` });
      if (option.nextTaskId && !scenario.participantTasks?.some(t => t.id === option.nextTaskId)) errors.push({ severity: 'error', code: 'broken-target', message: `Task ${task.id} references unknown follow-up ${option.nextTaskId}` });
      for (const [label, outcome] of [...(option.rankOutcomes ?? []).map((o, i) => [`rank ${i + 1}`, o] as const), ...(option.overflow ? [['overflow', option.overflow] as const] : [])]) {
        if (outcome.groupId && !scenario.groups?.some(g => g.id === outcome.groupId)) errors.push({ severity: 'error', code: 'unknown-group', message: `Task ${task.id} option ${option.id} ${label} assigns unknown group ${outcome.groupId}` });
        if (outcome.roleId && !scenario.participantRoles?.some(r => r.id === outcome.roleId)) errors.push({ severity: 'error', code: 'broken-target', message: `Task ${task.id} option ${option.id} ${label} references unknown role ${outcome.roleId}` });
        if (outcome.nextTaskId && !scenario.participantTasks?.some(t => t.id === outcome.nextTaskId)) errors.push({ severity: 'error', code: 'broken-target', message: `Task ${task.id} option ${option.id} ${label} references unknown follow-up ${outcome.nextTaskId}` });
      }
      if (option.overflow && option.capacity === undefined && !option.roleId && !option.rankOutcomes?.some(r => r.roleId)) errors.push({ severity: 'error', code: 'broken-target', message: `Task ${task.id} option ${option.id} has an overflow outcome but no capacity or role that can fill up` });
      if (option.rankOutcomes && option.capacity !== undefined && option.rankOutcomes.length > option.capacity) warnings.push({ severity: 'warning', code: 'unused-rank-outcome', message: `Task ${task.id} option ${option.id} has ${option.rankOutcomes.length} rank outcomes but capacity ${option.capacity}; the extra outcomes are never used` });
      if (option.audioByVote && !scenario.phases.some(p => p.id === option.audioByVote!.questionId && (p.kind === 'position-question' || p.kind === 'video-position-question'))) errors.push({ severity: 'error', code: 'broken-target', message: `Task ${task.id} references unknown vote ${option.audioByVote.questionId}` });
    }
    for (const option of task.options) if (option.roleId && !scenario.participantRoles?.some(r => r.id === option.roleId)) errors.push({ severity: 'error', code: 'broken-target', message: `Task ${task.id} references unknown role ${option.roleId}` });
    for (const id of task.groupIds) if (!scenario.groups?.some(g => g.id === id)) errors.push({ severity: 'error', code: 'unknown-group', message: `Task ${task.id} targets unknown group ${id}` });
  }
  for (const phase of scenario.phases) if ((phase.kind === 'narration' || phase.kind === 'video') && phase.taskId && !scenario.participantTasks?.some(t => t.id === phase.taskId)) errors.push({ severity: 'error', code: 'broken-target', phaseId: phase.id, message: `Unknown task ${phase.taskId}` });
  for (const src of taskAudioSources(scenario.participantTasks)) if (mediaManifest && !mediaManifest.files.some(f => f.src === src)) errors.push({ severity: 'error', code: 'missing-media', message: `Task audio missing from manifest: ${src}` });
  return { ok: errors.length === 0, errors, warnings };
}
