import { describe, expect, it } from "vitest";
import {
  classifyPositionVotes,
  classifyPositionVotesForField,
  countPositionQuadrants,
  countQuadrants,
  materializePositionStatus,
  resolveFixedTransition,
  resolvePositionFixedTransition,
  resolvePositionPlurality,
  resolveQuadrantPlurality,
} from "./resolution.js";

describe("resolution math", () => {
  const votes = [
    { x: 0.5, y: 0.25, status: "valid" },
    { x: 0.25, y: 0.5, status: "stale" },
    { x: 0.5, y: 0.5, status: "excluded" },
    { x: null, y: null, status: "valid" },
  ] as const;

  it("counts positioned votes with the shared boundary convention", () => {
    expect(countQuadrants(votes)).toEqual({ q1: 1, q2: 0, q3: 1, q4: 1 });
    expect(resolveFixedTransition(votes, "next")).toEqual({
      winner: "fixed", resolvedTarget: "next", quadrantCounts: { q1: 1, q2: 0, q3: 1, q4: 1 },
    });
  });

  it("filters statuses and distinguishes unique, tie, and empty outcomes", () => {
    expect(resolveQuadrantPlurality(votes, new Set(["valid"]))).toEqual({
      winner: "q1",
      quadrantCounts: { q1: 1, q2: 0, q3: 0, q4: 0 },
    });
    expect(resolveQuadrantPlurality(votes, new Set(["valid", "stale"]))).toEqual({
      winner: "tie",
      quadrantCounts: { q1: 1, q2: 0, q3: 1, q4: 0 },
    });
    expect(resolveQuadrantPlurality(votes, new Set(["missing"]))).toEqual({
      winner: "empty",
      quadrantCounts: { q1: 0, q2: 0, q3: 0, q4: 0 },
    });
  });

  it("materializes every status with disconnected precedence and classifies totals", () => {
    expect(materializePositionStatus({ connected: false, x: null, y: null, lastHeartbeatAt: null }, 100, 10)).toBe("disconnected");
    expect(materializePositionStatus({ connected: true, x: null, y: null, lastHeartbeatAt: 100 }, 100, 10)).toBe("never-moved");
    expect(materializePositionStatus({ connected: true, x: 0, y: 0, lastHeartbeatAt: 90 }, 100, 10)).toBe("stale");
    expect(materializePositionStatus({ connected: true, x: 0, y: 0, lastHeartbeatAt: 91 }, 100, 10)).toBe("valid");
    expect(classifyPositionVotes(votes, new Set(["valid", "stale"]))).toMatchObject({
      includedTotal: 2,
      excludedTotal: 2,
      includedByStatus: { valid: 1, stale: 1 },
      excludedByStatus: { excluded: 1, valid: 1 },
    });
  });

  it.each([
    [0.75, 0.25, "q1"], [0.25, 0.25, "q2"], [0.25, 0.75, "q3"], [0.75, 0.75, "q4"],
  ] as const)("resolves a unique %s/%s winner", (x, y, winner) => {
    expect(resolveQuadrantPlurality([{ x, y, status: "valid" }], new Set(["valid"])).winner).toBe(winner);
  });
});

