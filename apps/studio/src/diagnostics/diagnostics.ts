import { validateStudioProject, type StudioProject } from "@smartphonecracy/studio-adapter";
import { MEDIA_BUDGET_BYTES, distinctReferencedBytes } from "../media/library.js";

export type Diagnostic = { severity: "error" | "warning" | "info"; code: string; message: string; phaseId?: string; acknowledgementRequired?: boolean };

export function diagnostics(project: StudioProject): Diagnostic[] {
  const result: Diagnostic[] = validateStudioProject(project);
  const videos = project.scenario.phases.filter((phase) => phase.kind === "video" || phase.kind === "video-position-question");
  const referenced = new Set(videos.map((phase) => phase.src));
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
