import { describe, expect, it } from "vitest";
import { cursorOpacity } from "./CursorCanvas.js";
import { cursorsVisibleFrom } from "./cursorVisibility.js";

describe("cursorOpacity", () => {
  it("blinks active voters only while the resolved field is frozen", () => {
    expect(cursorOpacity(false, true, true, 0)).toBe(1);
    expect(cursorOpacity(false, true, true, 320)).toBe(0.08);
    expect(cursorOpacity(false, true, false, 320)).toBe(1);
    expect(cursorOpacity(false, false, true, 320)).toBe(1);
  });

  it("keeps replayed ghost cursors steady", () => {
    expect(cursorOpacity(true, true, true, 320)).toBe(0.5);
  });
});

describe("cursorsVisibleFrom", () => {
  it("holds cursors back for a scene's first seconds", () => {
    expect(cursorsVisibleFrom({ kind: "video", startedAt: 1_000, cursorsFromMs: 20_000 })).toBe(21_000);
    expect(cursorsVisibleFrom({ kind: "video", startedAt: 1_000 })).toBeNull();
    expect(cursorsVisibleFrom({ kind: "idle", startedAt: 1_000, cursorsFromMs: 5_000 })).toBeNull();
    expect(cursorsVisibleFrom(null)).toBeNull();
  });
});

