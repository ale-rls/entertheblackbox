import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fadeOutSkippedAudio, setSkipFadeCopyFactory, setSkipFadeUrlHold, SKIP_FADE_MS } from "./skipFade.js";

function fakeCopy() {
  const listeners = new Map<string, () => void>();
  return {
    src: "", preload: "", volume: 1, currentTime: 0,
    play: vi.fn(async () => {}), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(),
    addEventListener: vi.fn((event: string, listener: () => void) => { listeners.set(event, listener); }),
    fire: (event: string) => listeners.get(event)?.(),
  };
}
const media = (overrides: Partial<HTMLMediaElement> = {}) => ({
  paused: false, ended: false, muted: false, volume: 0.8, currentTime: 12, currentSrc: "blob:a", src: "blob:a", ...overrides,
}) as HTMLMediaElement;

describe("fadeOutSkippedAudio", () => {
  let copy: ReturnType<typeof fakeCopy>;
  const hold = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    copy = fakeCopy();
    setSkipFadeCopyFactory(() => copy as never);
    setSkipFadeUrlHold(hold);
    hold.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); setSkipFadeUrlHold(null); });

  it("continues sounding media from a detached copy and ramps it to silence over 3 s", () => {
    expect(fadeOutSkippedAudio(media())).toBe(true);
    expect(hold).toHaveBeenCalledWith("blob:a", SKIP_FADE_MS + 1000);
    expect(copy.src).toBe("blob:a");
    expect(copy.volume).toBe(0.8);
    copy.fire("loadedmetadata");
    expect(copy.currentTime).toBeGreaterThanOrEqual(12);
    expect(copy.play).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1500);
    expect(copy.volume).toBeGreaterThan(0.3);
    expect(copy.volume).toBeLessThan(0.5);
    vi.advanceTimersByTime(1600);
    expect(copy.pause).toHaveBeenCalledOnce();
    expect(copy.removeAttribute).toHaveBeenCalledWith("src");
  });

  it("leaves media that ended naturally, is paused, muted or silent alone", () => {
    for (const m of [media({ ended: true }), media({ paused: true }), media({ muted: true }), media({ volume: 0 }), media({ currentSrc: "", src: "" }), null]) {
      expect(fadeOutSkippedAudio(m)).toBe(false);
    }
    expect(hold).not.toHaveBeenCalled();
  });
});
