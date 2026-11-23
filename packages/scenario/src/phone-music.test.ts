import { describe, expect, it } from "vitest";
import { phoneMusicSchema, scenarioSchema, validateScenario } from "./index.js";

describe("tablet music per scene", () => {
  it("is a track (with optional volume) or a stop, nothing else", () => {
    expect(phoneMusicSchema.parse({ src: "Ambient Chords.mp3", volume: 0.5 })).toEqual({ src: "Ambient Chords.mp3", volume: 0.5 });
    expect(phoneMusicSchema.parse({ stop: true })).toEqual({ stop: true });
    expect(phoneMusicSchema.safeParse({ src: "video.mp4" }).success).toBe(false);
    expect(phoneMusicSchema.safeParse({ stop: true, src: "a.mp3" }).success).toBe(false);
    expect(phoneMusicSchema.safeParse({ src: "a.mp3", volume: 0 }).success).toBe(false);
  });
  it("reports a track missing from the media manifest", () => {
    const scenario = scenarioSchema.parse({ version: "m", entryPhaseId: "a", cyclesAllowed: false, phases: [
      { kind: "idle", id: "idle" },
      { kind: "narration", id: "a", text: "A", durationMs: 1000, phoneMusic: { src: "missing.mp3" }, next: "idle" },
    ] });
    const result = validateScenario(scenario, { files: [] });
    expect(result.errors.some((issue) => issue.code === "missing-media" && issue.message.includes("missing.mp3"))).toBe(true);
  });
});
