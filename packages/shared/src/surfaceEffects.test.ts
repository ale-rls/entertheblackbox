import { describe, expect, it } from "vitest";
import { dimColor, hueColor, mixColor, surfaceEffectColor, type SurfaceEffect } from "./surfaceEffects.js";

const effect = (kind: SurfaceEffect["kind"], extra: Partial<SurfaceEffect> = {}): SurfaceEffect =>
  ({ kind, color: "#ff0000", color2: "#0000ff", periodMs: 1_000, brightness: 1, ...extra });

describe("surface effects", () => {
  it("dims, mixes and spins hues", () => {
    expect(dimColor("#ff8000", 0.5)).toBe("#804000");
    expect(dimColor("#ffffff", 0)).toBe("#000000");
    expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect([0, 1 / 3, 2 / 3, 1].map(hueColor)).toEqual(["#ff0000", "#00ff00", "#0000ff", "#ff0000"]);
  });

  it("chases one device at a time with a fading tail, cycling through every device once per period", () => {
    const frame = (ms: number) => [0, 1, 2, 3, 4].map((i) => surfaceEffectColor(effect("chase"), i, 5, ms));
    // The tail wraps: the loop is continuous.
    expect(frame(0)).toEqual(["#ff0000", "#000000", "#000000", "#1a0000", "#590000"]);
    expect(frame(450)).toEqual(["#1a0000", "#590000", "#ff0000", "#000000", "#000000"]);
    expect(frame(1_000)).toEqual(frame(0));
  });

  it("breathes every device together and travels waves across the device order", () => {
    expect(surfaceEffectColor(effect("breathe"), 0, 4, 0)).toBe("#000000");
    expect(surfaceEffectColor(effect("breathe"), 3, 4, 500)).toBe("#ff0000");
    // At t=0 the wave peaks on the middle device of four.
    const wave = [0, 1, 2, 3].map((i) => surfaceEffectColor(effect("wave"), i, 4, 0));
    expect([wave[0], wave[2]]).toEqual(["#000000", "#ff0000"]);
    expect(wave[1]).toMatch(/^#(7f|80)0000$/);
    expect(surfaceEffectColor(effect("wave"), 2, 4, 250)).toBe(surfaceEffectColor(effect("wave"), 3, 4, 500));
    expect(surfaceEffectColor(effect("gradient"), 2, 4, 0)).toBe("#0000ff");
    expect(surfaceEffectColor(effect("rainbow"), 0, 3, 0)).toBe("#ff0000");
    expect(surfaceEffectColor(effect("rainbow"), 1, 3, 0)).toBe("#0000ff");
  });

  it("applies the master dimmer to every effect", () => {
    expect(surfaceEffectColor(effect("chase", { brightness: 0.5 }), 0, 3, 0)).toBe("#800000");
    expect(surfaceEffectColor(effect("rainbow", { brightness: 0 }), 0, 3, 0)).toBe("#000000");
  });
});
