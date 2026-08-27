import { describe, expect, it } from "vitest";
import { formatMediaBytes, formatMediaDuration, mediaLibraryRows } from "./MediaLibraryDialog.js";

describe("MediaLibraryDialog helpers", () => {
  it("formats file metadata for quick scanning", () => {
    expect(formatMediaBytes(1_048_576)).toBe("1.0 MB");
    expect(formatMediaDuration(75_000)).toBe("1 min 15 sec");
  });

  it("shows every phase that references a shared media file", () => {
    const manifest = { files: [{ src: "clip.mp4", bytes: 10, hash: "hash", durationMs: 5_000 }] };
    const project = {
      scenario: {
        version: "1",
        entryPhaseId: "video",
        cyclesAllowed: false,
        phases: [
          { kind: "idle", id: "idle" },
          { kind: "video", id: "video", src: "clip.mp4", expectedDurationMs: 5_000, next: "vote" },
          { kind: "video-position-question", id: "vote", src: "clip.mp4", expectedDurationMs: 5_000, text: "Vote", field: { type: "four-quadrant", xAxis: { minLabel: "L", maxLabel: "R" }, yAxis: { minLabel: "T", maxLabel: "B" } }, showAtMs: 1_000, openAtMs: 1_000, closeAtMs: 3_000, hideAtMs: 4_000, connectionStaleAfterMs: 1_000, showLiveCounts: false, next: { type: "fixed", target: "idle" } },
        ],
      },
      manifest,
      runtimeExtensions: { scenario: {}, manifest: {} },
    } as Parameters<typeof mediaLibraryRows>[1];
    expect(mediaLibraryRows(manifest, project)[0]?.references).toEqual(["video", "vote"]);
  });
});
