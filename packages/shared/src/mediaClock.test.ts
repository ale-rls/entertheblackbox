import { afterEach, expect, it, vi } from "vitest";
import { ServerClock } from "./serverClock.js";
import { followMediaClock, type ClockMedia } from "./mediaClock.js";

afterEach(() => vi.useRealTimers());
function setup(startedAt = 1000, enabled = true) {
  vi.useFakeTimers(); vi.setSystemTime(5000);
  const clock = new ServerClock(); clock.addSample(5000, 5000, 9000);
  const listeners = new Map<string, () => void>();
  const media: ClockMedia = { currentTime: 0, duration: 20, readyState: 1, seeking: false, paused: true, playbackRate: 1,
    pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined),
    addEventListener: (event, listener) => { listeners.set(event, listener); },
    removeEventListener: (event) => { listeners.delete(event); },
  };
  const ended = vi.fn(), blocked = vi.fn();
  const stop = followMediaClock(media, clock, startedAt, { ended, blocked, enabled });
  return { clock, media, ended, blocked, stop, listeners };
}
it("seeks a late cue to corrected server time and recovers after buffering", async () => {
  const { media, stop } = setup();
  expect(media.currentTime).toBe(8);
  media.paused = false; media.currentTime = 8;
  await vi.advanceTimersByTimeAsync(2000);
  expect(media.currentTime).toBeGreaterThan(9.7);
  stop(); expect(media.playbackRate).toBe(1);
});
it("waits for a future cue and for metadata", async () => {
  const { media, stop } = setup(10000);
  expect(media.play).not.toHaveBeenCalled();
  media.readyState = 0;
  await vi.advanceTimersByTimeAsync(2000);
  expect(media.play).not.toHaveBeenCalled();
  media.readyState = 1;
  await vi.advanceTimersByTimeAsync(50);
  expect(media.currentTime).toBeCloseTo(1.05);
  stop();
});
it("does not restart outgoing media or repeatedly seek an outstanding decode", async () => {
  const inactive = setup(1000, false);
  expect(inactive.media.play).not.toHaveBeenCalled(); inactive.stop();
  const active = setup(); active.media.seeking = true; active.media.currentTime = 0;
  await vi.advanceTimersByTimeAsync(500);
  expect(active.media.currentTime).toBe(0); active.stop();
});
it("finishes once when a late join is past the media end", async () => {
  const { media, ended, listeners, stop } = setup(-20000);
  expect(media.currentTime).toBe(19.999);
  expect(ended).toHaveBeenCalledTimes(1);
  listeners.get("ended")?.(); await vi.advanceTimersByTimeAsync(2000);
  expect(ended).toHaveBeenCalledTimes(1); stop();
});
it("throttles blocked autoplay retries and stops after disposal", async () => {
  const { media, blocked, stop } = setup(10000);
  vi.mocked(media.play).mockRejectedValue(new Error("blocked"));
  await vi.advanceTimersByTimeAsync(1500);
  expect(blocked).toHaveBeenCalledTimes(1);
  stop(); await vi.advanceTimersByTimeAsync(2000);
  expect(blocked).toHaveBeenCalledTimes(1);
});
