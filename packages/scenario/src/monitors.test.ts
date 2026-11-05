import { describe, expect, it } from "vitest";
import { activeMonitorCue, monitorCuesSchema, monitorMediaSources } from "./monitors.js";
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
