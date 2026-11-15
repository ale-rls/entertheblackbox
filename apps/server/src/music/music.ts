import type { WebSocket } from "ws";
import { encodeMessage, musicGainAt, PROTOCOL_VERSION, type MusicMessage } from "@entertheblackbox/protocol";
import { MUSIC_DEFAULT_FADE_MS, type MusicCue, type Phase } from "@entertheblackbox/scenario";

/** Lead between a cue and the shared start, so the display can begin from the top. */
export const MUSIC_START_LEAD_MS = 300;

type Gain = MusicMessage["gain"];
export type MusicSource = "scene" | "admin";
export type MusicTrackOption = { src: string; bytes: number };

/** Same-origin URL for a media path, keeping its folders. */
export function musicMediaUrl(src: string): string {
  return `/media/${src.split("/").map(encodeURIComponent).join("/")}`;
}

/** MP3s in the shared media library that Admin can play as music. */
export function musicTracksFromMedia(records: readonly { src: string; bytes: number }[]): MusicTrackOption[] {
  return records
    .filter((record) => /\.mp3$/i.test(record.src) && !/[\\/]/.test(record.src) && record.bytes > 0)
    .map((record) => ({ src: record.src, bytes: record.bytes }))
    .sort((a, b) => a.src.localeCompare(b.src, undefined, { numeric: true, sensitivity: "base" }));
}

/**
 * Room music on the main display. Scene cues and Admin commands change one
 * shared state; the display derives position and loudness from it on the
 * server clock, so a reconnecting display rejoins at the right point.
 */
export class MusicController {
  private seq = 0;
  private src: string | null = null;
  private startAt: number | null = null;
  private loop = true;
  private gain: Gain = { from: 0, to: 0, at: 0, ms: 0 };
  private stopAt: number | null = null;
  private source: MusicSource | null = null;
  private phaseId: string | null = null;

  constructor(private readonly options: {
    /** The main display socket, if connected. */
    display: () => WebSocket | undefined;
    /** Make sure an Admin-chosen library file is present in the served media directory. */
    ensureLocal?: (src: string) => Promise<void>;
    /** Library tracks Admin may play. */
    tracks?: () => Promise<MusicTrackOption[]>;
    now?: () => number;
  }) {}

  /** Apply a shared-timeline scene's cue; the idle scene (show end/restart) stops the music. */
  applyScene(phase: Phase): void {
    if (phase.kind === "idle") {
      if (this.isPlaying()) this.stop(0, "scene");
      return;
    }
    const cue = "music" in phase ? phase.music : undefined;
    if (!cue) return;
    this.phaseId = phase.id;
    this.applyCue(cue, "scene");
  }

  applyCue(cue: MusicCue, source: MusicSource): void {
    if (cue.action === "play") this.play(cue.src, { volume: cue.volume ?? 1, loop: cue.loop ?? true, fadeMs: cue.fadeMs ?? 0, source });
    else if (cue.action === "volume") this.setVolume(cue.volume, cue.fadeMs ?? MUSIC_DEFAULT_FADE_MS, source);
    else this.stop(cue.fadeMs ?? MUSIC_DEFAULT_FADE_MS, source);
  }

  /** Admin: play a library track (made local first). */
  async playFromLibrary(src: string, options: { volume: number; loop: boolean; fadeMs: number }): Promise<{ ok: true } | { ok: false; error: string }> {
    const tracks = await this.options.tracks?.() ?? [];
    if (!tracks.some((track) => track.src === src)) return { ok: false, error: "unknown_track" };
    await this.options.ensureLocal?.(src);
    this.phaseId = null;
    this.play(src, { ...options, source: "admin" });
    return { ok: true };
  }

  play(src: string, options: { volume: number; loop: boolean; fadeMs: number; source: MusicSource }): void {
    const startAt = this.now() + MUSIC_START_LEAD_MS;
    this.src = src;
    this.startAt = startAt;
    this.loop = options.loop;
    this.stopAt = null;
    this.gain = options.fadeMs > 0
      ? { from: 0, to: options.volume, at: startAt, ms: options.fadeMs }
      : { from: options.volume, to: options.volume, at: startAt, ms: 0 };
    this.source = options.source;
    this.broadcast();
  }

  /** Ramp from the current loudness to `volume`. No-op without a track. */
  setVolume(volume: number, fadeMs: number, source: MusicSource): boolean {
    if (!this.isPlaying()) return false;
    const now = this.now();
    this.gain = { from: musicGainAt(this.gain, now), to: volume, at: now, ms: fadeMs };
    this.source = source;
    this.broadcast();
    return true;
  }

  /** Fade out and release the track; 0 cuts immediately. */
  stop(fadeMs: number, source: MusicSource): void {
    const now = this.now();
    if (fadeMs <= 0 || !this.isPlaying()) {
      this.src = null;
      this.startAt = null;
      this.stopAt = null;
      this.gain = { from: 0, to: 0, at: now, ms: 0 };
    } else {
      this.gain = { from: musicGainAt(this.gain, now), to: 0, at: now, ms: fadeMs };
      this.stopAt = now + fadeMs;
    }
    this.source = source;
    this.broadcast();
  }

  /** Current state for a display that just connected. */
  welcome(socket: WebSocket): void {
    send(socket, this.message());
  }

  snapshot() {
    const now = this.now();
    const playing = this.isPlaying();
    return {
      track: playing ? this.src : null,
      startAt: playing ? this.startAt : null,
      loop: this.loop,
      volume: playing ? musicGainAt(this.gain, now) : 0,
      targetVolume: playing ? this.gain.to : 0,
      fadingOut: playing && this.stopAt !== null,
      source: playing ? this.source : null,
      phaseId: playing ? this.phaseId : null,
      displayConnected: isOpen(this.options.display()),
      serverNow: now,
    };
  }

  private isPlaying(): boolean {
    return this.src !== null && (this.stopAt === null || this.now() < this.stopAt);
  }

  private message(): MusicMessage {
    const playing = this.isPlaying();
    return {
      t: "music", v: PROTOCOL_VERSION, seq: ++this.seq,
      track: playing && this.src !== null ? { src: this.src, url: musicMediaUrl(this.src) } : null,
      startAt: playing ? this.startAt : null,
      loop: this.loop,
      gain: this.gain,
      stopAt: playing ? this.stopAt : null,
    };
  }

  private broadcast(): void {
    const display = this.options.display();
    if (display) send(display, this.message());
  }

  private now() { return (this.options.now ?? Date.now)(); }
}

const isOpen = (socket: WebSocket | undefined) => socket !== undefined && (socket.readyState === undefined || socket.readyState === 1);
const send = (socket: WebSocket, message: MusicMessage) => { if (isOpen(socket)) socket.send(encodeMessage(message)); };
