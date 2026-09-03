import { describe, expect, it } from "vitest";
import {
  arenaEllipseSplitY,
  arenaQuadFourRegions,
  arenaQuadLandmarks,
  arenaQuadTwoRegions,
  centroid,
  quadrantOf,
  quadrantOfField,
  quadrantsOfField,
  zoneOfPolygons,
} from "./index.js";
import type { PolygonZone } from "./index.js";

describe("quadrantOf", () => {
  it("assigns the four open quadrants", () => {
    expect(quadrantOf(0.9, 0.1)).toBe("q1");
    expect(quadrantOf(0.1, 0.1)).toBe("q2");
    expect(quadrantOf(0.1, 0.9)).toBe("q3");
    expect(quadrantOf(0.9, 0.9)).toBe("q4");
  });

  it("follows the half-open boundary convention", () => {
    expect(quadrantOf(0.5, 0.1)).toBe("q1"); // x=0.5 -> right half
    expect(quadrantOf(0.1, 0.5)).toBe("q3"); // y=0.5 -> bottom half
    expect(quadrantOf(0.5, 0.5)).toBe("q4"); // exact center -> q4
  });
});

describe("quadrantOfField", () => {
  it("raises legacy ellipse splits above their geometric centre for perspective", () => {
    expect(arenaEllipseSplitY({ type: "ellipse", centerX: 0.5, centerY: 0.7, radiusX: 0.4, radiusY: 0.2 })).toBeCloseTo(0.644);
  });

  it("uses min/max for an x-axis two-quadrant field", () => {
    const field = {
      type: "two-quadrant" as const,
      axis: "x" as const,
      variant: "spectrum" as const,
      labels: { minLabel: "left", maxLabel: "right" },
    };
    expect(quadrantOfField(field, 0.499, 0.9)).toBe("min");
    expect(quadrantOfField(field, 0.5, 0.1)).toBe("max");
  });

  it("uses a configurable off-centre boundary for left/right fields", () => {
    const field = {
      type: "two-quadrant" as const,
      axis: "x" as const,
      variant: "split" as const,
      splitX: 0.47,
      labels: { minLabel: "left", maxLabel: "right" },
    };
    expect(quadrantOfField(field, 0.469, 0.5)).toBe("min");
    expect(quadrantOfField(field, 0.47, 0.5)).toBe("max");
  });

  it("uses min/max for a y-axis two-quadrant field", () => {
    const field = {
      type: "two-quadrant" as const,
      axis: "y" as const,
      variant: "spectrum" as const,
      labels: { minLabel: "top", maxLabel: "bottom" },
    };
    expect(quadrantOfField(field, 0.9, 0.499)).toBe("min");
    expect(quadrantOfField(field, 0.1, 0.5)).toBe("max");
  });

  it("clips votes to a calibrated ellipse and supports a perspective-raised split", () => {
    const arena = { type: "ellipse" as const, centerX: 0.5, centerY: 0.7, radiusX: 0.4, radiusY: 0.2, splitY: 0.65 };
    const four = {
      type: "four-quadrant" as const,
      xAxis: { minLabel: "left", maxLabel: "right" },
      yAxis: { minLabel: "top", maxLabel: "bottom" },
      arena,
    };
    const two = {
      type: "two-quadrant" as const,
      axis: "y" as const,
      variant: "spectrum" as const,
      labels: { minLabel: "top", maxLabel: "bottom" },
      arena,
    };

    expect(quadrantOfField(four, 0.35, 0.64)).toBe("q2");
    expect(quadrantOfField(four, 0.65, 0.75)).toBe("q4");
    expect(quadrantOfField(two, 0.5, 0.64)).toBe("min");
    expect(quadrantOfField(two, 0.5, 0.65)).toBe("max");
    expect(quadrantOfField(four, 0.05, 0.7)).toBeNull();
    expect(quadrantOfField(two, 0.5, 0.95)).toBeNull();
  });

  it("clips votes to a perspective-skewed arena quad and splits through its edge midpoints", () => {
    // A genuinely skewed trapezoid (no shared axis of symmetry) so an
    // axis-aligned x/y midpoint compare would misclassify points near the
    // slanted divider -- this exercises the actual line-side math.
    const arena = {
      type: "quad" as const,
      corners: [
        { x: 0.1, y: 0.1 },
        { x: 0.6, y: 0.15 },
        { x: 0.9, y: 0.9 },
        { x: 0.2, y: 0.85 },
      ] as [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ],
    };
    const four = {
      type: "four-quadrant" as const,
      xAxis: { minLabel: "left", maxLabel: "right" },
      yAxis: { minLabel: "top", maxLabel: "bottom" },
      arena,
    };
    const twoX = { type: "two-quadrant" as const, axis: "x" as const, variant: "spectrum" as const, labels: { minLabel: "left", maxLabel: "right" }, arena };
    const twoY = { type: "two-quadrant" as const, axis: "y" as const, variant: "spectrum" as const, labels: { minLabel: "top", maxLabel: "bottom" }, arena };

    expect(quadrantOfField(four, 0.6, 0.2)).toBe("q1"); // near the top-right corner
    expect(quadrantOfField(four, 0.5, 0.8)).toBe("q3"); // near the bottom, left of the skewed vertical split
    expect(quadrantOfField(four, 0.45, 0.5)).toBe("q4"); // the quad's own center -- exact boundary belongs to the max side
    expect(quadrantOfField(twoX, 0.6, 0.2)).toBe("max");
    expect(quadrantOfField(twoY, 0.5, 0.8)).toBe("max");
    expect(quadrantOfField(four, 0, 0)).toBeNull(); // outside every corner
  });
});

