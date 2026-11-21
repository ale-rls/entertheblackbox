import { describe, expect, it } from "vitest";
import { CURTAIN_LEAVE_MS, DIM_IN_MS, DIM_START_BAKED, FADE_OUT_MS, curtainVisibility, dimmedBaked } from "./visibility.js";

describe("curtainVisibility", () => {
  it("shows the fabric from the first video frame, before the question is due", () => {
    expect(curtainVisibility({ now: 100, visibleFrom: 500, leavingForMs: null, videoReady: true })).toEqual({ fabric: 1, content: false });
  });

  it("shows the question at once when it is due, with no fade-in", () => {
    expect(curtainVisibility({ now: 500, visibleFrom: 500, leavingForMs: null, videoReady: true })).toEqual({ fabric: 1, content: true });
  });

  it("keeps the layer clear until there is a video frame or the question is due", () => {
    expect(curtainVisibility({ now: 100, visibleFrom: 500, leavingForMs: null, videoReady: false }).fabric).toBe(0);
    expect(curtainVisibility({ now: 500, visibleFrom: 500, leavingForMs: null, videoReady: false }).fabric).toBe(1);
  });

  it("is fully up when the question has no start time", () => {
    expect(curtainVisibility({ now: 0, leavingForMs: null, videoReady: false })).toEqual({ fabric: 1, content: true });
  });

  it("fades out when the question hides early and when the next scene takes over", () => {
    expect(curtainVisibility({ now: 1_000 - FADE_OUT_MS / 2, visibleUntil: 1_000, leavingForMs: null, videoReady: true }).fabric).toBeCloseTo(0.5);
    expect(curtainVisibility({ now: 2_000, visibleUntil: 1_000, leavingForMs: null, videoReady: true }).fabric).toBe(0);
    expect(curtainVisibility({ now: 0, leavingForMs: CURTAIN_LEAVE_MS / 2, videoReady: true }).fabric).toBeCloseTo(0.5);
    expect(curtainVisibility({ now: 0, leavingForMs: CURTAIN_LEAVE_MS, videoReady: true }).fabric).toBe(0);
  });
});

describe("dimmedBaked", () => {
  it("starts at the plain curtain's brightness and eases down to the show's level", () => {
    expect(dimmedBaked(0.31, null)).toBe(DIM_START_BAKED);
    expect(dimmedBaked(0.31, 0)).toBe(DIM_START_BAKED);
    const mid = dimmedBaked(0.31, DIM_IN_MS / 2);
    expect(mid).toBeLessThan(DIM_START_BAKED);
    expect(mid).toBeGreaterThan(0.31);
    expect(dimmedBaked(0.31, DIM_IN_MS)).toBeCloseTo(0.31);
    expect(dimmedBaked(0.31, DIM_IN_MS * 5)).toBeCloseTo(0.31);
  });

  it("never brightens a curtain set brighter than the start level", () => {
    expect(dimmedBaked(2.5, 0)).toBe(2.5);
  });

  it("starts from a dimmed title's level instead", () => {
    expect(dimmedBaked(0.31, 0, 0.31)).toBe(0.31);
    expect(dimmedBaked(0.31, 0, 1)).toBe(1);
    expect(dimmedBaked(0.31, DIM_IN_MS, 1)).toBe(0.31);
  });
});
