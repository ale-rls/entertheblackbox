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
    case "position-question": {
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
  }

  if (mediaManifest) {
    const known = new Set(mediaManifest.files.map((f) => f.src));
    for (const phase of scenario.phases) {
      if (phase.kind === "video" && !known.has(phase.src)) {
        errors.push({
          severity: "error",
          code: "missing-media",
          phaseId: phase.id,
          message: `video phase "${phase.id}" references "${phase.src}" which is not in the media manifest`,
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
