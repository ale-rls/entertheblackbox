import { describe, expect, it } from "vitest";
import { actorScriptSchema, firedScriptCueIndex, scriptCuesSchema, scriptParagraphs } from "./actor-script.js";
import { scenarioSchema } from "./schema.js";
import { validateScenario } from "./validate.js";

const narration = (scriptCues: unknown) => ({ id: "intro", kind: "narration", text: "Hello", durationMs: 5000, next: "idle", scriptCues });

describe("actor script contracts", () => {
  it("splits paragraphs on blank lines and keeps line breaks", () => {
    expect(scriptParagraphs("One\r\ntwo\r\n\r\n  \n\nThree ")).toEqual(["One\ntwo", "Three"]);
  });
  it("selects the latest fired cue by elapsed scene time", () => {
    const cues = scriptCuesSchema.parse([{ startMs: 0, paragraph: 3 }, { startMs: 4000, paragraph: 4 }]);
    expect(firedScriptCueIndex(cues, -1)).toBe(-1);
    expect(firedScriptCueIndex(cues, 0)).toBe(0);
    expect(firedScriptCueIndex(cues, 3999)).toBe(0);
    expect(firedScriptCueIndex(cues, 4000)).toBe(1);
    expect(firedScriptCueIndex(undefined, 4000)).toBe(-1);
  });
  it("rejects ambiguous timing, empty scripts and too many paragraphs", () => {
    expect(scriptCuesSchema.safeParse([{ startMs: 5, paragraph: 0 }, { startMs: 5, paragraph: 1 }]).success).toBe(false);
    expect(scriptCuesSchema.safeParse([{ startMs: -1, paragraph: 0 }]).success).toBe(false);
    expect(actorScriptSchema.safeParse({ title: " ", text: "x" }).success).toBe(false);
    expect(actorScriptSchema.safeParse({ title: "t", text: Array(2001).fill("x").join("\n\n") }).success).toBe(false);
  });
  it("requires cues to point inside the show's script", () => {
    const parse = (actorScript: unknown, cues: unknown) => scenarioSchema.parse({ version: "test", entryPhaseId: "intro", ...(actorScript ? { actorScript } : {}), phases: [{ id: "idle", kind: "idle" }, narration(cues)] });
    expect(validateScenario(parse({ title: "Show", text: "A\n\nB" }, [{ startMs: 0, paragraph: 1 }])).errors).toEqual([]);
    expect(validateScenario(parse({ title: "Show", text: "A\n\nB" }, [{ startMs: 0, paragraph: 2 }])).errors).toEqual([expect.objectContaining({ code: "script-cue", phaseId: "intro" })]);
    expect(validateScenario(parse(undefined, [{ startMs: 0, paragraph: 0 }])).errors).toEqual([expect.objectContaining({ code: "script-cue" })]);
  });
});
