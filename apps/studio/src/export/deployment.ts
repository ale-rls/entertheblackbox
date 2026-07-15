import { SCENARIO_SCHEMA_VERSION } from "../../../../packages/scenario/src/index.js";
import { compileStudioGraph } from "@smartphonecracy/studio-adapter";
import type { Draft } from "../model.js";
import { diagnosticKey, diagnostics, exportBlocked, type Diagnostic } from "../diagnostics/diagnostics.js";
import { distinctReferencedBytes } from "../media/library.js";
import { forcedOutcomes, resolvePreview, startPreview, type ForcedOutcome } from "../preview/preview.js";

export type BranchSmokeResult = {
  phaseId: string;
  outcome: Exclude<ForcedOutcome, "abandoned-solo">;
  winner: string;
  resolvedTarget: string;
};

export type ValidationReport = {
  valid: true;
  generatedAt: string;
  studioBuild: string;
  runtimeSchemaVersion: number;
  scenarioVersion: string;
  mediaTotalBytes: number;
  acknowledgedWarnings: string[];
  diagnostics: Diagnostic[];
  branchSmoke: BranchSmokeResult[];
};

export type DeploymentPackage = {
  packageName: string;
  files: {
    "scenario.json": unknown;
    "media-manifest.json": unknown;
    ".studio.json": unknown;
    "validation-report.json": ValidationReport;
    "README.txt": string;
  };
};

export class DeploymentExportError extends Error {
  constructor(readonly reasons: string[]) {
    super(`Deployment export blocked: ${reasons.join("; ")}`);
    this.name = "DeploymentExportError";
  }
}

export function smokeAllBranches(draft: Draft): BranchSmokeResult[] {
  const results: BranchSmokeResult[] = [];
  for (const phase of draft.project.scenario.phases) {
    if (phase.kind !== "position-question") continue;
    const candidates: Array<Exclude<ForcedOutcome, "abandoned-solo">> = phase.next.type === "fixed"
      ? [phase.field.type === "two-quadrant" ? "min" : "q1"]
      : forcedOutcomes(phase.field).filter((outcome): outcome is Exclude<ForcedOutcome, "abandoned-solo"> => outcome !== "abandoned-solo");
    for (const outcome of candidates) {
      const session = startPreview({
        ...draft.project,
        scenario: { ...draft.project.scenario, entryPhaseId: phase.id },
      });
      const resolution = resolvePreview(session, outcome, false, false).resolution;
      if (!resolution) throw new Error(`Branch smoke produced no result for ${phase.id}:${outcome}`);
      results.push({ phaseId: phase.id, outcome, winner: resolution.winner, resolvedTarget: resolution.resolvedTarget });
    }
  }
  return results;
}

export function assembleDeploymentPackage(
  draft: Draft,
  acknowledged: ReadonlySet<string>,
  metadata: { generatedAt: string; studioBuild: string },
): DeploymentPackage {
  const generatedAt = new Date(metadata.generatedAt);
  if (!Number.isFinite(generatedAt.valueOf()) || !metadata.studioBuild.trim()) {
    throw new DeploymentExportError(["Valid generatedAt and studioBuild metadata are required"]);
  }
  const items = diagnostics(draft.project);
  if (exportBlocked(items, acknowledged)) {
    const reasons = items
      .filter((item) => item.severity === "error" || (item.acknowledgementRequired && !acknowledged.has(diagnosticKey(item))))
      .map((item) => item.message);
    throw new DeploymentExportError(reasons);
  }

  // compileStudioGraph ends in the canonical runtime validator. Nothing is
  // assembled until it succeeds, so invalid runtime output cannot escape.
  const runtime = compileStudioGraph(draft.project);
  const branchSmoke = smokeAllBranches(draft);
  const mediaTotalBytes = distinctReferencedBytes(draft.project);
  const warningKeys = items.filter((item) => item.severity === "warning").map(diagnosticKey).sort();
  const report: ValidationReport = {
    valid: true,
    generatedAt: generatedAt.toISOString(),
    studioBuild: metadata.studioBuild,
    runtimeSchemaVersion: SCENARIO_SCHEMA_VERSION,
    scenarioVersion: runtime.scenario.version,
    mediaTotalBytes,
    acknowledgedWarnings: warningKeys.filter((key) => acknowledged.has(key)),
    diagnostics: items,
    branchSmoke,
  };
  const readme = [
    "Smartphonecracy deployment export",
    `Generated: ${report.generatedAt}`,
    `Studio build: ${report.studioBuild}`,
    `Runtime schema: ${report.runtimeSchemaVersion}`,
    `Scenario version: ${report.scenarioVersion}`,
    `Validation: PASS (${branchSmoke.length} branch checks)`,
    `Media total: ${mediaTotalBytes} bytes`,
    `Known warnings: ${warningKeys.length ? warningKeys.join(", ") : "none"}`,
  ].join("\n");
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  return {
    packageName: `${draft.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}-v${runtime.scenario.version}-${stamp}`,
    files: {
      "scenario.json": runtime.scenario,
      "media-manifest.json": runtime.manifest,
      ".studio.json": draft.document,
      "validation-report.json": report,
      "README.txt": readme,
    },
  };
}