describe("two-quadrant resolution math", () => {
  const xField = {
    type: "two-quadrant" as const,
    axis: "x" as const,
    labels: { minLabel: "disagree", maxLabel: "agree" },
  };
  const yField = {
    type: "two-quadrant" as const,
    axis: "y" as const,
    labels: { minLabel: "top", maxLabel: "bottom" },
  };
  const votes = [
    { x: 0.25, y: 0.75, status: "valid" },
    { x: 0.5, y: 0.25, status: "valid" },
    { x: 0.75, y: 0.5, status: "stale" },
    { x: null, y: null, status: "valid" },
  ] as const;

  it("counts only the active axis and assigns exact .5 to max", () => {
    expect(countPositionQuadrants(xField, votes)).toEqual({ min: 1, max: 2 });
    expect(countPositionQuadrants(yField, votes)).toEqual({ min: 1, max: 2 });
  });

  it("classifies inclusion totals with typed min/max counts", () => {
    expect(classifyPositionVotesForField(xField, votes, new Set(["valid"]))).toEqual({
      field: xField,
      quadrantCounts: { min: 1, max: 1 },
      includedByStatus: { valid: 2 },
      excludedByStatus: { stale: 1, valid: 1 },
      includedTotal: 2,
      excludedTotal: 2,
    });
  });

  it("resolves unique, tie, empty, and fixed outcomes", () => {
    expect(resolvePositionPlurality(xField, votes, new Set(["valid", "stale"]))).toMatchObject({
      winner: "max",
      quadrantCounts: { min: 1, max: 2 },
    });
    expect(resolvePositionPlurality(xField, votes, new Set(["valid"]))).toMatchObject({
      winner: "tie",
      quadrantCounts: { min: 1, max: 1 },
    });
    expect(resolvePositionPlurality(xField, votes, new Set(["missing"]))).toMatchObject({
      winner: "empty",
      quadrantCounts: { min: 0, max: 0 },
    });
    expect(resolvePositionFixedTransition(xField, votes, "next")).toEqual({
      field: xField,
      winner: "fixed",
      quadrantCounts: { min: 1, max: 2 },
      resolvedTarget: "next",
    });
  });

  it("excludes positioned votes outside a calibrated arena ellipse", () => {
    const arenaField = {
      ...xField,
      arena: { type: "ellipse" as const, centerX: 0.5, centerY: 0.7, radiusX: 0.4, radiusY: 0.2 },
    };
    const arenaVotes = [
      { x: 0.3, y: 0.7, status: "valid" },
      { x: 0.7, y: 0.7, status: "valid" },
      { x: 0.1, y: 0.2, status: "valid" },
    ] as const;

    expect(classifyPositionVotesForField(arenaField, arenaVotes, new Set(["valid"]))).toMatchObject({
      quadrantCounts: { min: 1, max: 1 },
      includedTotal: 2,
      excludedTotal: 1,
    });
  });
});

describe("polygon-zones resolution math", () => {
  const field = {
    type: "polygon-zones" as const,
    zones: [
      { id: "apollon", label: "Apollon", points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 1 }, { x: 0, y: 1 }] },
      { id: "dionysos", label: "Dionysos", points: [{ x: 0.35, y: 0 }, { x: 0.65, y: 0 }, { x: 0.65, y: 1 }, { x: 0.35, y: 1 }] },
      { id: "kassandra", label: "Kassandra", points: [{ x: 0.7, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.7, y: 1 }] },
    ],
  };
  const votes = [
    { x: 0.1, y: 0.5, status: "valid" },
    { x: 0.5, y: 0.5, status: "valid" },
    { x: 0.5, y: 0.5, status: "valid" },
    { x: 0.32, y: 0.5, status: "valid" }, // lands in the gap between zones
    { x: null, y: null, status: "valid" },
  ] as const;

  it("counts only positions inside a zone, excluding gaps", () => {
    expect(countPositionQuadrants(field, votes)).toEqual({ apollon: 1, dionysos: 2, kassandra: 0 });
  });

  it("classifies gap and never-moved votes as excluded", () => {
    expect(classifyPositionVotesForField(field, votes, new Set(["valid"]))).toMatchObject({
      quadrantCounts: { apollon: 1, dionysos: 2, kassandra: 0 },
      includedTotal: 3,
      excludedTotal: 2,
    });
  });

  it("resolves a unique winner among three zones", () => {
    expect(resolvePositionPlurality(field, votes, new Set(["valid"]))).toMatchObject({
      winner: "dionysos",
      quadrantCounts: { apollon: 1, dionysos: 2, kassandra: 0 },
    });
  });

  it("resolves empty when nothing lands in a zone", () => {
    const noVotes = [{ x: 0.32, y: 0.5, status: "valid" }] as const;
    expect(resolvePositionPlurality(field, noVotes, new Set(["valid"])).winner).toBe("empty");
  });
});
