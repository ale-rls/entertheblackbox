import {
  buildPoolMasks,
  curtainLabels,
  curtainOutcomes,
  curtainVoteField,
  neutralEntryPoint,
  poolCoverage,
  resolveCurtainSettings,
} from "@entertheblackbox/shared";
import type { MediaManifest, Phase, PositionVotePhase, Scenario } from "./schema.js";
import { targetsOf, type ScenarioIssue } from "./validate.js";

/** Groups whose cursor votes use the curtain-light treatment. */
export function curtainGroupIds(scenario: Pick<Scenario, "groups">): string[] {
  return (scenario.groups ?? []).filter((group) => group.voteTreatment === "curtain-light").map((group) => group.id);
}

/**
 * Position votes that run on a curtain-light group's own timeline: every
 * vote reachable from that group's branch entry before the branch's shared
 * reunion. The server applies the treatment per running group timeline;
 * this static view drives Studio controls and validation.
 */
export function curtainStagePhaseIds(scenario: Pick<Scenario, "groups" | "phases">): Set<string> {
  const groups = new Set(curtainGroupIds(scenario));
  const stages = new Set<string>();
  if (groups.size === 0) return stages;
  const byId = new Map<string, Phase>(scenario.phases.map((phase) => [phase.id, phase]));
  for (const branchPhase of scenario.phases) {
    if (branchPhase.kind !== "group-branch") continue;
    for (const branch of branchPhase.branches) {
      if (!groups.has(branch.groupId) || branch.next === undefined) continue;
      const seen = new Set<string>([branchPhase.next, "idle"]);
      const queue = [branch.next];
      while (queue.length > 0) {
        const id = queue.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const phase = byId.get(id);
        if (!phase) continue;
        if (phase.kind === "position-question" || phase.kind === "video-position-question") stages.add(id);
        for (const { target } of targetsOf(phase)) queue.push(target);
      }
    }
  }
  return stages;
}

/** A label longer than this is unlikely to stay legible inside a light pool. */
const READABLE_LABEL_CHARS = 28;
/** Below this share of the display an answer's area is too small to reach. */
const USABLE_AREA = 0.004;

function stageLabels(phase: PositionVotePhase): string[] {
  const field = phase.field;
  if (field.type === "polygon-zones") return field.zones.map((zone) => zone.label);
  if (field.type === "two-quadrant") return [field.labels.minLabel, field.labels.maxLabel];
  return [field.xAxis.minLabel, field.xAxis.maxLabel, field.yAxis.minLabel, field.yAxis.maxLabel];
}

export function curtainLightIssues(scenario: Scenario, mediaManifest?: MediaManifest): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  const groups = (scenario.groups ?? []).filter((group) => group.voteTreatment === "curtain-light");
  if (groups.length === 0) return issues;
  const settings = resolveCurtainSettings(scenario.curtainLight);
  if (scenario.curtainLight?.src === undefined) {
    issues.push({ severity: "error", code: "curtain-light", message: "Curtain-light votes need a shared curtain video (curtainLight.src) from the media library" });
  } else if (mediaManifest && !mediaManifest.files.some((file) => file.src === settings.src)) {
    issues.push({ severity: "error", code: "missing-media", message: `curtain video "${settings.src}" is not in the media manifest` });
  }
  for (const group of groups) {
    if (group.votingMethod === "phone-buttons" || group.votingMethod === "physical") issues.push({
      severity: "warning", code: "curtain-light",
      message: `Group "${group.id}" uses curtain-light votes, which are drawn for phone cursors; its ${group.votingMethod} votes will show the curtain without cursor lights`,
    });
  }
  const stages = curtainStagePhaseIds(scenario);
  for (const phase of scenario.phases) {
    if (!stages.has(phase.id) || (phase.kind !== "position-question" && phase.kind !== "video-position-question")) continue;
    const field = curtainVoteField(phase.field, settings.neutralGap);
    const coverage = poolCoverage(buildPoolMasks(field, 120, 68));
    for (const outcome of curtainOutcomes(field)) {
      if ((coverage[outcome] ?? 0) >= USABLE_AREA) continue;
      issues.push({
        severity: "error", code: "curtain-light", phaseId: phase.id,
        message: `"${phase.id}": answer "${outcome}" has no usable counting area; reduce the neutral gap or enlarge its region`,
      });
    }
    if (neutralEntryPoint(field) === null) issues.push({
      severity: "error", code: "curtain-light", phaseId: phase.id,
      message: `"${phase.id}": the answer areas leave no neutral space, so cursors cannot appear without voting; leave a gap between areas`,
    });
    for (const label of stageLabels(phase)) {
      if (label.trim().length === 0) issues.push({ severity: "error", code: "curtain-light", phaseId: phase.id, message: `"${phase.id}": every answer needs a visible label` });
      else if (label.length > READABLE_LABEL_CHARS) issues.push({
        severity: "warning", code: "curtain-light", phaseId: phase.id,
        message: `"${phase.id}": label "${label}" is longer than ${READABLE_LABEL_CHARS} characters and may not be readable on the curtain`,
      });
    }
    if (curtainLabels(field).length === 0) issues.push({ severity: "error", code: "curtain-light", phaseId: phase.id, message: `"${phase.id}": no answer labels to draw` });
    const outcomes = new Set(curtainOutcomes(field));
    for (const id of Object.keys(phase.answerColors ?? {})) if (!outcomes.has(id)) issues.push({
      severity: "warning", code: "curtain-light", phaseId: phase.id,
      message: `"${phase.id}": colour for unknown answer "${id}" is ignored`,
    });
  }
  return issues;
}
