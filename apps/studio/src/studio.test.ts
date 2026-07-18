import { describe, expect, it, vi } from "vitest";
import { parseRuntimeScenario } from "@smartphonecracy/studio-adapter";
import { Autosave, recoverDraft, type DraftDatabase } from "./drafts.js";
import { exportArtifacts, exportBackup, importBackup, importRuntime, importStudioFiles } from "./io.js";
import { autoLayout, type Draft } from "./model.js";
import scenario from "../../../content/scenarios/dev.json";
import manifest from "../../../content/media-manifest.json";
import e2eScenario from "../../../tests/e2e/fixtures/scenario.json";

class MemoryDb implements DraftDatabase {
  latest: Draft[] = [];
  history: Draft[] = [];
  async list() { return this.latest; }
  async revisions(id: string) { return this.history.filter((draft) => draft.id === id).sort((a, b) => b.updatedAt - a.updatedAt); }
  async put(draft: Draft) { this.latest = [structuredClone(draft)]; this.history.unshift(structuredClone(draft)); this.history = this.history.slice(0, 20); }
  async delete(id: string) { this.latest = this.latest.filter((draft) => draft.id !== id); this.history = this.history.filter((draft) => draft.id !== id); }
}

describe("Studio shell", () => {
  it("imports dev runtime, auto-layouts it, and exports normalized runtime without Studio fields", () => {
    const draft = importRuntime(scenario, manifest, "Dev");
    const artifacts = exportArtifacts(draft);
    expect(artifacts["scenario.json"]).toEqual(scenario);
    expect(artifacts["media-manifest.json"]).toEqual(manifest);
    expect(draft.document.nodes).toHaveLength(scenario.phases.filter((phase) => phase.kind !== "idle").length + 2);
    expect(draft.document.canvasFormatVersion).toBe(1);
    expect(draft.document.edges.every((edge) => edge.sourceHandle)).toBe(true);
    expect(JSON.stringify(artifacts["scenario.json"])).not.toContain("viewport");
  });

  it.each([
    ["content dev", scenario],
    ["installation e2e", e2eScenario],
  ])("round-trips every checked-in scenario fixture: %s", (_name, fixture) => {
    const canonical = parseRuntimeScenario(fixture, manifest).scenario;
    expect(exportArtifacts(importRuntime(fixture, manifest))["scenario.json"]).toEqual(canonical);
  });

  it("round-trips a versioned Studio backup", () => {
    const draft = importRuntime(scenario, manifest);
    expect(importBackup({ format: "smartphonecracy-studio-backup", version: 1, draft })).toEqual(draft);
    expect(() => importBackup({ version: 99 })).toThrow("supported Studio backup");
  });

  it("imports runtime artifacts by content regardless of selection order", () => {
    const imported = importStudioFiles([
      { name: "renamed-manifest.json", value: manifest },
      { name: "renamed-scenario.json", value: scenario },
    ]);
    expect(imported.kind).toBe("runtime");
    expect(imported.draft.project.scenario).toEqual(scenario);
    expect(imported.draft.project.manifest).toEqual(manifest);
    expect(imported.message).toContain("generated a new canvas layout");
  });

  it("round-trips a complete exported package with its Studio layout", () => {
    const draft = importRuntime(scenario, manifest, "Round trip");
    draft.document.nodes = draft.document.nodes.map((node, index) => ({ ...node, x: node.x + index * 17, y: node.y + index * 9 }));
    draft.document.viewport = { x: -240, y: 90, zoom: 0.72 };
    draft.document.notes = { "intro-video": "Opening cue" };
    const artifacts = exportArtifacts(draft);
    const imported = importStudioFiles([
      { name: "show-README.txt", value: "Deployment notes" },
      { name: "show-.studio.json", value: artifacts[".studio.json"] },
      { name: "show-media-manifest.json", value: artifacts["media-manifest.json"] },
      { name: "show-validation-report.json", value: { valid: true, runtimeSchemaVersion: 2, diagnostics: [] } },
      { name: "show-scenario.json", value: artifacts["scenario.json"] },
    ]);
    expect(imported.kind).toBe("package");
    expect(imported.draft.document).toEqual(draft.document);
    expect(exportArtifacts(imported.draft)).toEqual(artifacts);
    expect(imported.message).toContain("saved canvas layout");
  });

  it("rejects ambiguous, mismatched, and malformed import sets", () => {
    expect(() => importStudioFiles([
      { name: "scenario.json", value: scenario },
      { name: "copy-scenario.json", value: scenario },
      { name: "media-manifest.json", value: manifest },
    ])).toThrow("only one scenario");
    expect(() => importStudioFiles([
      { name: "scenario.json", value: manifest },
      { name: "media-manifest.json", value: scenario },
    ])).toThrow("looks like scenario by name but contains manifest data");
    expect(() => importStudioFiles([
      { name: "first-scenario.json", value: scenario },
      { name: "second-media-manifest.json", value: manifest },
    ])).toThrow("different export packages");

    const draft = importRuntime(scenario, manifest);
    const staleDocument = { ...draft.document, runtimeScenarioVersion: "different" };
    expect(() => importStudioFiles([
      { name: "scenario.json", value: scenario },
      { name: "media-manifest.json", value: manifest },
      { name: ".studio.json", value: staleDocument },
    ])).toThrow("targets scenario version different");
    expect(() => importStudioFiles([{ name: "mystery.json", value: { hello: "world" } }])).toThrow("not a recognized");
  });

  it("validates Studio document structure inside backups", () => {
    const draft = importRuntime(scenario, manifest);
    const backup = exportBackup({ ...draft, document: {} as Draft["document"] });
    expect(() => importBackup(backup)).toThrow("Studio document version");
  });

  it("debounces autosave and exposes saving/saved status", async () => {
    vi.useFakeTimers();
    const db = new MemoryDb();
    const draft = importRuntime(scenario, manifest);
    const statuses: string[] = [];
    new Autosave(db, 20).schedule(draft, (status) => statuses.push(status));
    expect(statuses).toEqual(["saving"]);
    await vi.advanceTimersByTimeAsync(20);
    expect(statuses).toEqual(["saving", "saved"]);
    expect(await db.list()).toHaveLength(1);
    vi.useRealTimers();
  });

  it("recovers the newest structurally good revision after a corrupt latest draft", async () => {
    const db = new MemoryDb();
    const project = parseRuntimeScenario(scenario, manifest);
    const id = crypto.randomUUID();
    const good: Draft = { id, name: "Good", updatedAt: 1, project, document: autoLayout(project, id) };
    db.latest = [{ ...good, updatedAt: 2, document: {} as Draft["document"] }];
    db.history = [good];
    expect((await recoverDraft(db, id))?.name).toBe("Good");
  });
});
