import {
  classifyPositionVotesForField,
  deterministicChoice,
  resolvePositionFixedTransition,
  resolvePositionPlurality,
  type PositionField,
  type PositionQuadrant,
  type PositionStatus,
  type PositionedVote,
} from "../../../../packages/shared/src/index.js";
import type { StudioProject } from "@smartphonecracy/studio-adapter";
import { diagnostics, type Diagnostic } from "../diagnostics/diagnostics.js";

type Phase = StudioProject["scenario"]["phases"][number];
export type ForcedOutcome = PositionQuadrant | "tie" | "empty" | "abandoned-solo";
export type PreviewVote = PositionedVote<PositionStatus> & { participantId: string };
export type PreviewResolution = { field: PositionField; votes: PreviewVote[]; includedTotal: number; excludedTotal: number; includedByStatus: Partial<Record<PositionStatus, number>>; excludedByStatus: Partial<Record<PositionStatus, number>>; quadrantCounts: Partial<Record<PositionQuadrant, number>>; winner: PositionQuadrant | "tie" | "empty" | "fixed"; resolvedTarget: string; freezeMs: number; tieBreak?: { type: "kleroterion"; candidates: string[]; selected: string } };
export type PreviewSession = { project: StudioProject; phaseId: string; elapsedMs: number; validation: Diagnostic[]; resolution?: PreviewResolution };

