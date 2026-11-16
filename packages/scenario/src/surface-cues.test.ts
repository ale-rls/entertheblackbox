import { describe, expect, it } from "vitest";
import { narrationPhaseSchema, scenarioSchema, videoPhaseSchema } from "./schema.js";
import { orderedSurfaceCues } from "./surface-cues.js";
import { validateScenario } from "./validate.js";

const effect = { kind: "wave", color: "#ff8800", periodMs: 1500 };

describe("surface cues", () => {
  it("accept start/stop cues on video and narration scenes", () => {
    expect(narrationPhaseSchema.safeParse({ kind: "narration", id: "n", text: "T", durationMs: 10_000, next: "idle",
      surfaceCues: [{ atMs: 0, action: "start", effect: { ...effect, color2: "#0000ff", brightness: 0.4 } }, { atMs: 9000, action: "stop" }] }).success).toBe(true);
    expect(videoPhaseSchema.safeParse({ kind: "video", id: "v", src: "v.mp4", expectedDurationMs: 10_000, next: "idle",
      surfaceCues: [{ atMs: 0, action: "start", effect }] }).success).toBe(true);
  });

  it("reject unknown effects, bad colours and out-of-range speed or brightness", () => {
    const parse = (cue: unknown) => narrationPhaseSchema.safeParse({ kind: "narration", id: "n", text: "T", durationMs: 10_000, next: "idle", surfaceCues: [cue] }).success;
    expect(parse({ atMs: 0, action: "start", effect: { ...effect, kind: "strobe" } })).toBe(false);
    expect(parse({ atMs: 0, action: "start", effect: { ...effect, color: "orange" } })).toBe(false);
    expect(parse({ atMs: 0, action: "start", effect: { ...effect, periodMs: 10 } })).toBe(false);
    expect(parse({ atMs: 0, action: "start", effect: { ...effect, brightness: 1.5 } })).toBe(false);
    expect(parse({ atMs: -1, action: "stop" })).toBe(false);
  });

  it("flag cues after the scene ends", () => {
    const scenario = scenarioSchema.parse({
      version: "test", entryPhaseId: "n",
      phases: [{ kind: "idle", id: "idle" }, { kind: "narration", id: "n", text: "T", durationMs: 10_000, next: "idle", surfaceCues: [{ atMs: 12_000, action: "stop" }] }],
    });
    expect(validateScenario(scenario).errors.map((issue) => issue.code)).toContain("surface-cue");
  });

  it("order cues by time, keeping authored order for ties", () => {
    const cues = [{ atMs: 5, action: "stop" as const }, { atMs: 0, action: "stop" as const }, { atMs: 5, action: "start" as const, effect: { kind: "chase" as const, color: "#ffffff", periodMs: 500 } }];
    expect(orderedSurfaceCues(cues).map((cue) => `${cue.atMs}:${cue.action}`)).toEqual(["0:stop", "5:stop", "5:start"]);
  });
});
