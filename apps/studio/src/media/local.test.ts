import { describe, expect, it, vi } from "vitest";
import manifest from "../../../../content/media-manifest.json";
import scenario from "../../../../content/scenarios/dev.json";
import { importRuntime } from "../io.js";
import { loadLocalMediaManifest, refreshDraftLocalMedia, uploadLocalMedia } from "./local.js";

describe("local Studio media", () => {
  it("loads a valid generated manifest without browser caching", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(manifest), { status: 200 }));
    const readDuration = vi.fn(async () => 12_345);
    await expect(loadLocalMediaManifest(fetcher as typeof fetch, readDuration)).resolves.toEqual({
      files: manifest.files.map((file) => ({ ...file, durationMs: 12_345 })),
    });
    expect(fetcher).toHaveBeenCalledWith("/__studio/local-media-manifest", { cache: "no-store" });
    expect(readDuration).toHaveBeenCalledTimes(manifest.files.length);
  });

  it("leaves manual import available when local discovery is unavailable or invalid", async () => {
    const unavailable = vi.fn(async () => new Response("missing", { status: 404 }));
    const invalid = vi.fn(async () => new Response(JSON.stringify({ files: [{ src: "empty.mp4", bytes: 0, hash: "x" }] })));
    await expect(loadLocalMediaManifest(unavailable as typeof fetch)).resolves.toBeUndefined();
    await expect(loadLocalMediaManifest(invalid as typeof fetch)).resolves.toBeUndefined();
  });

  it("explains that uploads require the local Studio server when the endpoint is unavailable", async () => {
    const fetcher = vi.fn(async () => new Response("Not found", { status: 404 }));
    const file = new File(["video"], "new.mp4", { type: "video/mp4" });
    await expect(uploadLocalMedia(file, fetcher as typeof fetch)).rejects.toThrow(
      "Could not add new.mp4. Adding media requires the local Studio development server.",
    );
    expect(fetcher).toHaveBeenCalledWith("/__studio/local-media/new.mp4", expect.objectContaining({ method: "PUT", body: file }));
  });

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
