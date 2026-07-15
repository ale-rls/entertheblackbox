import { describe, expect, it } from "vitest";
import scenario from "../../../../content/scenarios/dev.json";
import manifest from "../../../../content/media-manifest.json";
import { diagnostics, diagnosticKey } from "../diagnostics/diagnostics.js";
import { importRuntime } from "../io.js";
import { assembleDeploymentPackage, DeploymentExportError } from "./deployment.js";

const metadata = { generatedAt: "2026-07-13T12:00:00.000Z", studioBuild: "test-build" };

describe("deployment export", () => {
  it("assembles a reproducible, versioned package after every branch resolves", () => {
    const draft = importRuntime(scenario, manifest, "Dev show");
    const acknowledged = new Set(diagnostics(draft.project).filter((item) => item.acknowledgementRequired).map(diagnosticKey));
    const first = assembleDeploymentPackage(draft, acknowledged, metadata);
    const second = assembleDeploymentPackage(draft, acknowledged, metadata);
    expect(second).toEqual(first);
    expect(first.packageName).toContain("-vdev-0.1.0-");
    expect(Object.keys(first.files)).toEqual(["scenario.json", "media-manifest.json", ".studio.json", "validation-report.json", "README.txt"]);
    expect(first.files["validation-report.json"]).toMatchObject({ valid: true, studioBuild: "test-build", runtimeSchemaVersion: 2, mediaTotalBytes: 67 });
    expect(first.files["validation-report.json"].branchSmoke).toHaveLength(11);
    expect(first.files["validation-report.json"].branchSmoke).toContainEqual(expect.objectContaining({ phaseId: "question-two-quadrant", outcome: "min", winner: "min" }));
    expect(first.files["README.txt"]).toContain("Validation: PASS (11 branch checks)");
  });

  it("reports only distinct referenced media toward the deployment budget", () => {
    const unusedBytes = 2 * 1024 * 1024 * 1024 + 1;
    const draft = importRuntime(scenario, {
      files: [
        ...manifest.files,
        { src: "large-unused.mp4", bytes: unusedBytes, hash: "f".repeat(64) },
      ],
    });
    const acknowledged = new Set(diagnostics(draft.project).filter((item) => item.acknowledgementRequired).map(diagnosticKey));

    const deployment = assembleDeploymentPackage(draft, acknowledged, metadata);

    expect(deployment.files["media-manifest.json"]).toMatchObject({ files: expect.arrayContaining([
      expect.objectContaining({ src: "large-unused.mp4", bytes: unusedBytes }),
    ]) });
    expect(deployment.files["validation-report.json"].mediaTotalBytes).toBe(67);
    expect(deployment.files["README.txt"]).toContain("Media total: 67 bytes");
  });

  it("blocks unacknowledged warnings", () => {
    const draft = importRuntime(scenario, manifest);
    expect(() => assembleDeploymentPackage(draft, new Set(), metadata)).toThrow(DeploymentExportError);
  });

  it("blocks runtime-invalid projects before producing files", () => {
    const draft = importRuntime(scenario, manifest);
    draft.project.scenario.entryPhaseId = "missing";
    expect(() => assembleDeploymentPackage(draft, new Set(), metadata)).toThrow("Deployment export blocked");
  });
});
