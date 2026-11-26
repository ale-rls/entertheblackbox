// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DUCK_LEVEL, duckPageMedia, useAnnouncementVoice, type PlayingAnnouncement } from "./AnnouncementVoice.js";
import type { ServerClock } from "../lib/serverClock.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("duckPageMedia", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("lowers scene media, including media mounted while ducked, and restores it", async () => {
    const video = document.createElement("video");
    const quiet = document.createElement("audio");
    quiet.volume = 0.1;
    document.body.append(video, quiet);
    const restore = duckPageMedia(document, 0.25, 0);
    expect(video.volume).toBe(0.25);
    expect(quiet.volume).toBe(0.1);
    const next = document.createElement("audio");
    document.body.append(next);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(next.volume).toBe(0.25);
    restore();
    expect([video.volume, quiet.volume, next.volume]).toEqual([1, 0.1, 1]);
    const after = document.createElement("audio");
    document.body.append(after);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(after.volume).toBe(1);
  });
});

describe("useAnnouncementVoice", () => {
  let root: Root | null = null;
  afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.restoreAllMocks(); vi.useRealTimers(); });

  function Probe(props: { announcement: PlayingAnnouncement | null; clock: ServerClock; sound: boolean; onFinished: () => void }) {
    useAnnouncementVoice(props.announcement, props.clock, props.sound, props.onFinished);
    return null;
  }

  it("seeks to the server's position, ducks the scene, and restores it when the clip ends", () => {
    vi.useFakeTimers();
    const played: HTMLMediaElement[] = [];
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) { played.push(this); return Promise.resolve(); });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const scene = document.createElement("video");
    const host = document.createElement("div");
    document.body.append(scene, host);
    let now = 12_000;
    const clock = { now: () => now } as unknown as ServerClock;
    const onFinished = vi.fn();
    root = createRoot(host);
    const announcement = { id: "a1", url: "/media/announcements/a1.wav", startedAt: 10_000, durationMs: 5_000 };
    act(() => root!.render(<Probe announcement={announcement} clock={clock} sound onFinished={onFinished} />));
    expect(played).toHaveLength(1);
    expect(played[0]!.src).toContain("/media/announcements/a1.wav");
    expect(played[0]!.currentTime).toBe(2);
    expect(played[0]!.muted).toBe(false);
    act(() => { vi.advanceTimersByTime(500); });
    expect(scene.volume).toBe(DUCK_LEVEL);
    now = 15_600;
    act(() => { vi.advanceTimersByTime(3_600); });
    expect(onFinished).toHaveBeenCalled();
    act(() => root!.render(<Probe announcement={null} clock={clock} sound onFinished={onFinished} />));
    act(() => { vi.advanceTimersByTime(500); });
    expect(scene.volume).toBe(1);
  });

  it("waits for a start time that is still ahead", () => {
    vi.useFakeTimers();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const host = document.createElement("div");
    document.body.append(host);
    const clock = { now: () => Date.now() } as unknown as ServerClock;
    root = createRoot(host);
    act(() => root!.render(<Probe announcement={{ id: "a1", url: "/a.wav", startedAt: Date.now() + 300, durationMs: 1_000 }} clock={clock} sound={false} onFinished={() => {}} />));
    expect(play).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(play).toHaveBeenCalledTimes(1);
  });
});
