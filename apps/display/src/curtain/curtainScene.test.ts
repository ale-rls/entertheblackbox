import { describe, expect, it } from "vitest";
import type { CurtainTreatment } from "@entertheblackbox/protocol";
import { curtainVoteField, resolveCurtainSettings, type FourQuadrantField, type TwoQuadrantField } from "@entertheblackbox/shared";
import { CurtainScene } from "./curtainScene.js";
import { coverCrop, encodeLightMap, FABRIC_FS } from "./curtainRenderer.js";

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
  });

  it("lights each cursor in its participant's own colour, wherever it stands", () => {
    const scene = new CurtainScene(field, treatment);
    // #ff0000 is the "min" answer's colour; this cursor stands in the "max" field.
    const [light, plain] = scene.cursorLights([
      { x: 0.9, y: 0.5, ghost: false, color: "#00f5d4" },
      { x: 0.1, y: 0.5, ghost: false },
    ], 0);
    expect(light!.rgb[0]).toBe(0);
    expect(light!.rgb[1]).toBeGreaterThan(0.8);
    expect(plain!.rgb).toEqual([1, 1, 1]);
  });

  it("lights every field in the same neutral colour and divides them with a line", () => {
    const scene = new CurtainScene(field, treatment);
    expect(scene.colorsLinear[0]).toEqual(scene.colorsLinear[1]);
    const [r, g, b] = scene.colorsLinear[0]!;
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.15);
    // Left/right vote: one vertical line through the middle of the neutral gap.
    expect(scene.divisions).toHaveLength(1);
    const [x1, y1, x2, y2] = scene.divisions[0]!;
    expect(x1).toBeCloseTo(0.5);
    expect(x2).toBeCloseTo(0.5);
    expect(y1).toBeLessThan(0.1);
    expect(y2).toBeGreaterThan(0.9);
  });

  it("divides a four-way vote with a cross", () => {
    const four = curtainVoteField<FourQuadrantField>({ type: "four-quadrant", xAxis: { minLabel: "L", maxLabel: "R" }, yAxis: { minLabel: "T", maxLabel: "B" } });
    const scene = new CurtainScene(four, { ...treatment, answerColors: {} });
    expect(scene.divisions).toHaveLength(2);
    const [vertical, horizontal] = scene.divisions;
    expect(vertical![0]).toBeCloseTo(vertical![2]);
    expect(horizontal![1]).toBeCloseTo(horizontal![3]);
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

describe("curtain fabric shader", () => {
  it("samples the rendered cursor-flood buffer with v flipped, so floods sit under their cores", () => {
    // Sprites write y-down positions as clip y = 1 - 2y; a framebuffer stores clip +1 at v = 1,
    // while the fabric pass's uv has v = 0 at the top of the screen.
    expect(FABRIC_FS).toContain("texture(cursorLight, vec2(uv.x, 1. - uv.y))");
    expect(FABRIC_FS).not.toContain("texture(cursorLight, uv)");
  });
});