export function startPreview(project: StudioProject, startPhaseId: string = project.scenario.entryPhaseId): PreviewSession {
  const validation = diagnostics(project);
  const errors = validation.filter((item) => item.severity === "error");
  if (errors.length) throw new Error(`Preview blocked: ${errors.map((item) => item.message).join("; ")}`);
  if (!project.scenario.phases.some((phase) => phase.id === startPhaseId)) {
    throw new Error(`Preview phase “${startPhaseId}” does not exist.`);
  }
  return { project, phaseId: startPhaseId, elapsedMs: 0, validation };
}
export const currentPhase = (session: PreviewSession): Phase => {
  const phase = session.project.scenario.phases.find((item) => item.id === session.phaseId);
  if (!phase) throw new Error(`Preview phase “${session.phaseId}” does not exist.`);
  return phase;
};
export function advancePreview(session: PreviewSession): PreviewSession {
  const phase = currentPhase(session);
  if (phase.kind === "idle") return session;
  let target: string;
  if (phase.kind === "video") target = phase.next;
  else {
    if (phase.next.type !== "fixed") throw new Error("Choose an outcome for this question.");
    target = phase.next.target;
  }
  const { resolution: _resolution, ...rest } = session;
  return { ...rest, phaseId: target, elapsedMs: 0 };
}
export function advanceTimer(session: PreviewSession, milliseconds: number): PreviewSession {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error("Timer advance must be non-negative.");
  return { ...session, elapsedMs: session.elapsedMs + milliseconds };
}
const fourPoint = { q1: [0.75, 0.25], q2: [0.25, 0.25], q3: [0.25, 0.75], q4: [0.75, 0.75] } as const;
const zoneCentroid = (points: readonly { x: number; y: number }[]): readonly [number, number] => {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return [sum.x / points.length, sum.y / points.length];
};
const pointFor = (field: PositionField, quadrant: PositionQuadrant): readonly [number, number] => {
  if (field.type === "four-quadrant") {
    if (field.arena === undefined) return fourPoint[quadrant as keyof typeof fourPoint];
    const right = quadrant === "q1" || quadrant === "q4";
    const bottom = quadrant === "q3" || quadrant === "q4";
    return [
      field.arena.centerX + (right ? 0.42 : -0.42) * field.arena.radiusX,
      field.arena.centerY + (bottom ? 0.42 : -0.42) * field.arena.radiusY,
    ];
  }
  if (field.type === "polygon-zones") {
    const zone = field.zones.find((z) => z.id === quadrant);
    if (!zone) throw new Error(`Unknown zone "${String(quadrant)}".`);
    return zoneCentroid(zone.points);
  }
  if (field.arena !== undefined) {
    if (field.axis === "x") return [field.arena.centerX + (quadrant === "min" ? -0.5 : 0.5) * field.arena.radiusX, field.arena.centerY];
    return [field.arena.centerX, field.arena.centerY + (quadrant === "min" ? -0.5 : 0.5) * field.arena.radiusY];
  }
  if (field.axis === "x") return quadrant === "min" ? [0.25, 0.5] : [0.75, 0.5];
  return quadrant === "min" ? [0.5, 0.25] : [0.5, 0.75];
};
export function forcedOutcomes(field: PositionField): ForcedOutcome[] {
  if (field.type === "two-quadrant") return ["min", "max", "tie", "empty", "abandoned-solo"];
  if (field.type === "polygon-zones") {
    return [...field.zones.map((zone) => zone.id), "tie", "empty", "abandoned-solo"] as ForcedOutcome[];
  }
  return ["q1", "q2", "q3", "q4", "tie", "empty", "abandoned-solo"];
}
export function outcomeVotes(field: PositionField, outcome: ForcedOutcome, includeStale: boolean, includeDisconnected: boolean): PreviewVote[] {
  if (outcome === "empty") return [{ participantId: "never-moved", x: null, y: null, status: "never-moved" }];
  const pair: PositionQuadrant[] = field.type === "two-quadrant"
    ? ["min", "max"]
    : field.type === "polygon-zones"
      ? [field.zones[0]!.id, field.zones[1]!.id]
      : ["q1", "q2"];
  if (outcome === "abandoned-solo") {
    const soloQuadrant = field.type === "two-quadrant" ? "max" : field.type === "polygon-zones" ? field.zones[0]!.id : "q4";
    const [x, y] = pointFor(field, soloQuadrant);
    return [{ participantId: "solo", x, y, status: "disconnected" }];
  }
  const winners: PositionQuadrant[] = outcome === "tie" ? pair : [outcome];
  const votes: PreviewVote[] = winners.map((quadrant, index) => { const [x, y] = pointFor(field, quadrant); return { participantId: `valid-${index + 1}`, x, y, status: "valid" }; });
  const staleQuadrant = outcome === "tie" ? pair[0]! : outcome;
  const disconnectedQuadrant = outcome === "tie" ? pair[1]! : outcome;
  if (includeStale) { const [x, y] = pointFor(field, staleQuadrant); votes.push({ participantId: "stale", x, y, status: "stale" }); }
  if (includeDisconnected) { const [x, y] = pointFor(field, disconnectedQuadrant); votes.push({ participantId: "disconnected", x, y, status: "disconnected" }); }
  return votes;
}
export function resolvePreview(session: PreviewSession, outcome: ForcedOutcome, includeStale = true, includeDisconnected = true): PreviewSession {
  const phase = currentPhase(session);
  if (phase.kind !== "position-question" && phase.kind !== "video-position-question") throw new Error("Only position votes have outcomes.");
  const votes: PreviewVote[] = outcomeVotes(phase.field, outcome, includeStale, includeDisconnected);
  const counted = new Set<PositionStatus>(phase.next.type === "quadrant-plurality" ? phase.next.countedStatuses : ["valid", "stale", "disconnected"]);
  const classification = classifyPositionVotesForField(phase.field, votes, counted);
  const resolved = phase.next.type === "fixed" ? resolvePositionFixedTransition(phase.field, votes, phase.next.target) : (() => {
    const result = resolvePositionPlurality(phase.field, votes, counted);
    if (result.winner === "tie" && phase.next.tieBreak?.type === "kleroterion") {
      const candidates = (result.tiedCandidates ?? []) as string[];
      const selected = deterministicChoice(`studio-preview:${phase.id}`, candidates);
      return { ...result, resolvedTarget: (phase.next.map as Record<string, string>)[selected]!, tieBreak: { type: "kleroterion" as const, candidates, selected } };
    }
    const resolvedTarget = result.winner === "tie" ? phase.next.tie : result.winner === "empty" ? phase.next.empty : (phase.next.map as Record<string, string>)[result.winner]!;
    return { ...result, resolvedTarget };
  })();
  const freezeMs = phase.kind === "position-question" ? phase.freezeMs : phase.hideAtMs - phase.closeAtMs;
  return { ...session, resolution: { votes, ...classification, quadrantCounts: resolved.quadrantCounts, winner: resolved.winner, resolvedTarget: resolved.resolvedTarget, freezeMs } };
}
export function continueAfterResolution(session: PreviewSession): PreviewSession {
  if (!session.resolution) throw new Error("Resolve the question first.");
  const { resolution, ...rest } = session;
  return { ...rest, phaseId: resolution.resolvedTarget, elapsedMs: 0 };
}
