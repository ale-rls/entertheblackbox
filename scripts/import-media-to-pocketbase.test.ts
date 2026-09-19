import { describe, expect, it } from "vitest";
import { isMeasurable, mimeTypeFor, parseArgs } from "./import-media-to-pocketbase.js";

describe("mimeTypeFor", () => {
  it("maps every extension the PocketBase media collection accepts", () => {
    expect(mimeTypeFor("intro.mp4")).toBe("video/mp4");
    expect(mimeTypeFor("intro.webm")).toBe("video/webm");
    expect(mimeTypeFor("photo.JPG")).toBe("image/jpeg");
    expect(mimeTypeFor("photo.jpeg")).toBe("image/jpeg");
    expect(mimeTypeFor("photo.png")).toBe("image/png");
    expect(mimeTypeFor("photo.webp")).toBe("image/webp");
    expect(mimeTypeFor("narration.mp3")).toBe("audio/mpeg");
  });

  it("rejects anything else", () => {
    expect(mimeTypeFor("notes.txt")).toBeNull();
    expect(mimeTypeFor(".DS_Store")).toBeNull();
    expect(mimeTypeFor("manifest.json")).toBeNull();
  });
});

describe("isMeasurable", () => {
  it("is true only for video/audio mime types", () => {
    expect(isMeasurable("video/mp4")).toBe(true);
    expect(isMeasurable("audio/mpeg")).toBe(true);
    expect(isMeasurable("image/png")).toBe(false);
  });
});

describe("parseArgs", () => {
  it("defaults to content/media with no flags set", () => {
    expect(parseArgs([])).toEqual({ mediaDir: "content/media", dryRun: false, force: false });
  });

  it("accepts a media dir plus both flags in any order", () => {
    expect(parseArgs(["other/media", "--dry-run", "--force"])).toEqual({
      mediaDir: "other/media", dryRun: true, force: true,
    });
    expect(parseArgs(["--force", "other/media"])).toEqual({
      mediaDir: "other/media", dryRun: false, force: true,
    });
  });

  it("rejects more than one positional argument", () => {
    expect(() => parseArgs(["a", "b"])).toThrow(/usage/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown flag/);
  });
});
