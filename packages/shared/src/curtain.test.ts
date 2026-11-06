import { describe, expect, it } from "vitest";
import {
  buildPoolMasks,
  composeLightMap,
  curtainLabels,
  curtainVoteField,
  cursorTint,
  hexToLinear,
  neutralEntryPoint,
  poolCoverage,
  poolIntensities,
  quadrantOfField,
  resolveAnswerColors,
  resolveCurtainSettings,
  type FourQuadrantField,
  type PolygonZonesField,
  type TwoQuadrantField,
} from "./index.js";

const axis = (min: string, max: string) => ({ minLabel: min, maxLabel: max });
const leftRight: TwoQuadrantField = { type: "two-quadrant", axis: "x", variant: "split", labels: axis("No", "Yes") };
const four: FourQuadrantField = { type: "four-quadrant", xAxis: axis("L", "R"), yAxis: axis("T", "B") };
const three: PolygonZonesField = {
  type: "polygon-zones",
  zones: [
    { id: "a", label: "A", points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 1 }, { x: 0, y: 1 }] },
    { id: "b", label: "B", points: [{ x: 0.35, y: 0 }, { x: 0.65, y: 0 }, { x: 0.65, y: 1 }, { x: 0.35, y: 1 }] },
    { id: "c", label: "C", points: [{ x: 0.7, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.7, y: 1 }] },
  ],
};

describe("neutral gaps", () => {
  it("leaves a band around a two-way split uncounted", () => {
    const field = { ...leftRight, neutralGap: 0.1 };
    expect(quadrantOfField(field, 0.46, 0.5)).toBeNull();
    expect(quadrantOfField(field, 0.54, 0.2)).toBeNull();
    expect(quadrantOfField(field, 0.44, 0.5)).toBe("min");
    expect(quadrantOfField(field, 0.56, 0.5)).toBe("max");
  });

  it("follows an off-centre split", () => {
    const field = { ...leftRight, splitX: 0.3, neutralGap: 0.1 };
    expect(quadrantOfField(field, 0.3, 0.5)).toBeNull();
    expect(quadrantOfField(field, 0.24, 0.5)).toBe("min");
    expect(quadrantOfField(field, 0.36, 0.5)).toBe("max");
  });

  it("forms an unlit cross in four quadrants", () => {
    const field = { ...four, neutralGap: 0.1 };
    expect(quadrantOfField(field, 0.5, 0.1)).toBeNull();
    expect(quadrantOfField(field, 0.1, 0.52)).toBeNull();
    expect(quadrantOfField(field, 0.1, 0.1)).toBe("q2");
    expect(quadrantOfField(field, 0.9, 0.9)).toBe("q4");
  });

  it("measures the band against a calibrated quad's own split lines", () => {
    const field: FourQuadrantField = {
      ...four,
      neutralGap: 0.08,
      arena: { type: "quad", corners: [{ x: 0.3, y: 0.2 }, { x: 0.7, y: 0.2 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }] },
    };
    expect(quadrantOfField(field, 0.5, 0.55)).toBeNull();
    expect(quadrantOfField(field, 0.7, 0.8)).toBe("q4");
    expect(quadrantOfField(field, 0.05, 0.05)).toBeNull();
  });

  it("keeps the original half-open boundary without a gap", () => {
    expect(quadrantOfField(leftRight, 0.5, 0.5)).toBe("max");
    expect(quadrantOfField(four, 0.5, 0.5)).toBe("q4");
  });
});

