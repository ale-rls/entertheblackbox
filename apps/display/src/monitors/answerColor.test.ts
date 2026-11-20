import { describe, expect, it } from "vitest";
import type { PhaseSnapshotMessage } from "@entertheblackbox/protocol";
import { monitorAnswerColor, monitorTextColor } from "./answerColor.js";

const square = (x: number, y: number) => [{ x, y }, { x: x + 0.4, y }, { x: x + 0.4, y: y + 0.4 }, { x, y: y + 0.4 }];
const field = {
  type: "polygon-zones",
  zones: [
    { id: "rot", label: "Ich selbst", points: square(0, 0) },
    { id: "blau", label: "Partner:in", points: square(0.55, 0) },
    { id: "gelb", label: "Kalender", points: square(0, 0.55) },
    { id: "gruen", label: "Arbeit", points: square(0.55, 0.55) },
  ],
};
const colors = { rot: "#e5484d", blau: "#3e63dd", gelb: "#f5d90a", gruen: "#30a46c" };
const phase = (extra: object) => ({ id: "q", kind: "video-position-question", ...extra }) as unknown as PhaseSnapshotMessage;

describe("monitor answer colour", () => {
  it("gives each monitor its answer zone's authored colour in outcome order", () => {
    const question = phase({ field, answerColors: colors });
    expect(["M1", "M2", "M3", "M4"].map(id => monitorAnswerColor(question, id as "M1"))).toEqual(["#e5484d", "#3e63dd", "#f5d90a", "#30a46c"]);
  });
  it("uses the server-resolved curtain colours when the phase has no own map", () => {
    expect(monitorAnswerColor(phase({ field, voteTreatment: { answerColors: colors } }), "M3")).toBe("#f5d90a");
  });
  it("repeats the answers around the monitors when a question has fewer than four", () => {
    const twoZones = phase({ field: { ...field, zones: field.zones.slice(0, 2) }, answerColors: colors });
    expect(["M1", "M2", "M3", "M4"].map(id => monitorAnswerColor(twoZones, id as "M1"))).toEqual(["#e5484d", "#3e63dd", "#e5484d", "#3e63dd"]);
    const split = phase({ field: { type: "two-quadrant", axis: "x", variant: "split", labels: { minLabel: "a", maxLabel: "b" } }, answerColors: { min: "#f5d90a", max: "#3e63dd" } });
    expect(["M1", "M2", "M3", "M4"].map(id => monitorAnswerColor(split, id as "M1"))).toEqual(["#f5d90a", "#3e63dd", "#f5d90a", "#3e63dd"]);
  });
  it("stays uncoloured without authored colours, a field, or a matching zone", () => {
    expect(monitorAnswerColor(phase({ field }), "M1")).toBeNull();
    expect(monitorAnswerColor(phase({ kind: "narration" }), "M1")).toBeNull();
    expect(monitorAnswerColor(null, "M1")).toBeNull();
  });
});

describe("monitor text colour", () => {
  const question = phase({ field, answerColors: colors });
  it("uses the cue's own colour over the vote and answer colours", () => {
    expect(monitorTextColor({ kind: "text", text: "A", startMs: 0, color: "#f76b15" }, null, question, "M2")).toBe("#f76b15");
    expect(monitorTextColor({ kind: "vote-result", fallbackText: "", startMs: 0, color: "#ffffff" }, "#e5484d", question, "M1")).toBe("#ffffff");
    expect(monitorTextColor({ kind: "placeholder", text: "P", startMs: 0, color: "#30a46c" }, null, phase({ kind: "narration" }), "M1")).toBe("#30a46c");
  });
  it("falls back to the vote result, then the answer colour, then white", () => {
    expect(monitorTextColor({ kind: "vote-result", fallbackText: "", startMs: 0 }, "#e5484d", question, "M2")).toBe("#e5484d");
    expect(monitorTextColor({ kind: "text", text: "A", startMs: 0 }, null, question, "M2")).toBe("#3e63dd");
    expect(monitorTextColor({ kind: "text", text: "A", startMs: 0 }, null, phase({ kind: "narration" }), "M1")).toBeNull();
    expect(monitorTextColor(null, null, null, "M1")).toBeNull();
  });
});
