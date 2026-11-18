import { describe, expect, it, vi } from "vitest";
import { parseRuntimeScenario } from "@entertheblackbox/studio-adapter";
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
  async put(draft: Draft) { this.latest = [structuredClone(draft), ...this.latest.filter((existing) => existing.id !== draft.id)]; this.history.unshift(structuredClone(draft)); this.history = this.history.slice(0, 20); }
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
    const imported = importBackup(exportBackup(draft));
    expect(imported.id).not.toBe(draft.id);
    expect(imported).toEqual({ ...draft, id: imported.id, updatedAt: imported.updatedAt });
    expect(() => importBackup({ version: 99 })).toThrow("supported Studio backup");
  });

  it("keeps the original and repeated backup imports as separate saved drafts", async () => {
    const db = new MemoryDb();
    const source = importRuntime(scenario, manifest, "Original show");
    source.updatedAt = 1;
    source.document.viewport = { x: 140, y: -70, zoom: 0.8 };
    source.document.notes = { "intro-video": "Opening cue" };
    const backup = exportBackup(source);
    const existing = { ...structuredClone(source), name: "Edited since backup" };
    await db.put(existing);

    for (let index = 0; index < 2; index++) {
      const { draft, message } = importStudioFiles([{ name: "show-backup.json", value: backup }]);
      expect(draft.updatedAt).toBeGreaterThan(source.updatedAt);
      expect(draft).toEqual({ ...source, id: draft.id, updatedAt: draft.updatedAt });
      expect(message).toContain("new draft");
      await db.put(draft);
    }

    const saved = await db.list();
    expect(saved).toHaveLength(3);
    expect(new Set(saved.map((draft) => draft.id)).size).toBe(3);
    expect(saved.find((draft) => draft.id === source.id)).toEqual(existing);
    expect(backup).toEqual(exportBackup(source));
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

  it("preserves pending edits when another draft is opened during the debounce window", async () => {
    vi.useFakeTimers();
    try {
      const db = new MemoryDb();
      const autosave = new Autosave(db, 20);
      const first = importRuntime(scenario, manifest, "First");
      const second = importRuntime(scenario, manifest, "Second");
      autosave.schedule(first);
      autosave.schedule(second);
      autosave.schedule({ ...first, name: "First edited" });
      await vi.advanceTimersByTimeAsync(20);

      expect(await db.list()).toEqual([
        expect.objectContaining({ id: first.id, name: "First edited" }),
        expect.objectContaining({ id: second.id, name: "Second" }),
      ]);
      expect(await db.revisions(first.id)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for an in-flight save before writing newer edits", async () => {
    vi.useFakeTimers();
    try {
      const db = new MemoryDb();
      const autosave = new Autosave(db, 20);
      const draft = importRuntime(scenario, manifest, "Original");
      const put = db.put.bind(db);
      let finishFirst!: () => void;
      const firstWrite = new Promise<void>((resolve) => { finishFirst = resolve; });
      const writes = vi.spyOn(db, "put").mockImplementationOnce(async (value) => {
        await firstWrite;
        await put(value);
      });
      const changed = vi.fn();

      autosave.schedule(draft, changed);
      await vi.advanceTimersByTimeAsync(20);
      autosave.schedule({ ...draft, name: "Updated" }, changed);
      await vi.advanceTimersByTimeAsync(20);
      expect(writes).toHaveBeenCalledTimes(1);
      expect(autosave.status).toBe("saving");

      finishFirst();
      await vi.advanceTimersByTimeAsync(0);
      expect(await db.list()).toEqual([expect.objectContaining({ name: "Updated" })]);
      expect(changed.mock.calls).toEqual([["saving"], ["saved"]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a failed background draft and retries its retained edits", async () => {
    vi.useFakeTimers();
    try {
      const db = new MemoryDb();
      const autosave = new Autosave(db, 20);
      const first = importRuntime(scenario, manifest, "First");
      const second = importRuntime(scenario, manifest, "Second");
      const changed = vi.fn();
      vi.spyOn(db, "put").mockRejectedValueOnce(new Error("Offline"));

      autosave.schedule(first, changed);
      autosave.schedule(second, changed);
      await vi.advanceTimersByTimeAsync(20);
      expect(await db.list()).toEqual([expect.objectContaining({ id: second.id })]);
      expect(autosave.status).toBe("error");
      expect(changed.mock.calls).toEqual([["saving"], ["error"]]);

      autosave.retryFailed();
      await vi.advanceTimersByTimeAsync(0);
      expect(await db.list()).toEqual([
        expect.objectContaining({ id: first.id }),
        expect.objectContaining({ id: second.id }),
      ]);
      expect(changed.mock.calls).toEqual([["saving"], ["error"], ["saving"], ["saved"]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes a draft after a pending write fails without retrying it", async () => {
    vi.useFakeTimers();
    try {
      const db = new MemoryDb();
      const autosave = new Autosave(db, 20);
      const draft = importRuntime(scenario, manifest, "Original");
      await db.put(draft);
      let rejectWrite!: (error: Error) => void;
      const failedWrite = new Promise<void>((_, reject) => { rejectWrite = reject; });
      const writes = vi.spyOn(db, "put").mockImplementationOnce(() => failedWrite);
      const remove = vi.spyOn(db, "delete");

      autosave.schedule({ ...draft, name: "Updated" });
      await vi.advanceTimersByTimeAsync(20);
      autosave.schedule({ ...draft, name: "Discard this pending edit" });
      const deleting = autosave.deleteDraft(draft.id);
      expect(remove).not.toHaveBeenCalled();
      rejectWrite(new Error("Offline"));
      await deleting;
      autosave.retryFailed();
      await vi.advanceTimersByTimeAsync(20);
      expect(writes).toHaveBeenCalledTimes(1);
      expect(await db.list()).toEqual([]);
      expect(await db.revisions(draft.id)).toEqual([]);
      expect(autosave.status).toBe("saved");
    } finally {
      vi.useRealTimers();
    }
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
