import { describe, expect, it } from "vitest";
import { actorScriptSchema, firedScriptCueIndex, scriptCuesSchema, scriptLines, scriptParagraphs, tabletScriptExcerpt, tabletScriptSchema } from "./actor-script.js";
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

describe("tablet script", () => {
  it("marks the speaker's lines, continuations included, but not stage directions or other speakers", () => {
    const lines = scriptLines("VECTOR: Oracle, check the message.\nIt matters.\n[Pause.]\nORACLE: Checked.\nNote: not a speaker", "Vector");
    expect(lines.map((line) => line.own)).toEqual([true, true, false, false, false]);
    expect(scriptLines("VECTOR: Hi").every((line) => !line.own)).toBe(true);
    // A mixed-case "Word:" is ordinary text, so it does not start a speech.
    expect(scriptLines("Kandidat:in 2 spricht\nVECTOR: Ja", "VECTOR").map((line) => line.own)).toEqual([false, true]);
  });
  it("gives the excerpt only to the named groups, with their speaker", () => {
    const script = { title: "Act", text: "a\n\nb\n\nc", speakersByGroup: { lead: "VECTOR" } };
    const paragraphs = scriptParagraphs(script.text);
    const config = tabletScriptSchema.parse({ fromParagraph: 1, toParagraph: 2, groupIds: ["lead", "chorus"] });
    expect(tabletScriptExcerpt(script, paragraphs, config, "lead")).toEqual({ title: "Act", paragraphs: ["b", "c"], speaker: "VECTOR" });
    expect(tabletScriptExcerpt(script, paragraphs, config, "chorus")).toEqual({ title: "Act", paragraphs: ["b", "c"] });
    expect(tabletScriptExcerpt(script, paragraphs, config, "audience")).toBeNull();
    expect(tabletScriptExcerpt(script, paragraphs, config, null)).toBeNull();
    expect(tabletScriptExcerpt(script, paragraphs, { ...config, groupIds: [] }, null)?.paragraphs).toEqual(["b", "c"]);
    expect(tabletScriptSchema.safeParse({ fromParagraph: 2, toParagraph: 1 }).success).toBe(false);
  });
  it("validates the range and groups against the show", () => {
    const show = scenarioSchema.parse({ version: "v", entryPhaseId: "scene",
      groups: [{ id: "lead", label: "Lead" }, { id: "chorus", label: "Chorus" }],
      actorScript: { title: "Act", text: "a\n\nb", speakersByGroup: { ghost: "X" } },
      phases: [{ id: "idle", kind: "idle" }, { id: "scene", kind: "narration", text: "t", durationMs: 1000, next: "idle",
        tabletScript: { fromParagraph: 0, toParagraph: 5, groupIds: ["nobody"] } }] });
    expect(validateScenario(show).errors.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      'Actor script speaker is set for unknown group "ghost"', "Tablet script ends at paragraph 6, but the script has 2", 'Tablet script shows to unknown group "nobody"']));
  });
});
