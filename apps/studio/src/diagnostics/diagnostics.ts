import { validateStudioProject, type StudioProject } from "@smartphonecracy/studio-adapter";
import { MEDIA_BUDGET_BYTES, distinctReferencedBytes, phaseMediaSources } from "../media/library.js";

export type Diagnostic = { severity: "error" | "warning" | "info"; code: string; message: string; phaseId?: string; acknowledgementRequired?: boolean };

function pointInPolygon(points: readonly { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function polygonCoverage(field: Extract<StudioProject["scenario"]["phases"][number], { kind: "position-question" | "video-position-question" }>["field"]): { overlap: boolean; uncoveredRatio: number } | null {
  if (field.type !== "polygon-zones") return null;
  let overlap = false;
  let uncovered = 0;
  let samples = 0;
  for (let yi = 0; yi < 20; yi += 1) {
    for (let xi = 0; xi < 40; xi += 1) {
      const x = (xi + 0.5) / 40;
      const y = (yi + 0.5) / 20;
      const matches = field.zones.filter((zone) => pointInPolygon(zone.points, x, y)).length;
      if (matches === 0) uncovered += 1;
      if (matches > 1) overlap = true;
      samples += 1;
    }
  }
  return { overlap, uncoveredRatio: uncovered / samples };
}

export function diagnostics(project: StudioProject): Diagnostic[] {
  const result: Diagnostic[] = validateStudioProject(project);
  const referenced = new Set(project.scenario.phases.flatMap(phaseMediaSources));
  const hashes = new Map<string, string>();
  for (const file of project.manifest.files) {
    if (!referenced.has(file.src)) result.push({ severity: "warning", code: "unused-media", message: `Media “${file.src}” is never referenced.`, acknowledgementRequired: true });
    const prior = hashes.get(file.hash);
    if (prior) result.push({ severity: "warning", code: "duplicate-media-hash", message: `Media “${file.src}” duplicates the content hash of “${prior}”.`, acknowledgementRequired: true });
    else hashes.set(file.hash, file.src);
  }
  const total = distinctReferencedBytes(project);
  result.push({ severity: "info", code: "media-budget", message: `Distinct referenced media: ${total.toLocaleString()} / ${MEDIA_BUDGET_BYTES.toLocaleString()} bytes.` });
  if (total > MEDIA_BUDGET_BYTES) result.push({ severity: "error", code: "media-budget-exceeded", message: "Distinct referenced media exceeds the 2 GiB limit." });
  for (const phase of project.scenario.phases) {
    if (phase.kind !== "position-question" && phase.kind !== "video-position-question") continue;
    const coverage = polygonCoverage(phase.field);
    if (coverage?.overlap) result.push({ severity: "error", code: "polygon-zone-overlap", phaseId: phase.id, message: "Polygon zones overlap; a cursor in the overlap would be assigned to whichever zone is listed first." });
    if (coverage && coverage.uncoveredRatio > 0.01) result.push({ severity: "warning", code: "polygon-zone-gaps", phaseId: phase.id, message: `Approximately ${Math.round(coverage.uncoveredRatio * 100)}% of the arena is outside every zone and will not count as a vote.`, acknowledgementRequired: true });
    if (phase.showLiveCounts) result.push({ severity: "warning", code: "live-counts-influence", phaseId: phase.id, message: "Live counts may influence voter behaviour.", acknowledgementRequired: true });
    if (phase.next.type !== "quadrant-plurality") continue;
    const outcomes: Array<[string, string]> = [...Object.entries(phase.next.map), ["tie", phase.next.tie], ["empty", phase.next.empty]];
    const targets = new Map<string, string[]>();
    for (const [outcome, target] of outcomes) targets.set(target, [...(targets.get(target) ?? []), outcome]);
    for (const [target, labels] of targets) if (labels.length > 1) result.push({ severity: "warning", code: "converging-outcomes", phaseId: phase.id, message: `Outcomes ${labels.join(", ")} converge on “${target}”.`, acknowledgementRequired: true });
    result.push({ severity: "warning", code: "abandoned-solo-empty-review", phaseId: phase.id, message: `Review the abandoned-solo flow and empty target “${phase.next.empty}”.`, acknowledgementRequired: true });
  }
  if (project.scenario.cyclesAllowed) result.push({ severity: "warning", code: "intentional-cycle", message: "This show explicitly allows cycles; review maximum session duration.", acknowledgementRequired: true });
  return result;
}

export const exportBlocked = (items: Diagnostic[], acknowledged: ReadonlySet<string>) =>
  items.some((item) => item.severity === "error" || (item.acknowledgementRequired && !acknowledged.has(`${item.code}:${item.phaseId ?? ""}:${item.message}`)));
export const diagnosticKey = (item: Diagnostic) => `${item.code}:${item.phaseId ?? ""}:${item.message}`;
