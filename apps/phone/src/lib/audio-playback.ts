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
  private disposed = false;
  private generation = 0;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval>;
  private progress = new AudioProgress();
  private readonly handlers: Record<string, () => void>;

  constructor(private audio: HTMLAudioElement, private url: string,
    private changed: (state: PlaybackState) => void) {
    this.handlers = {
      playing: () => {
        if (!this.wanted) return;
        this.progress.reset(audio.currentTime);
        this.attempts = 0;
        this.clearRetry();
        this.setState("playing");
      },
      timeupdate: () => {
        if (!this.wanted || audio.paused || audio.seeking) return;
        // Check actual progress; repeated timeupdate events can occur at a stall.
        if (!this.progress.stalled(audio.currentTime) && audio.readyState >= 3) {
          this.clearRetry();
          this.setState("playing");
        }
      },
      waiting: () => { if (this.wanted) this.setState("reconnecting"); },
      stalled: () => { if (this.wanted && audio.readyState < 3) this.setState("reconnecting"); },
      pause: () => { if (this.wanted && this.state !== "connecting") this.scheduleRetry(); },
      error: () => this.scheduleRetry(),
      ended: () => this.scheduleRetry(),
    };
    for (const [event, fn] of Object.entries(this.handlers)) audio.addEventListener(event, fn);
    this.progress.reset(audio.currentTime);
    // Hidden tabs may suspend timers, but when they do run recovery must not
    // deliberately skip them. Native media events also initiate recovery.
    this.watchdog = setInterval(this.check, 2000);
  }

  private setState(state: PlaybackState): void {
    if (this.disposed) return;
    this.state = state;
    this.changed(state);
  }
  private clearRetry(): void { clearTimeout(this.retry); this.retry = undefined; }

  play = (): void => {
    if (this.disposed || (this.state === "playing" && !this.audio.paused && !this.audio.error)) return;
    this.clearRetry();
    this.wanted = true;
    this.setState("connecting");
    const generation = ++this.generation;
    this.audio.src = `${this.url}${this.url.includes("?") ? "&" : "?"}t=${Date.now()}`;
    this.audio.load();
    this.progress.reset(this.audio.currentTime);
    void this.audio.play().catch((error: unknown) => {
      if (generation !== this.generation || !this.wanted || this.disposed) return;
      const name = (error as { name?: string } | null)?.name;
      if (name === "AbortError") return;
      if (name === "NotAllowedError") {
        this.wanted = false;
        this.clearRetry();
        this.setState("blocked");
      } else this.scheduleRetry();
    });
  };

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
      this.play();
    }, Math.min(8000, 500 * 2 ** Math.min(this.attempts++, 4)));
  }

  check = (): void => {
    if (!this.wanted || this.disposed) return;
    if (this.audio.error || this.audio.ended || this.audio.paused || this.progress.stalled(this.audio.currentTime)) {
      this.scheduleRetry();
    }
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