describe("curtain defaults", () => {
  it("adds the default gap only where the stage set none", () => {
    expect(curtainVoteField(leftRight).neutralGap).toBeGreaterThan(0);
    expect(curtainVoteField({ ...leftRight, neutralGap: 0 }).neutralGap).toBe(0);
    expect(curtainVoteField(three)).toBe(three);
  });

  it("falls back to system colours for missing or invalid overrides", () => {
    const colors = resolveAnswerColors(four, { q1: "#123456", q2: "red" });
    expect(colors.q1).toBe("#123456");
    expect(colors.q2).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colors.q2).not.toBe("red");
    expect(new Set(Object.values(resolveAnswerColors(four))).size).toBe(4);
  });

  it("layers stage tuning over the shared curtain", () => {
    const settings = resolveCurtainSettings({ src: "c.mp4", poolBase: 0.2 }, { poolBase: 0.4 });
    expect(settings.src).toBe("c.mp4");
    expect(settings.poolBase).toBe(0.4);
    expect(settings.shine).toBe(1);
  });
});

describe("neutralEntryPoint", () => {
  it("uses the centre of a gapped field", () => {
    expect(neutralEntryPoint(curtainVoteField(four))).toEqual({ x: 0.5, y: 0.5 });
  });

  it("moves off a polygon that covers the centre, into neutral space", () => {
    const point = neutralEntryPoint(three)!;
    expect(point).not.toBeNull();
    expect(quadrantOfField(three, point.x, point.y)).toBeNull();
    expect(Math.abs(point.x - 0.5)).toBeLessThan(0.2);
  });

  it("returns null when no neutral space exists", () => {
    expect(neutralEntryPoint(leftRight)).toBeNull();
  });
});

describe("pool masks", () => {
  it("lights only counting cells before softening, so pools never cross the gap", () => {
    const field = curtainVoteField(leftRight, 0.1);
    const pools = buildPoolMasks(field, 100, 50);
    for (let row = 0; row < 50; row += 1) {
      for (let column = 0; column < 100; column += 1) {
        const outcome = quadrantOfField(field, (column + 0.5) / 100, (row + 0.5) / 50);
        expect(pools.counted[row * 100 + column]).toBe(outcome === null ? -1 : pools.outcomes.indexOf(outcome));
      }
    }
    const coverage = poolCoverage(pools);
    expect(coverage.min).toBeGreaterThan(0.4);
    expect(coverage.max).toBeGreaterThan(0.4);
  });

  it("labels split pools at their lit centres and keeps four-quadrant axis ends", () => {
    const labels = curtainLabels(curtainVoteField(leftRight));
    expect(labels.map((label) => label.text)).toEqual(["No", "Yes"]);
    expect(labels[0]!.x).toBeLessThan(0.3);
    expect(curtainLabels(curtainVoteField(four)).map((label) => label.text)).toEqual(["L", "R", "T", "B"]);
  });

  it("grows spectrum light toward the ends", () => {
    const field = curtainVoteField({ ...leftRight, variant: "spectrum" as const });
    const pools = buildPoolMasks(field, 96, 54);
    const row = 27 * 96;
    expect(pools.masks[1]![row + 92]!).toBeGreaterThan(pools.masks[1]![row + 56]!);
  });

  it("brightens with share and caps the brightest pool", () => {
    const lighting = { poolBase: 0.5, poolGain: 1 };
    expect(poolIntensities(["a", "b"], { a: 3, b: 1 }, lighting)).toEqual([1.25, 0.75]);
    expect(poolIntensities(["a", "b"], null, lighting)).toEqual([0.5, 0.5]);
  });

  it("composes coloured light and tints nearby cursors", () => {
    const field = curtainVoteField(leftRight);
    const pools = buildPoolMasks(field, 48, 27);
    const colors = [hexToLinear("#ff0000"), hexToLinear("#0000ff")];
    const map = composeLightMap(pools, colors, [1, 1]);
    const left = (13 * 48 + 4) * 3;
    expect(map[left]).toBeGreaterThan(0.5);
    expect(map[left + 2]).toBe(0);
    const tint = cursorTint(pools, colors, 0.9, 0.5);
    expect(tint.rgb[2]).toBeGreaterThan(tint.rgb[0]);
    expect(cursorTint(pools, colors, 0.5, 0.5).weight).toBeLessThan(0.5);
  });
});
