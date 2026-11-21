import { describe, expect, it } from "vitest";
import { backdropDimPlan, isPictureOnlyClip, isTitleBackdrop } from "./backdropDim.js";

const title = { kind: "narration", text: "THEATERARBEIT", title: "3. Trainingsepoche", loopVideoSrc: "loop.mp4" };
const scene = { kind: "video", audioSrc: "voice.mp3", loopVideoSrc: "loop.mp4" };
const closing = { kind: "video" };

describe("isTitleBackdrop", () => {
  it("needs words and a background loop", () => {
    expect(isTitleBackdrop(title)).toBe(true);
    expect(isTitleBackdrop({ ...title, loopVideoSrc: undefined })).toBe(false);
    expect(isTitleBackdrop({ kind: "narration", text: " ", loopVideoSrc: "loop.mp4" })).toBe(false);
    expect(isTitleBackdrop({ kind: "narration", text: " ", title: "Titel", loopVideoSrc: "loop.mp4" })).toBe(true);
    expect(isTitleBackdrop(scene)).toBe(false);
    expect(isTitleBackdrop(null)).toBe(false);
  });
});

describe("isPictureOnlyClip", () => {
  it("is a video with no sound and no loop", () => {
    expect(isPictureOnlyClip(closing)).toBe(true);
    expect(isPictureOnlyClip(scene)).toBe(false);
    expect(isPictureOnlyClip({ kind: "video", extraAudioSrc: "a.mp3" })).toBe(false);
    expect(isPictureOnlyClip(title)).toBe(false);
  });
});

describe("backdropDimPlan", () => {
  it("keeps a title dimmed throughout", () => {
    expect(backdropDimPlan(title, false, false)).toEqual({ start: true, end: true });
  });

  it("dims a scene's last second before a title", () => {
    expect(backdropDimPlan(scene, false, true)).toEqual({ start: false, end: true });
  });

  it("stays dimmed through a scene between two titles", () => {
    expect(backdropDimPlan(scene, true, true)).toEqual({ start: true, end: true });
  });

  it("brightens a normal scene after a title from its start", () => {
    expect(backdropDimPlan(scene, true, false)).toEqual({ start: false, end: false });
  });

  it("holds the dim through a curtain closing after a title and lifts it at the end", () => {
    expect(backdropDimPlan(closing, true, false)).toEqual({ start: true, end: false });
    expect(backdropDimPlan(closing, false, false)).toEqual({ start: false, end: false });
  });
});
