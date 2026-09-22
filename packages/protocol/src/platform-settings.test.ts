import { describe, expect, it } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS, displaySettingsSchema, resolveSignageVideoUrl, resolveWaitingVideoUrl, waitingVideoUrlSchema } from "./platform-settings.js";

describe("waiting display settings", () => {
  it("loads existing saved text without requiring a migration", () => {
    const { waitingVideoUrl, groupWaitingVideoUrls, signageVideoUrls, ...legacy } = DEFAULT_DISPLAY_SETTINGS;
    expect(displaySettingsSchema.parse(legacy)).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });
  it("isolates group overrides, inherits the default, and permits explicit black screens", () => {
    const settings = { ...DEFAULT_DISPLAY_SETTINGS, waitingVideoUrl: "/media/main.mp4", groupWaitingVideoUrls: { red: "/media/red.mp4", blue: "" } };
    expect(resolveWaitingVideoUrl(settings)).toBe("/media/main.mp4");
    expect(resolveWaitingVideoUrl(settings, "red")).toBe("/media/red.mp4");
    expect(resolveWaitingVideoUrl(settings, "blue")).toBe("");
    expect(resolveWaitingVideoUrl(settings, "other")).toBe("/media/main.mp4");
  });
  it("isolates signage overrides, inherits the shared default, and permits explicit black kiosks", () => {
    const settings = { ...DEFAULT_DISPLAY_SETTINGS, waitingVideoUrl: "/media/main.mp4", signageVideoUrls: { lobby: "/media/lobby-qr.mp4", entrance: "" } };
    expect(resolveSignageVideoUrl(settings, "lobby")).toBe("/media/lobby-qr.mp4");
    expect(resolveSignageVideoUrl(settings, "entrance")).toBe("");
    expect(resolveSignageVideoUrl(settings, "unconfigured")).toBe("/media/main.mp4");
  });
  it("accepts hosted videos but rejects unsafe or malformed URL schemes", () => {
    for (const url of ["", "/media/lobby.mp4", "https://example.org/lobby.webm"]) expect(waitingVideoUrlSchema.safeParse(url).success).toBe(true);
    for (const url of ["javascript:alert(1)", "file:///secret.mp4", "//example.org/video", "/\\example.org/video", " https://example.org/video", "relative.mp4"]) expect(waitingVideoUrlSchema.safeParse(url).success).toBe(false);
  });
});
