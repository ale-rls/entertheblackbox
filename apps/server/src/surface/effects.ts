import { surfaceEffectColor, type SurfaceEffect } from "@entertheblackbox/shared";
import type { SurfaceController } from "./surface.js";

/** Effect frame interval. Each frame is one scheduled surface message per changed device. */
export const SURFACE_EFFECT_FRAME_MS = 50;
/** Resend every device's colour this often, so a tablet that reconnected mid-effect catches up. */
export const SURFACE_EFFECT_REFRESH_FRAMES = 20;

export type SurfaceEffectState = { effect: SurfaceEffect; order: string[]; startedAt: number } | null;

type Timers = {
  setInterval: (work: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

/**
 * Runs one programmed effect at a time on the server, so frames go out over
 * the LAN WebSockets on the shared clock instead of as HTTP requests from the
 * operator's browser. Devices play in `order` (Admin's label order).
 */
export class SurfaceEffectRunner {
  private current: SurfaceEffectState = null;
  private timer: unknown = null;
  private last = new Map<string, string>();
  private frames = 0;

  constructor(
    private readonly surface: Pick<SurfaceController, "paint" | "play">,
    private readonly options: { now?: () => number; frameMs?: number; timers?: Timers } = {},
  ) {}

  get state(): SurfaceEffectState { return this.current; }

  /**
   * Start an effect, or update the running one. Restarting the same kind keeps
   * its phase, so dimmer/speed/colour tweaks and device-list changes don't jump.
   */
  start(effect: SurfaceEffect, order: readonly string[]): number {
    const now = this.now();
    const sameKind = this.current?.effect.kind === effect.kind;
    let startedAt = sameKind ? this.current!.startedAt : now;
    if (sameKind && this.current!.effect.periodMs !== effect.periodMs) {
      // Keep the current position in the cycle when the speed changes.
      const progress = (now - startedAt) / this.current!.effect.periodMs;
      startedAt = now - progress * effect.periodMs;
    }
    const dropped = this.current ? this.current.order.filter((id) => !order.includes(id)) : [];
    this.current = { effect, order: [...order], startedAt };
    if (dropped.length) { this.surface.play(dropped, { mode: "release" }); for (const id of dropped) this.last.delete(id); }
    if (this.timer === null) {
      const timers = this.options.timers ?? { setInterval: (work, ms) => setInterval(work, ms), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) };
      this.timer = timers.setInterval(() => this.frame(), this.options.frameMs ?? SURFACE_EFFECT_FRAME_MS);
    }
    return this.frame();
  }

  /** Stop the effect and return its devices to the base colour. */
  stop(): number {
    const running = this.current;
    if (this.timer !== null) (this.options.timers?.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>)))(this.timer);
    this.timer = null;
    this.current = null;
    this.last.clear();
    return running && running.order.length ? this.surface.play(running.order, { mode: "release" }) : 0;
  }

  /** Render and send one frame; only changed colours go out, except on periodic refreshes. */
  frame(): number {
    const running = this.current;
    if (!running) return 0;
    const refresh = this.frames++ % SURFACE_EFFECT_REFRESH_FRAMES === 0;
    const elapsed = this.now() - running.startedAt;
    const changed = new Map<string, string>();
    running.order.forEach((id, index) => {
      const color = surfaceEffectColor(running.effect, index, running.order.length, elapsed);
      if (refresh || this.last.get(id) !== color) changed.set(id, color);
      this.last.set(id, color);
    });
    return this.surface.paint(changed);
  }

  private now() { return (this.options.now ?? Date.now)(); }
}
