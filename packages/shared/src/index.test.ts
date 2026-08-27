import { describe, expect, it } from "vitest";
import { quadrantOf, quadrantOfField, quadrantsOfField, zoneOfPolygons } from "./index.js";
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
  it("uses min/max for an x-axis two-quadrant field", () => {
    const field = {
      type: "two-quadrant" as const,
      axis: "x" as const,
      labels: { minLabel: "left", maxLabel: "right" },
    };
    expect(quadrantOfField(field, 0.499, 0.9)).toBe("min");
    expect(quadrantOfField(field, 0.5, 0.1)).toBe("max");
  });

  it("uses min/max for a y-axis two-quadrant field", () => {
    const field = {
      type: "two-quadrant" as const,
      axis: "y" as const,
      labels: { minLabel: "top", maxLabel: "bottom" },
    };
    expect(quadrantOfField(field, 0.9, 0.499)).toBe("min");
    expect(quadrantOfField(field, 0.1, 0.5)).toBe("max");
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
