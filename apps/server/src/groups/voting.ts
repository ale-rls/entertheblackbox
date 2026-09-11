import { quadrantOfField } from "@entertheblackbox/shared";
import type { Phase, PositionField, VotingMethod } from "@entertheblackbox/scenario";

export function acceptsVotingInput(configured: VotingMethod | undefined, source: VotingMethod): boolean {
  // Compatibility: historical shows accepted both tracked bodies and phone cursors.
  return configured === undefined ? source !== "phone-buttons" : configured === source;
}

export function votingOptions(phase: Phase): Array<{ id: string; label: string }> {
  if (phase.kind !== "position-question" && phase.kind !== "video-position-question") return [];
  if (phase.field.type === "polygon-zones") {
    return phase.field.zones.map((zone) => ({ id: zone.id, label: zone.label }));
  }
  if (phase.field.type === "two-quadrant") {
    return [
      { id: "min", label: phase.field.labels.minLabel },
      { id: "max", label: phase.field.labels.maxLabel },
    ];
  }
  return [
    { id: "q2", label: `${phase.field.xAxis.minLabel} / ${phase.field.yAxis.minLabel}` },
    { id: "q1", label: `${phase.field.xAxis.maxLabel} / ${phase.field.yAxis.minLabel}` },
    { id: "q3", label: `${phase.field.xAxis.minLabel} / ${phase.field.yAxis.maxLabel}` },
    { id: "q4", label: `${phase.field.xAxis.maxLabel} / ${phase.field.yAxis.maxLabel}` },
  ];
}

/** Resolve a discrete button to a real point, so the canonical vote engine and exports stay unchanged. */
export function pointForOutcome(field: PositionField, outcome: string): { x: number; y: number } | null {
  const candidates: Array<{ x: number; y: number }> = [];
  if (field.type === "polygon-zones") {
    const zone = field.zones.find((candidate) => candidate.id === outcome);
    if (!zone) return null;
    const average = zone.points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
    candidates.push({ x: average.x / zone.points.length, y: average.y / zone.points.length });
  }
  for (let yi = 1; yi < 100; yi += 1) {
    for (let xi = 1; xi < 100; xi += 1) candidates.push({ x: xi / 100, y: yi / 100 });
  }
  return candidates.find((point) => quadrantOfField(field, point.x, point.y) === outcome) ?? null;
}
