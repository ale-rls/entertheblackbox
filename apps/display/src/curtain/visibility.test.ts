import { describe, expect, it } from "vitest";
import { CURTAIN_LEAVE_MS, FADE_OUT_MS, curtainVisibility } from "./visibility.js";

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
