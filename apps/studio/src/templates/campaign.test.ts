import { describe, expect, it } from "vitest";
import { parseRuntimeScenario } from "@smartphonecracy/studio-adapter";
import { appendCampaignExtension } from "./campaign.js";

describe("campaign extension template", () => {
  it("extends a production-shaped ending with spectrum speeches and a three-zone election", () => {
    const base = parseRuntimeScenario({
      version: "1.0.0",
      entryPhaseId: "Athene",
      cyclesAllowed: false,
      phases: [
        { kind: "idle", id: "idle" },
        { kind: "video", id: "Athene", src: "athene.mp4", expectedDurationMs: 1_000, next: "abmoderation" },
        { kind: "video", id: "abmoderation", src: "outro.mp4", expectedDurationMs: 1_000, next: "idle" },
      ],
    }, { files: [
      { src: "athene.mp4", bytes: 1, hash: "a" },
      { src: "outro.mp4", bytes: 1, hash: "b" },
    ] });
    const extended = appendCampaignExtension(base);
    expect(extended.scenario.phases.find((phase) => phase.id === "abmoderation")).toMatchObject({ next: "3-0-wahlkampf-auftakt" });
    expect(extended.scenario.phases.find((phase) => phase.id === "3-1-openapollo-rede")).toMatchObject({
      kind: "video-position-question",
      field: { type: "two-quadrant", axis: "x" },
      next: { type: "fixed", target: "3-2-dionysos69-rede" },
      rating: { candidateLabel: "OpenApollo" },
    });
    expect(extended.scenario.phases.find((phase) => phase.id === "4-0-wahl")).toMatchObject({
      field: { type: "polygon-zones", zones: [{ id: "openapollo" }, { id: "dionysos69" }, { id: "kassandra" }] },
      showLiveCounts: false,
      next: { tieBreak: { type: "kleroterion" } },
    });
  });
});
