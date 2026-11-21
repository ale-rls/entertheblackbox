import { describe, expect, it } from "vitest";
import { stepTextSwap, TEXT_OUT_MS, type TextSwap } from "./textSwap.js";

const oldQuestion = { question: "Wie gerne schaust du zu?" };
const newQuestion = { question: "Was fehlt dir am meisten?" };

describe("stepTextSwap", () => {
  it("keeps the old content (text and lit areas) on screen while its text fades out, then shows the new one at once", () => {
    let swap: TextSwap<typeof oldQuestion> = { shown: oldQuestion, startedAt: null };
    let step = stepTextSwap(swap, newQuestion, true, 1_000);
    expect(step.swap.shown).toBe(oldQuestion);
    expect(step.textOpacity).toBe(1);
    swap = step.swap;
    step = stepTextSwap(swap, newQuestion, true, 1_000 + TEXT_OUT_MS / 2);
    expect(step.swap.shown).toBe(oldQuestion);
    expect(step.textOpacity).toBeCloseTo(0.1);
    swap = step.swap;
    step = stepTextSwap(swap, newQuestion, true, 1_000 + TEXT_OUT_MS);
    expect(step.swap.shown).toBe(newQuestion);
    expect(step.textOpacity).toBe(1);
    expect(step.redraw).toBe(true);
  });

  it("shows the new question at once on a curtain fading in from black, without fading the old one", () => {
    const step = stepTextSwap({ shown: oldQuestion, startedAt: null }, newQuestion, false, 1_000);
    expect(step.swap).toEqual({ shown: newQuestion, startedAt: null });
    expect(step.textOpacity).toBe(1);
    expect(step.redraw).toBe(true);
  });

  it("swaps at once when the curtain goes dark halfway through a fade", () => {
    const half = stepTextSwap({ shown: oldQuestion, startedAt: 1_000 }, newQuestion, false, 1_300);
    expect(half.swap.shown).toBe(newQuestion);
  });

  it("does nothing while the content is unchanged", () => {
    const swap = { shown: oldQuestion, startedAt: null };
    expect(stepTextSwap(swap, oldQuestion, true, 5_000)).toEqual({ swap, textOpacity: 1, redraw: false });
  });
});
