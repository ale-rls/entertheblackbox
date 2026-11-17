import type { ChannelValues, Param } from "./config.js";
import type { LightOutput } from "./eos.js";

export type Clock = {
  now: () => number;
  /** Repeating timer; returns a cancel function. */
  every: (ms: number, fn: () => void) => () => void;
};

export const realClock: Clock = {
  // Monotonic: unlike Date.now(), it never jumps when the system clock is set or synced mid-fade.
  now: () => performance.now(),
  every: (ms, fn) => { const timer = setInterval(fn, ms); return () => clearInterval(timer); },
};

/** Frame interval while fading (~30 per second: smooth on the desk, light on the network). */
export const FRAME_MS = 33;

type Fade = { from: Map<number, ChannelValues>; to: Map<number, ChannelValues>; startedAt: number; durationMs: number };

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Plays looks on the desk. It remembers what it last sent per channel and fades
 * from there; a value it has never sent (e.g. right after the bridge starts)
 * snaps instead, because the bridge cannot know what the desk shows. A new look
 * interrupts a running fade from wherever that fade had got to.
 *
 * Separately it remembers what the looks *want* (each look's end values), so
 * `resync()` can put the desk right after values were lost on the way.
 */
export class LookPlayer {
  private readonly sent = new Map<number, ChannelValues>();
  private readonly wanted = new Map<number, ChannelValues>();
  private fade: Fade | null = null;
  private stopTimer: (() => void) | null = null;

  constructor(private readonly output: LightOutput, private readonly clock: Clock = realClock) {}

  /** What the looks want this channel to end at (a copy), or undefined if no look has set it yet. */
  state(channel: number): ChannelValues | undefined {
    const values = this.wanted.get(channel);
    return values && { ...values };
  }

  play(targets: Map<number, ChannelValues>, fadeSeconds: number): void {
    this.stop();
    for (const [channel, values] of targets) this.wanted.set(channel, { ...this.wanted.get(channel), ...values });
    const from = new Map<number, ChannelValues>();
    const snap = new Map<number, ChannelValues>();
    for (const [channel, values] of targets) {
      const known = this.sent.get(channel) ?? {};
      for (const [param, value] of Object.entries(values) as Array<[Param, number]>) {
        const start = known[param];
        if (fadeSeconds > 0 && start !== undefined) (from.get(channel) ?? from.set(channel, {}).get(channel)!)[param] = start;
        else (snap.get(channel) ?? snap.set(channel, {}).get(channel)!)[param] = value;
      }
    }
    for (const [channel, values] of snap) this.write(channel, values, true);
    if (!from.size) return;
    const to = new Map([...from].map(([channel, values]) => [channel, Object.fromEntries(Object.keys(values).map((param) => [param, targets.get(channel)![param as Param]!]))]));
    this.fade = { from, to, startedAt: this.clock.now(), durationMs: fadeSeconds * 1000 };
    this.stopTimer = this.clock.every(FRAME_MS, () => this.frame());
    this.frame();
  }

  /** Stop a running fade where it is. */
  stop(): void {
    this.stopTimer?.();
    this.stopTimer = null;
    this.fade = null;
  }

  get fading(): boolean {
    return this.fade !== null;
  }

  /**
   * Send, in one step, every value the looks want that the desk may not have: after the desk
   * connection comes back (a fade cut off by the drop jumps to its end), or after the desk caught up
   * with a backlog. Values a running fade is still moving are left to the fade. Returns how many
   * channels were sent.
   */
  resync(): number {
    let channels = 0;
    for (const [channel, want] of this.wanted) {
      const known = this.sent.get(channel) ?? {};
      const fading = this.fade?.to.get(channel) ?? {};
      const missing: ChannelValues = {};
      for (const [param, value] of Object.entries(want) as Array<[Param, number]>) {
        if (known[param] !== value && fading[param] === undefined) missing[param] = value;
      }
      if (Object.keys(missing).length) { this.write(channel, missing, true); channels += 1; }
    }
    return channels;
  }

  /**
   * Forget what was sent, so the next look snaps (what the looks want is kept for `resync`). Called when the desk connection drops (messages
   * written just before the drop may never have arrived) and when the bridge switches desks.
   */
  forget(): void {
    this.stop();
    this.sent.clear();
  }

  private frame(): void {
    const fade = this.fade;
    if (!fade) return;
    // Clamped both ways, so a frame can never land outside the fade's start and end values.
    const t = Math.min(1, Math.max(0, (this.clock.now() - fade.startedAt) / fade.durationMs));
    for (const [channel, to] of fade.to) {
      const from = fade.from.get(channel)!;
      const values: ChannelValues = {};
      for (const [param, end] of Object.entries(to) as Array<[Param, number]>) values[param] = round(from[param]! + (end - from[param]!) * t);
      this.write(channel, values, t >= 1);
    }
    if (t >= 1) this.stop();
  }

  /**
   * Fade frames send only what changed; the final frame sends every target value once more.
   * Only delivered values are remembered: if the desk is unreachable, the channel goes back to
   * unknown, so the next look snaps instead of fading from a value the desk never showed.
   */
  private write(channel: number, values: ChannelValues, final: boolean): void {
    const known = this.sent.get(channel) ?? {};
    const changed: ChannelValues = {};
    for (const [param, value] of Object.entries(values) as Array<[Param, number]>) {
      if (known[param] !== value) changed[param] = value;
    }
    if (!final && !Object.keys(changed).length) return;
    const delivered = this.output.set(channel, final ? { ...values } : changed, final);
    if (delivered) this.sent.set(channel, { ...known, ...changed });
    else this.sent.delete(channel);
  }
}
