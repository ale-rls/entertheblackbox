import { orderedSurfaceCues, surfaceCueEffect, type Phase, type SurfaceCue } from "@entertheblackbox/scenario";
import type { SurfaceEffectRunner } from "./effects.js";

type Timers = {
  setTimeout: (work: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

/** Natural tablet-label order (T2 before T10), the same order Admin's Instrument plays in. */
export function surfaceDeviceOrder(devices: Iterable<{ clientId: string; name?: string | undefined; client?: string | undefined }>): string[] {
  return [...devices]
    // Audience browsers have no light surface: a chase step on one would leave every tablet dark for it.
    .filter((device) => device.client !== "web")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true, sensitivity: "base" }) || a.clientId.localeCompare(b.clientId))
    .map((device) => device.clientId);
}

/**
 * Plays a scene's authored tablet-light cues through the Instrument's effect
 * runner. Cues are timed from the scene start; leaving the scene cancels the
 * pending ones but leaves a running effect on until a later cue, the operator
 * or the return to idle stops it.
 */
export class SurfaceCueScheduler {
  private pending: unknown[] = [];
  /** True while the running effect was started by a cue (operators' effects are left alone at idle). */
  private cueOwned = false;

  constructor(
    private readonly runner: Pick<SurfaceEffectRunner, "start" | "stop" | "state">,
    private readonly devices: () => string[],
    private readonly options: { now?: () => number; timers?: Timers } = {},
  ) {}

  enterPhase(phase: Phase, startedAt: number): void {
    this.cancel();
    if (phase.kind === "idle") {
      if (this.cueOwned && this.runner.state) this.runner.stop();
      this.cueOwned = false;
      return;
    }
    if (phase.kind !== "video" && phase.kind !== "narration") return;
    const cues = orderedSurfaceCues(phase.surfaceCues);
    if (cues.length === 0) return;
    const elapsed = this.now() - startedAt;
    // Catch up on the latest cue that is already due, then schedule the rest.
    const due = cues.filter((cue) => cue.atMs <= elapsed);
    const latest = due.at(-1);
    if (latest) this.fire(latest);
    for (const cue of cues) if (cue.atMs > elapsed) {
      this.pending.push(this.timers().setTimeout(() => this.fire(cue), cue.atMs - elapsed));
    }
  }

  /**
   * The operator started or stopped an effect in Admin: they own the tablets now. The
   * current scene's remaining cues are dropped and idle won't stop the operator's effect.
   */
  operatorOverride(): void {
    this.cancel();
    this.cueOwned = false;
  }

  /** Show torn down: drop pending cues (the effect runner is stopped separately). */
  dispose(): void { this.cancel(); }

  private fire(cue: SurfaceCue): void {
    if (cue.action === "stop") {
      this.runner.stop();
      this.cueOwned = false;
      return;
    }
    this.runner.start(surfaceCueEffect(cue.effect), this.devices());
    this.cueOwned = true;
  }

  private cancel(): void {
    for (const handle of this.pending) this.timers().clearTimeout(handle);
    this.pending = [];
  }

  private timers(): Timers {
    return this.options.timers ?? { setTimeout: (work, ms) => setTimeout(work, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  }

  private now() { return (this.options.now ?? Date.now)(); }
}
