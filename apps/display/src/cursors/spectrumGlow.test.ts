import { describe, expect, it } from "vitest";
import type { PositionField } from "@smartphonecracy/scenario";
import { projectOntoSegment, proximityStrength, spectrumSegment } from "./spectrumGlow.js";

const labels = { minLabel: "low", maxLabel: "high" };

describe("spectrum glow geometry", () => {
  it("uses the visible full-screen X and Y spectrum tracks", () => {
    expect(spectrumSegment({ type: "two-quadrant", axis: "x", variant: "spectrum", labels })).toEqual({
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
    });
    expect(spectrumSegment({ type: "two-quadrant", axis: "y", variant: "spectrum", labels })).toEqual({
      start: { x: 0.5, y: 0 },
      end: { x: 0.5, y: 1 },
    });
  });

  it("does not glow for a hard split or a non-spectrum question", () => {
    expect(spectrumSegment({ type: "two-quadrant", axis: "x", variant: "split", labels })).toBeNull();
    expect(spectrumSegment({
      type: "four-quadrant",
      xAxis: labels,
      yAxis: labels,
    })).toBeNull();
  });

  it("matches an ellipse spectrum at its calibrated split", () => {
    const field: PositionField = {
      type: "two-quadrant",
      axis: "x",
      variant: "spectrum",
      labels,
      arena: { type: "ellipse", centerX: 0.5, centerY: 0.6, radiusX: 0.4, radiusY: 0.2, splitY: 0.6 },
    };
    const segment = spectrumSegment(field)!;
    expect(segment.start.x).toBeCloseTo(0.1);
    expect(segment.start.y).toBeCloseTo(0.6);
    expect(segment.end.x).toBeCloseTo(0.9);
    expect(segment.end.y).toBeCloseTo(0.6);
  });

  it("matches a perspective quad's edge-midpoint spectrum", () => {
    const field: PositionField = {
      type: "two-quadrant",
      axis: "x",
      variant: "spectrum",
      labels,
      arena: {
        type: "quad",
        corners: [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.1 },
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.8 },
        ],
      },
    };
    expect(spectrumSegment(field)).toEqual({
      start: { x: 0.15000000000000002, y: 0.5 },
      end: { x: 0.8500000000000001, y: 0.5 },
    });
  });

  it("projects in display pixels, clamps to endpoints, and fades by proximity", () => {
    const segment = { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } };
    expect(projectOntoSegment({ x: 0.25, y: 0.6 }, segment, 1000, 500)).toEqual({
      point: { x: 250, y: 250 },
      distance: 50,
      position: 0.25,
    });
    expect(projectOntoSegment({ x: 1.2, y: 0.5 }, segment, 1000, 500).position).toBe(1);
    expect(proximityStrength(0, 100)).toBe(1);
    expect(proximityStrength(100, 100)).toBeCloseTo(Math.exp(-0.5));
    expect(proximityStrength(300, 100)).toBe(0);
  });
});
