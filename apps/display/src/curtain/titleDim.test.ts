import { describe, expect, it } from "vitest";
import { DIM_START_BAKED } from "./visibility.js";
import { TITLE_DIM_BAKED, dimmedPixel, titleDimTable } from "./titleDim.js";

/** The lit curtain's shader with no light (curtainRenderer.ts). */
const shader = (base: number, baked: number) => ((1 - Math.exp(-base * baked * 1.15)) * 0.9) ** (1 / 2.2);

describe("title dim", () => {
  it("dims to the vote's level", () => {
    expect(TITLE_DIM_BAKED).toBe(0.31);
  });

  it("leaves the picture unchanged at the level the plain video matches", () => {
    for (const v of [0, 0.1, 0.4, 0.7, 0.95, 1]) expect(dimmedPixel(v, DIM_START_BAKED)).toBeCloseTo(v, 6);
  });

  it("darkens a pixel exactly as the lit curtain draws the same base at the vote's level", () => {
    for (const base of [0.05, 0.2, 0.5, 1, 2]) {
      const plain = shader(base, DIM_START_BAKED);
      expect(dimmedPixel(plain, TITLE_DIM_BAKED)).toBeCloseTo(shader(base, TITLE_DIM_BAKED), 6);
    }
  });

  it("darkens shadows more than highlights, like the vote", () => {
    const ratio = (v: number) => dimmedPixel(v, TITLE_DIM_BAKED) / v;
    expect(ratio(0.1)).toBeLessThan(ratio(0.8));
  });

  it("builds a rising table from black to white", () => {
    const table = titleDimTable(TITLE_DIM_BAKED);
    expect(table[0]).toBe(0);
    for (let i = 1; i < table.length; i += 1) expect(table[i]!).toBeGreaterThan(table[i - 1]!);
    expect(table.at(-1)!).toBeLessThan(1);
  });
});
