import { describe, expect, it } from "vitest";
import { backdropDimPlan, isDimmedBackdrop, isPictureOnlyClip, isTitleBackdrop, isVoteBackdrop } from "./backdropDim.js";

const title = { kind: "narration", text: "THEATERARBEIT", title: "3. Trainingsepoche", loopVideoSrc: "loop.mp4" };
const scene = { kind: "video", audioSrc: "voice.mp3", loopVideoSrc: "loop.mp4" };
const closing = { kind: "video" };
const openVote = { kind: "video-position-question", audioSrc: "voice.mp3", loopVideoSrc: "open-loop.mp4" };

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

describe("isVoteBackdrop", () => {
  it("is a vote over a loop that isn't drawn as curtain light", () => {
    expect(isVoteBackdrop(openVote)).toBe(true);
    expect(isVoteBackdrop({ ...openVote, kind: "position-question" })).toBe(true);
    expect(isVoteBackdrop({ ...openVote, loopVideoSrc: undefined })).toBe(false);
    expect(isVoteBackdrop({ ...openVote, curtainLightVote: true })).toBe(false);
    expect(isVoteBackdrop({ ...openVote, curtainLightVote: false })).toBe(true);
    expect(isVoteBackdrop(openVote, true)).toBe(false);
    expect(isVoteBackdrop({ ...openVote, kind: "position-question", spotlight: { diameterPercent: 20 } })).toBe(false);
    expect(isVoteBackdrop(scene)).toBe(false);
    expect(isDimmedBackdrop(openVote)).toBe(true);
    expect(isDimmedBackdrop(title)).toBe(true);
    expect(isDimmedBackdrop(scene)).toBe(false);
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

  it("keeps an open-curtain vote dimmed throughout", () => {
    expect(backdropDimPlan(openVote, false, false)).toEqual({ start: true, end: true });
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
