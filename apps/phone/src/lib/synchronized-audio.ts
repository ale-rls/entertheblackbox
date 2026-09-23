import type { ClockTiming } from "@entertheblackbox/protocol";
import type { ServerClock } from "@entertheblackbox/shared";

export type AudioCue = { key: string; src: string; startedAt: number; endsAt: number };
export type SyncStatus = "disabled" | "loading" | "ready" | "waiting" | "playing" | "error";

/** Compressed preloads are bounded; only the active soundtrack is decoded. */
export class SynchronizedAudio {
  private context: AudioContext | null = null;
  private files = new Map<string, ArrayBuffer>();
  private requests = new Map<string, Promise<ArrayBuffer>>();
  private bytes = 0;
  private cue: AudioCue | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private generation = 0;
  private disposed = false;
  private finished = false;
  private anchorTime = 0;
  private anchorPosition = 0;
  private rate = 1;
  private status: SyncStatus = "disabled";
  private timer: ReturnType<typeof setInterval>;

  constructor(private clock: ServerClock, private changed: (status: SyncStatus) => void,
    private createContext = () => new AudioContext()) {
    this.timer = setInterval(() => this.tick(), 100);
  }
  private report(status: SyncStatus): void {
    if (this.disposed || status === this.status) return;
    this.status = status;
    this.changed(status);
  }
  async preload(src: string): Promise<ArrayBuffer> {
    const existing = this.files.get(src);
    if (existing) return existing;
    const pending = this.requests.get(src);
    if (pending) return pending;
    const request = (async () => {
      const response = await fetch(`/media/${src.split("/").map(encodeURIComponent).join("/")}`, { cache: "no-cache" });
      if (!response.ok) throw new Error(`Audio download failed (${response.status})`);
      const bytes = await response.arrayBuffer();
      if (this.disposed) return bytes;
      while (this.bytes + bytes.byteLength > 64 * 1024 * 1024 && this.files.size) {
        const first = this.files.keys().next().value!;
        this.bytes -= this.files.get(first)!.byteLength;
        this.files.delete(first);
      }
      if (bytes.byteLength <= 64 * 1024 * 1024) { this.files.set(src, bytes); this.bytes += bytes.byteLength; }
      return bytes;
    })();
    this.requests.set(src, request);
    try { return await request; } finally { this.requests.delete(src); }
  }
  /** Must be called directly from a user gesture to unlock iOS audio. */
  async enable(): Promise<void> {
    if (this.disposed) return;
    try {
      this.context ??= this.createContext();
      await this.context.resume();
      if (this.disposed) return;
      if (this.cue) await this.prepare();
      else this.report("ready");
    } catch { this.report("error"); }
  }
  setCue(cue: AudioCue | null): void {
    if (cue?.key === this.cue?.key && cue?.src === this.cue?.src && cue?.startedAt === this.cue?.startedAt) return;
    ++this.generation;
    this.stopSource();
    this.cue = cue;
    this.buffer = null;
    this.finished = false;
    if (cue) void this.prepare();
    else this.report(this.context?.state === "running" ? "ready" : "disabled");
  }
  private async prepare(): Promise<void> {
    const cue = this.cue;
    if (!cue) return;
    const generation = ++this.generation;
    this.report("loading");
    try {
      const bytes = await this.preload(cue.src);
      if (generation !== this.generation || this.disposed) return;
      if (!this.context || this.context.state !== "running") { this.report("disabled"); return; }
      const buffer = await this.context.decodeAudioData(bytes.slice(0));
      if (generation !== this.generation || this.disposed) return;
      this.buffer = buffer;
      this.tick();
    } catch { if (generation === this.generation) this.report("error"); }
  }
  private stopSource(): void {
    if (this.source) { this.source.onended = null; this.source.stop(); this.source.disconnect(); this.source = null; }
  }
  private tick(): void {
    const ctx = this.context, cue = this.cue, buffer = this.buffer;
    if (!cue || !ctx || !buffer || this.disposed) return;
    if (ctx.state !== "running") { this.report("disabled"); return; }
    if (!this.clock.hasSamples) { this.report("waiting"); return; }
    const now = this.clock.now();
    if (now >= cue.endsAt) { this.stopSource(); this.finished = true; this.report("ready"); return; }
    if (this.finished) return;
    const latency = Math.max(0, ctx.baseLatency || 0) + Math.max(0, ctx.outputLatency || 0);
    const target = (now - cue.startedAt) / 1000 + latency;
    if (!this.source) {
      if (target < -0.75) { this.report("waiting"); return; }
      if (target >= buffer.duration) { this.finished = true; this.report("ready"); return; }
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      this.anchorTime = ctx.currentTime + Math.max(0, -target);
      this.anchorPosition = Math.max(0, target);
      this.rate = 1;
      this.source = node;
      node.onended = () => { if (this.source === node) { node.disconnect(); this.source = null; this.finished = true; this.report("ready"); } };
      node.start(this.anchorTime, this.anchorPosition);
    } else if (ctx.currentTime >= this.anchorTime) {
      const position = this.anchorPosition + (ctx.currentTime - this.anchorTime) * this.rate;
      const error = target - position;
      // A resume/clock correction must rejoin the scene, never replay its opening.
      if (Math.abs(error) > 0.3) { this.stopSource(); this.tick(); return; }
      this.anchorPosition = position;
      this.anchorTime = ctx.currentTime;
      this.rate = Math.abs(error) < 0.015 ? 1 : Math.max(0.98, Math.min(1.02, 1 + error * 0.1));
      this.source.playbackRate.value = this.rate;
    }
    this.report(now < cue.startedAt ? "waiting" : "playing");
  }
  /** Web Audio position estimate including the same latency compensation as playback. */
  getTiming(): { cueKey: string | null; media: ClockTiming["media"] } {
    const ctx = this.context, cue = this.cue;
    if (!cue) return { cueKey: null, media: [] };
    const active = ctx?.state === "running" && this.source !== null && ctx.currentTime >= this.anchorTime;
    const positionMs = active ? Math.max(0, (this.anchorPosition + (ctx.currentTime - this.anchorTime) * this.rate) * 1000) : null;
    const latency = ctx ? Math.max(0, ctx.baseLatency || 0) + Math.max(0, ctx.outputLatency || 0) : 0;
    const targetMs = this.clock.hasSamples ? Math.max(0, this.clock.now() - cue.startedAt + latency * 1000) : null;
    const state = ctx && ctx.state !== "running" ? "disabled" : this.finished ? "ended" : this.status;
    return { cueKey: cue.key, media: [{ role: "main", positionMs, targetMs,
      driftMs: positionMs === null || targetMs === null ? null : positionMs - targetMs, state }] };
  }

  dispose(): void {
    this.disposed = true;
    ++this.generation;
    clearInterval(this.timer);
    this.stopSource();
    void this.context?.close();
    this.files.clear();
  }
}
