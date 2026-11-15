import { describeAction, midiBytes, type BridgeConfig, type MidiAction } from "./config.js";

export type MidiOutput = { name: string; send: (bytes: number[]) => void };
export type Log = (line: string) => void;

type Envelope = {
  type?: unknown; bootId?: unknown; sequence?: unknown; timelineId?: unknown; phaseId?: unknown; phaseEpoch?: unknown;
  payload?: { cue?: unknown; reason?: unknown } | undefined;
  timelines?: unknown;
  /** The feed sends more (version, sessionId, timestamp …); the bridge ignores it. */
  [key: string]: unknown;
};

/**
 * Turns cue feed events (GET /api/cues) into MIDI. Fires on live `phase` and
 * `cue` events only: the `snapshot` sent on every (re)connect describes the
 * current state, so reconnecting never replays an old one-shot cue.
 */
export class CueBridge {
  private bootId: string | null = null;
  private lastSequence = -1;
  private readonly firedEpochs = new Map<string, number>();

  constructor(
    private config: BridgeConfig,
    private readonly output: MidiOutput,
    private readonly log: Log,
    private readonly schedule: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); },
  ) {}

  /** Swap in an edited mapping file without reconnecting. */
  setConfig(config: BridgeConfig): void {
    this.config = config;
  }

  handle(event: Envelope): void {
    if (typeof event.bootId === "string" && typeof event.sequence === "number") {
      if (event.bootId === this.bootId && event.sequence <= this.lastSequence && event.type !== "snapshot") return;
      if (event.bootId !== this.bootId) this.firedEpochs.clear();
      this.bootId = event.bootId;
      this.lastSequence = Math.max(event.type === "snapshot" ? -1 : this.lastSequence, event.sequence);
    }
    switch (event.type) {
      case "snapshot": {
        const timelines = Array.isArray(event.timelines) ? event.timelines as Envelope[] : [];
        const scenes = timelines.map((timeline) => `${String(timeline.timelineId)}: ${String(timeline.phaseId)}`);
        this.log(`connected · ${scenes.length ? `current scene ${scenes.join(", ")}` : "no show running"} · nothing replayed`);
        for (const timeline of timelines) {
          if (typeof timeline.timelineId === "string" && typeof timeline.phaseEpoch === "number") this.firedEpochs.set(timeline.timelineId, timeline.phaseEpoch);
        }
        return;
      }
      case "phase": {
        if (typeof event.phaseId !== "string") return;
        const timeline = typeof event.timelineId === "string" ? event.timelineId : "main";
        if (typeof event.phaseEpoch === "number") {
          if (this.firedEpochs.get(timeline) === event.phaseEpoch) return;
          this.firedEpochs.set(timeline, event.phaseEpoch);
        }
        const actions = this.config.scenes[event.phaseId];
        this.log(`scene ${event.phaseId}${timeline === "main" ? "" : ` (${timeline})`}${actions ? "" : " · no MIDI"}`);
        if (actions) this.fire(actions, `scene ${event.phaseId}`);
        return;
      }
      case "cue": {
        const cue = event.payload?.cue;
        if (typeof cue !== "string") return;
        const actions = this.config.cues[cue];
        if (!actions) { this.log(`cue "${cue}" · not in the mapping file`); return; }
        this.fire(actions, `cue "${cue}"`);
        return;
      }
      case "reset": {
        // Group paths reunite with a reset too; only the return to idle ends the show.
        if (event.phaseId !== "idle") return;
        this.log("show ended");
        if (this.config.showEnd) this.fire(this.config.showEnd, "show end");
        return;
      }
      default:
        return;
    }
  }

  /** Send a mapping entry by name (cue first, then scene), for testing in Ableton. */
  test(name: string): boolean {
    const actions = this.config.cues[name] ?? this.config.scenes[name] ?? (name === "showEnd" ? this.config.showEnd : undefined);
    if (!actions) return false;
    this.fire(actions, `test "${name}"`);
    return true;
  }

  private fire(actions: readonly MidiAction[], label: string): void {
    for (const action of actions) {
      const bytes = midiBytes(action, this.config.channel);
      this.output.send(bytes.now);
      if (bytes.off) {
        const off = bytes.off;
        this.schedule(() => this.output.send(off.bytes), off.afterMs);
      }
    }
    this.log(`${label} → ${actions.map((action) => describeAction(action, this.config.channel)).join(", ")}`);
  }
}
