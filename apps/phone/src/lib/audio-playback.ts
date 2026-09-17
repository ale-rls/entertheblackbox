import { AudioProgress } from "./audio-progress";

export type PlaybackState = "ready" | "connecting" | "playing" | "reconnecting" | "blocked" | "paused";
export const playbackMessage: Record<PlaybackState, string> = {
  ready: "Put on your headphones, then start the audio.",
  connecting: "Connecting headphones… Keep this page open until you hear audio.",
  playing: "Headphone audio is playing.",
  reconnecting: "Audio interrupted. Reconnecting…",
  blocked: "Tap Resume headphones to allow playback.",
  paused: "Headphones paused.",
};
export function playbackAction(state: PlaybackState): string | null {
  return state === "ready" ? "Start headphones" : state === "blocked" || state === "paused" ? "Resume headphones" : null;
}

/** Owns one native stream. A healthy stream is never sought or reloaded. */
export class AudioPlayback {
  state: PlaybackState = "ready";
  private wanted = false;
  private suspended = false;
  private disposed = false;
  private generation = 0;
  private attempts = 0;
  private everPlayed = false;
  private loaded = false;
  private resuming = false;
  private playPending = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval>;
  private progress = new AudioProgress();
  private readonly handlers: Record<string, () => void>;

  /**
   * Allow native startup buffering independently of the Icecast queue limit.
   * A stream that was already playing and then stalls
   * is a real dropout and should not sit silent for that long before we
   * force a reconnect.
   */
  private stallThresholdMs(): number { return this.everPlayed ? 5_000 : 15_000; }

  constructor(private audio: HTMLAudioElement, private url: string,
    private changed: (state: PlaybackState) => void) {
    this.handlers = {
      playing: () => {
        if (!this.wanted || !this.loaded || audio.paused || audio.error || audio.ended) return;
        this.resuming = false;
        this.progress.reset(audio.currentTime);
        this.attempts = 0;
        this.everPlayed = true;
        this.clearRetry();
        this.setState("playing");
      },
      timeupdate: () => { this.observeProgress(); },
      waiting: () => { if (this.wanted) this.setState("reconnecting"); },
      // A stalled download can still have playable buffered audio.
      stalled: () => this.check(),
      pause: () => { if (this.wanted && this.state !== "connecting") this.scheduleRetry(); },
      error: () => { this.loaded = false; this.scheduleRetry(); },
      ended: () => { this.loaded = false; this.scheduleRetry(); },
    };
    for (const [event, fn] of Object.entries(this.handlers)) audio.addEventListener(event, fn);
    this.progress.reset(audio.currentTime);
    // Hidden tabs may suspend timers, but when they do run recovery must not
    // deliberately skip them. Native media events also initiate recovery.
    this.watchdog = setInterval(this.check, 2000);
  }

  private setState(state: PlaybackState): void {
    if (this.disposed || this.state === state) return;
    this.state = state;
    this.changed(state);
  }
  private clearRetry(): void { clearTimeout(this.retry); this.retry = undefined; }

  play = (): void => {
    if (this.disposed) return;
    if (this.suspended) { this.wanted = true; return; }
    const deliberateResume = this.state === "paused";
    if (this.wanted && !this.needsRecovery()) return;
    this.wanted = true;
    // A deliberate pause may leave minutes of old narration buffered.
    this.start(deliberateResume || !this.loaded || !!this.audio.error || this.audio.ended);
  };

  /** Only replace a dead transport; an OS pause can resume the existing stream. */
  private start(reload: boolean): void {
    if (this.suspended) return;
    this.clearRetry();
    this.setState(this.everPlayed ? "reconnecting" : "connecting");
    const generation = ++this.generation;
    if (reload) {
      this.everPlayed = false;
      this.resuming = false;
      this.loaded = true;
      this.audio.src = `${this.url}${this.url.includes("?") ? "&" : "?"}t=${Date.now()}`;
      this.audio.load();
    } else this.resuming = true;
    this.progress.reset(this.audio.currentTime);
    this.playPending = true;
    void this.audio.play().then(() => {
      if (generation === this.generation) this.playPending = false;
    }, (error: unknown) => {
      if (generation !== this.generation || !this.wanted || this.disposed) return;
      this.playPending = false;
      const name = (error as { name?: string } | null)?.name;
      if (name === "NotAllowedError") {
        this.wanted = false;
        this.clearRetry();
        this.setState("blocked");
      } else this.scheduleRetry();
    });
  }

  /** Backend changes retain the user's playback intent and native element. */
  setUrl(url: string): void {
    if (this.disposed || url === this.url) return;
    this.url = url;
    this.loaded = false;
    if (this.wanted) this.start(true);
  }

  private observeProgress(): boolean {
    if (!this.wanted || !this.loaded || this.audio.paused || this.audio.seeking || this.audio.error || this.audio.ended) return false;
    if (!this.progress.advanced(this.audio.currentTime)) return false;
    this.everPlayed = true;
    this.resuming = false;
    this.attempts = 0;
    this.clearRetry();
    this.setState("playing");
    return true;
  }

  private needsRecovery(): boolean {
    if (this.observeProgress()) return false;
    return !this.loaded || !!this.audio.error || this.audio.ended || (this.audio.paused && !this.playPending)
      || this.progress.stalled(this.audio.currentTime, undefined, this.stallThresholdMs());
  }

  private recover = (): void => {
    if (!this.wanted || this.disposed || this.suspended) return;
    // A delayed timer must recheck: native playback may have healed while JS slept.
    if (!this.needsRecovery()) return;
    this.start(!this.loaded || !!this.audio.error || this.audio.ended || !this.audio.paused || this.resuming);
  };

  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    if (suspended) {
      ++this.generation;
      this.clearRetry();
      this.loaded = false;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    } else if (this.wanted) this.start(true);
  }

  pause = (): void => {
    this.wanted = false;
    ++this.generation;
    this.clearRetry();
    this.audio.pause();
    this.setState("paused");
  };

  private scheduleRetry(): void {
    if (!this.wanted || this.disposed || this.retry !== undefined) return;
    this.setState("reconnecting");
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.recover();
    }, Math.min(8000, 500 * 2 ** Math.min(this.attempts++, 4)));
  }

  check = (): void => {
    if (!this.wanted || this.disposed || this.suspended) return;
    if (this.needsRecovery()) {
      this.scheduleRetry();
    }
  };

  /** Give the native pipeline a chance to update its clock after page suspension. */
  foreground = (): void => {
    if (!this.wanted || this.disposed || this.suspended) return;
    this.progress.reset(this.audio.currentTime);
    this.clearRetry();
    this.recover();
  };

  /** The network coming back is a strong signal; don't sit out a queued backoff. */
  online = (): void => {
    if (!this.wanted || this.disposed || this.suspended) return;
    if (this.retry !== undefined) { this.clearRetry(); this.recover(); return; }
    this.check();
  };

  dispose(): void {
    this.disposed = true;
    this.wanted = false;
    ++this.generation;
    this.clearRetry();
    clearInterval(this.watchdog);
    for (const [event, fn] of Object.entries(this.handlers)) this.audio.removeEventListener(event, fn);
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  }
}
