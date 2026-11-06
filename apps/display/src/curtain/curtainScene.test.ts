import { describe, expect, it } from "vitest";
import type { CurtainTreatment } from "@entertheblackbox/protocol";
import { curtainVoteField, resolveCurtainSettings, type TwoQuadrantField } from "@entertheblackbox/shared";
import { CurtainScene } from "./curtainScene.js";
import { coverCrop, encodeLightMap } from "./curtainRenderer.js";

const field = curtainVoteField<TwoQuadrantField>({ type: "two-quadrant", axis: "x", variant: "split", labels: { minLabel: "No", maxLabel: "Yes" } });
const treatment: CurtainTreatment = {
  type: "curtain-light",
  curtain: resolveCurtainSettings({ src: "c.mp4" }),
  answerColors: { min: "#ff0000", max: "#0000ff" },
  entry: { x: 0.5, y: 0.5 },
};

describe("CurtainScene", () => {
  it("brightens pools toward live shares and settles back without a winner spotlight", () => {
    const scene = new CurtainScene(field, treatment);
    for (let t = 0; t < 40; t += 1) scene.step(100, { min: 3, max: 1 }, false, t * 100);
    const [min, max] = scene.currentIntensities;
    expect(min!).toBeGreaterThan(max!);
    for (let t = 40; t < 80; t += 1) scene.step(100, { min: 3, max: 1 }, true, t * 100);
    expect(scene.currentIntensities[0]).toBeCloseTo(scene.currentIntensities[1]!, 3);
    expect(scene.cursorOpacity(4_000 + 2_000)).toBe(0);
  });

  it("floods more strongly inside a counting area and pulses on touch", () => {
    const scene = new CurtainScene(field, treatment);
    const [neutral, counted] = scene.cursorLights([
      { x: 0.5, y: 0.5, ghost: false, pulseAt: 1_000 },
      { x: 0.9, y: 0.5, ghost: false },
      { x: 0.1, y: 0.5, ghost: true },
    ], 1_000);
    expect(counted!.flood).toBeGreaterThan(neutral!.flood);
    expect(neutral!.pulse).toBe(1);
    expect(counted!.pulse).toBe(0);
    expect(counted!.rgb[2]).toBeGreaterThan(counted!.rgb[0]);
  });

  it("keeps labels for both pools", () => {
    expect(new CurtainScene(field, treatment).labels.map((label) => label.text)).toEqual(["No", "Yes"]);
  });
});

describe("renderer helpers", () => {
  it("crops the clip to cover wide and narrow viewports", () => {
    const wide = coverCrop(2.08);
    expect(wide[0]).toBe(0);
    expect(wide[3]).toBeLessThan(1);
    const narrow = coverCrop(16 / 9);
    expect(narrow[2]).toBeLessThan(1);
    expect(narrow[1]).toBe(0);
  });

  it("encodes light maps with headroom above 1", () => {
    const out = encodeLightMap(new Float32Array([0, 1, 4]), new Uint8Array(4));
    expect([...out]).toEqual([0, 128, 255, 255]);
  });
});
