import { describe, expect, it } from "vitest";
import { activeMonitorCue, MONITOR_TEXT_COLOR_PRESETS, monitorCuesSchema, monitorMediaSources } from "./monitors.js";
import { scenarioSchema } from "./schema.js";
import { validateScenario } from "./validate.js";

describe("monitor cue contracts", () => {
  it("selects by absolute elapsed time across reconnects, gaps and boundaries", () => {
    const cues = monitorCuesSchema.parse({ M1: [
      { kind: "text", text: "Question", startMs: 1000, durationMs: 2000 },
      { kind: "placeholder", text: "Answer", startMs: 5000 },
      { kind: "blank", startMs: 9000 },
    ] }).M1!;
    expect(activeMonitorCue(cues, 999)).toBeNull();
    expect(activeMonitorCue(cues, 1000)?.kind).toBe("text");
    expect(activeMonitorCue(cues, 3000)).toBeNull();
    expect(activeMonitorCue(cues, 7000)).toEqual(cues[1]);
    expect(activeMonitorCue(cues, 9000)?.kind).toBe("blank");
    expect(activeMonitorCue(cues, -100)).toBeNull();
  });
  it("rejects invalid screens, paths, media types and ambiguous cue timing", () => {
    for (const value of [
      { M5: [] },
      { M1: [{ kind: "video", src: "../private.mp4" }] },
      { M1: [{ kind: "video", src: "audio.mp3" }] },
      { M1: [{ kind: "image", src: "https://example.com/a.png" }] },
      { M1: [{ kind: "text", text: "one", startMs: 5 }, { kind: "blank", startMs: 5 }] },
      { M1: [{ kind: "blank", durationMs: 0 }] },
    ]) expect(monitorCuesSchema.safeParse(value).success).toBe(false);
  });
  it("validates idle monitor media as well as active phase media", () => {
    const monitors = monitorCuesSchema.parse({ M1: [{ kind: "image", src: "waiting.png" }], M2: [{ kind: "image", src: "waiting.png" }] });
    expect(monitorMediaSources(monitors)).toEqual(["waiting.png"]);
    const scenario = scenarioSchema.parse({ version: "test", entryPhaseId: "idle", phases: [{ id: "idle", kind: "idle", monitorCues: monitors }] });
    expect(validateScenario(scenario, { files: [] }).errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing-media", phaseId: "idle" })]));
  });
});


it("round-trips named vote-result cues without adding media dependencies", () => {
  const cues = monitorCuesSchema.parse({ M1: [{ kind: "vote-result", votePhaseId: "topic", fallbackText: "No topic" }] });
  expect(cues.M1?.[0]).toMatchObject({ kind: "vote-result", votePhaseId: "topic", fallbackText: "No topic" });
  expect(monitorMediaSources(cues)).toEqual([]);
});

it("accepts a hex text colour on text-bearing cues and offers the show presets", () => {
  const cues = monitorCuesSchema.parse({ M1: [
    { kind: "text", text: "A", startMs: 0, color: "#F76B15" },
    { kind: "placeholder", text: "B", startMs: 1, color: "#30a46c" },
    { kind: "vote-result", fallbackText: "", startMs: 2, color: "#3e63dd" },
    { kind: "image", src: "a.png", text: "C", startMs: 3, color: "#e5484d" },
    { kind: "text", text: "D", startMs: 4 },
  ] }).M1!;
  expect(cues.map((cue) => "color" in cue ? cue.color : undefined)).toEqual(["#F76B15", "#30a46c", "#3e63dd", "#e5484d", undefined]);
  for (const color of ["orange", "#fff", "#12345g"]) expect(monitorCuesSchema.safeParse({ M1: [{ kind: "text", text: "A", color }] }).success).toBe(false);
  expect(MONITOR_TEXT_COLOR_PRESETS.map((item) => item.name)).toEqual(["White", "Orange", "Green", "Blue", "Red", "Yellow"]);
  for (const item of MONITOR_TEXT_COLOR_PRESETS) expect(monitorCuesSchema.safeParse({ M1: [{ kind: "text", text: "A", color: item.color }] }).success).toBe(true);
});
