import { describe, expect, it } from "vitest";
import manifest from "../../../../content/media-manifest.json";
import scenario from "../../../../content/scenarios/dev.json";
import { importRuntime } from "../io.js";
import { refreshDraftLocalMedia } from "./local.js";

describe("local Studio media", () => {
  it("overlays local files while preserving imported-only entries", () => {
    const draft = importRuntime(scenario, manifest);
    const generated = { files: [
      { src: "intro.mp4", bytes: 100, hash: "fresh", durationMs: 4_321 },
      { src: "new.mp4", bytes: 42, hash: "abc" },
    ] };
    const refreshed = refreshDraftLocalMedia(draft, generated);
    expect(refreshed.localMediaSources).toEqual(["intro.mp4", "new.mp4"]);
    expect(refreshed.project.manifest).toEqual({ files: [
      { src: "intro.mp4", bytes: 100, hash: "fresh" },
      { src: "new.mp4", bytes: 42, hash: "abc" },
    ] });
    expect(refreshed.project.scenario.phases.find((phase) => phase.kind === "video")).toMatchObject({ expectedDurationMs: 4_321 });
    expect(draft.project.manifest).toEqual(manifest);
  });

  it("removes files that disappeared locally without removing imported-only entries", () => {
    const draft = importRuntime(scenario, { files: [
      ...manifest.files,
      { src: "old-local.mp4", bytes: 10, hash: "old" },
      { src: "remote.mp4", bytes: 20, hash: "remote" },
    ] });
    draft.localMediaSources = ["intro.mp4", "old-local.mp4"];
    const refreshed = refreshDraftLocalMedia(draft, { files: [
      { src: "intro.mp4", bytes: 100, hash: "fresh" },
    ] });
    expect(refreshed.project.manifest.files).toEqual([
      { src: "intro.mp4", bytes: 100, hash: "fresh" },
      { src: "remote.mp4", bytes: 20, hash: "remote" },
    ]);
  });
});
