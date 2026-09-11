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
    | "missing-media"
    | "unreachable-phase"
    | "unmarked-cycle";
  phaseId?: string;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  errors: ScenarioIssue[];
  warnings: ScenarioIssue[];
};

/** All outgoing phase targets, labelled for error messages. */
function targetsOf(phase: Phase): Array<{ label: string; target: string }> {
  switch (phase.kind) {
    case "idle":
      return [];
    case "video":
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

  const byId = new Map<string, Phase>();
  const groupIds = new Set((scenario.groups ?? []).map((group) => group.id));
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
      // Each split owns its paths until its reunion. Re-splitting is authored
      // at/after that reunion; nested ownership of the same display is ambiguous.
      const visited = new Set<string>();
      const pending = phase.branches.flatMap((branch) => branch.next ? [branch.next] : []);
      while (pending.length) {
        const id = pending.pop()!;
        if (id === phase.next || id === "idle" || visited.has(id)) continue;
        visited.add(id);
        const local = byId.get(id);
        if (!local) continue;
        if (local.kind === "group-branch") {
          errors.push({ severity: "error", code: "invalid-group-branch", phaseId: phase.id,
            message: `group path from "${phase.id}" reaches split "${id}" before rejoining at "${phase.next}"; rejoin before splitting again` });
        } else pending.push(...targetsOf(local).map(({ target }) => target));
      }
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
    } else if (phase.kind !== "idle" && phase.phoneAudioByGroup) {
      for (const groupId of Object.keys(phase.phoneAudioByGroup)) if (!groupIds.has(groupId)) errors.push({
        severity: "error", code: "unknown-group", phaseId: phase.id,
        message: `phase "${phase.id}" targets unknown group "${groupId}"`,
      });
    }
  }
  for (const groupId of scenario.initialGroupIds ?? []) if (!groupIds.has(groupId)) errors.push({
    severity: "error", code: "unknown-group", message: `initialGroupIds references unknown group "${groupId}"`,
  });

  if (mediaManifest) {
    const known = new Set(mediaManifest.files.map((f) => f.src));
    for (const phase of scenario.phases) {
      if (phase.kind === "idle") continue;
      const sources = [
        ...(phase.kind === "group-branch"
          ? phase.branches.flatMap((branch) => branch.phoneAudioSrc ? [branch.phoneAudioSrc] : [])
          : [
              ...(phase.phoneAudioSrc ? [phase.phoneAudioSrc] : []),
              ...Object.values(phase.phoneAudioByGroup ?? {}),
              ...(phase.kind === "position-question" ? [] : [phase.src, ...(phase.audioSrc ? [phase.audioSrc] : []), ...(phase.extraAudioSrc ? [phase.extraAudioSrc] : [])]),
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

  return { ok: errors.length === 0, errors, warnings };
}
