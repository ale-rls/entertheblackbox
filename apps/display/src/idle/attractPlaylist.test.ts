import { describe, expect, it } from "vitest";
import { attractIndexAt } from "./attractPlaylist.js";

describe("attract playlist", () => {
  it("plays the hold clip every other time and alternates the others", () => {
    expect(Array.from({ length: 12 }, (_, position) => attractIndexAt(position, 3))).toEqual([
      0, 1, 0, 2,
      0, 1, 0, 2,
      0, 1, 0, 2,
    ]);
  });

  it("cycles every non-hold clip when the playlist grows", () => {
    expect(Array.from({ length: 8 }, (_, position) => attractIndexAt(position, 4))).toEqual([
      0, 1, 0, 2, 0, 3, 0, 1,
    ]);
  });

  it("keeps a single-video playlist on its only clip", () => {
    expect(attractIndexAt(20, 1)).toBe(0);
  });
});
