import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioPlayback, playbackAction } from "./audio-playback";

class Media extends EventTarget {
  src = "";
  currentTime = 0;
  paused = true;
  ended = false;
  seeking = false;
  readyState = 4;
  error: unknown = null;
  load = vi.fn(() => { this.error = null; this.currentTime = 0; });
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; this.dispatchEvent(new Event("pause")); });
  removeAttribute = vi.fn();
  emit(event: string) { this.dispatchEvent(new Event(event)); }
}
function setup() {
  vi.useFakeTimers();
  const media = new Media();
  const changed = vi.fn();
  const player = new AudioPlayback(media as unknown as HTMLAudioElement, "https://audio.test/stream/a", changed);
  return { media, player, changed };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("continuous phone audio", () => {
  it("offers start/resume only when playback needs a gesture", () => {
    expect(playbackAction("ready")).toBe("Start headphones");
    expect(playbackAction("blocked")).toBe("Resume headphones");
    for (const state of ["playing", "connecting", "reconnecting"] as const) expect(playbackAction(state)).toBeNull();
  });
  it("recovers an unexpected native pause even while hidden", async () => {
    vi.stubGlobal("document", { hidden: true });
    const {media, player} = setup();
    player.play(); media.emit("playing"); media.pause();
    expect(player.state).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(500);
    expect(media.load).toHaveBeenCalledTimes(2);
    expect(media.play).toHaveBeenCalledTimes(2);
    player.dispose();
  });
  it("reconnects quickly when playback stalls after it started, without error events", async () => {
    const {media, player} = setup();
    player.play(); media.emit("playing");
    await vi.advanceTimersByTimeAsync(8_000);
    expect(media.load).toHaveBeenCalledTimes(2);
    player.dispose();
  });
  it("gives a fresh connection the full buffering window before forcing a reconnect", async () => {
    const {media, player} = setup();
    player.play();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(media.load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(7_500);
    expect(media.load).toHaveBeenCalledTimes(2);
    player.dispose();
  });
  it("retries immediately on reconnection instead of sitting out the queued backoff", async () => {
    const {media, player} = setup();
    player.play(); media.emit("playing"); media.emit("error");
    expect(player.state).toBe("reconnecting");
    player.online();
    await Promise.resolve();
    expect(media.load).toHaveBeenCalledTimes(2);
    player.dispose();
  });
  it("never seeks or restarts progressing playback, including after sleep", async () => {
    const {media, player} = setup();
    player.play(); media.emit("playing");
    for (let i = 0; i < 30; i++) {
      media.currentTime += 5;
      media.emit("timeupdate");
      await vi.advanceTimersByTimeAsync(5000);
    }
    vi.setSystemTime(Date.now() + 60_000);
    media.currentTime += 60;
    player.check();
    expect(media.currentTime).toBe(210);
    expect(media.load).toHaveBeenCalledTimes(1);
    player.dispose();
  });
  it("a blocked start can be retried by a new user gesture", async () => {
    const {media, player} = setup();
    media.play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    player.play(); await Promise.resolve();
    expect(player.state).toBe("blocked");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(media.play).toHaveBeenCalledTimes(1);
    player.play(); media.emit("playing");
    expect(player.state).toBe("playing");
    expect(playbackAction(player.state)).toBeNull();
    player.dispose();
  });
  it("honors deliberate lock-screen pause and cancels queued retries", async () => {
    const {media, player} = setup();
    player.play(); media.emit("playing"); media.emit("error"); player.pause();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(player.state).toBe("paused");
    player.dispose();
  });
  it("ignores stale play rejections and stops retries after teardown", async () => {
    const {media, player} = setup();
    let reject!: (error: unknown) => void;
    media.play.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    player.play(); media.emit("error");
    await vi.advanceTimersByTimeAsync(500);
    media.emit("playing");
    reject(new DOMException("old attempt", "NotAllowedError"));
    await Promise.resolve();
    expect(player.state).toBe("playing");
    player.dispose(); media.emit("error");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(media.play).toHaveBeenCalledTimes(2);
  });
});