describe("arena quad geometry", () => {
  const corners = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ] as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];

  it("finds each edge midpoint and the overall center for a unit square", () => {
    expect(arenaQuadLandmarks(corners)).toEqual({
      topMid: { x: 0.5, y: 0 },
      rightMid: { x: 1, y: 0.5 },
      bottomMid: { x: 0.5, y: 1 },
      leftMid: { x: 0, y: 0.5 },
      center: { x: 0.5, y: 0.5 },
    });
  });

  it("splits a unit square into four equal sub-quads matching FOUR_QUADRANT_POSITIONS", () => {
    const regions = arenaQuadFourRegions(corners);
    expect(regions.q1).toEqual([{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 0.5 }]);
    expect(regions.q2).toEqual([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }]);
    expect(regions.q3).toEqual([{ x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }]);
    expect(regions.q4).toEqual([{ x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }, { x: 1, y: 1 }, { x: 0.5, y: 1 }]);
  });

  it("splits a unit square into two halves for each two-quadrant axis", () => {
    const x = arenaQuadTwoRegions(corners, "x");
    expect(x.min).toEqual([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }]);
    expect(x.max).toEqual([{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 1 }]);

    const y = arenaQuadTwoRegions(corners, "y");
    expect(y.min).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 0, y: 0.5 }]);
    expect(y.max).toEqual([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
  });
});

describe("centroid", () => {
  it("averages a polygon's vertices", () => {
    expect(centroid([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("polygon zones", () => {
  const zones: PolygonZone[] = [
    { id: "left", label: "Left", points: [{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 0.2, y: 1 }, { x: 0, y: 1 }] },
    { id: "middle", label: "Middle", points: [{ x: 0.4, y: 0 }, { x: 0.6, y: 0 }, { x: 0.6, y: 1 }, { x: 0.4, y: 1 }] },
    { id: "right", label: "Right", points: [{ x: 0.8, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.8, y: 1 }] },
  ];
  const field = { type: "polygon-zones" as const, zones };

  it("finds the containing zone", () => {
    expect(zoneOfPolygons(zones, 0.1, 0.5)).toBe("left");
    expect(zoneOfPolygons(zones, 0.5, 0.5)).toBe("middle");
    expect(zoneOfPolygons(zones, 0.9, 0.5)).toBe("right");
  });

  it("returns null when the point is outside every zone", () => {
    expect(zoneOfPolygons(zones, 0.3, 0.5)).toBeNull();
  });

  it("quadrantOfField and quadrantsOfField delegate to the zone list", () => {
    expect(quadrantOfField(field, 0.1, 0.5)).toBe("left");
    expect(quadrantOfField(field, 0.3, 0.5)).toBeNull();
    expect(quadrantsOfField(field)).toEqual(["left", "middle", "right"]);
  });
});
