import { describe, expect, it } from "vitest";
import { productionDraftFromArtifact } from "./production.js";

describe("production draft import", () => {
  it("keeps production identity only in Studio metadata while preserving runtime content", () => {
    const draft = productionDraftFromArtifact({
      recordId: "record-1",
      showId: "main-show",
      name: "Main v4",
      version: "1.0.0",
      publishedAt: 5_000,
      scenario: {
        version: "1.0.0",
        entryPhaseId: "outro",
        cyclesAllowed: false,
        phases: [
          { kind: "idle", id: "idle" },
          { kind: "video", id: "outro", src: "outro.mp4", expectedDurationMs: 1_000, next: "idle" },
        ],
      },
      mediaManifest: { files: [{ src: "outro.mp4", bytes: 1, hash: "outro" }] },
    });
    expect(draft.name).toBe("Main v4 — production fork");
    expect(draft.document.showId).toBe("main-show");
    expect(draft.document.productionBaseline).toEqual({
      recordId: "record-1",
      showId: "main-show",
      name: "Main v4",
      version: "1.0.0",
      publishedAt: 5_000,
    });
    expect(draft.project.scenario).not.toHaveProperty("productionBaseline");
  });
});
