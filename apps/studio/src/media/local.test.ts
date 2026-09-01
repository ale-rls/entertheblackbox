import { describe, expect, it } from "vitest";
import manifest from "../../../../content/media-manifest.json";
import scenario from "../../../../content/scenarios/dev.json";
import { importRuntime } from "../io.js";
import { refreshDraftLocalMedia } from "./local.js";

describe("local Studio media", () => {
  it("overlays local files while preserving imported-only entries", () => {
    const draft = importRuntime(scenario, manifest);
    const generated = { files: [
      { src: "intro.mp4", bytes: 100, hash: "fresh", durationMs: 4_321, previewUrl: "https://media.test/intro.mp4" },
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

  it("uses MP3 metadata as the duration for an image + audio phase", () => {
    const draft = importRuntime(scenario, manifest);
    const phase = draft.project.scenario.phases.find((item) => item.kind === "video")!;
    if (phase.kind !== "video") throw new Error("expected video phase");
    phase.src = "portrait.png";
    phase.audioSrc = "voice.mp3";
    phase.tailDurationMs = 2_000;
    const refreshed = refreshDraftLocalMedia(draft, { files: [
      { src: "portrait.png", bytes: 10, hash: "image" },
      { src: "voice.mp3", bytes: 20, hash: "audio", durationMs: 22_222 },
    ] });
    expect(refreshed.project.scenario.phases.find((item) => item.id === phase.id)).toMatchObject({
      src: "portrait.png",
      audioSrc: "voice.mp3",
      tailDurationMs: 2_000,
      expectedDurationMs: 24_222,
    });
  });

  it("preserves a video's last-frame hold when refreshing detected duration", () => {
    const draft = importRuntime(scenario, manifest);
    const phase = draft.project.scenario.phases.find((item) => item.kind === "video")!;
    if (phase.kind !== "video") throw new Error("expected video phase");
    phase.tailDurationMs = 2_000;
    const refreshed = refreshDraftLocalMedia(draft, { files: [
      { src: phase.src, bytes: 10, hash: "video", durationMs: 22_222 },
    ] });
    expect(refreshed.project.scenario.phases.find((item) => item.id === phase.id)).toMatchObject({
      tailDurationMs: 2_000,
      expectedDurationMs: 24_222,
    });
  });
});
