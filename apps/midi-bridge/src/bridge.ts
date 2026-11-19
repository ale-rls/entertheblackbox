import { describeAction, midiBytes, type BridgeConfig, type MidiAction } from "./config.js";

export type MidiOutput = { name: string; send: (bytes: number[]) => void };
export type Log = (line: string) => void;

type Envelope = {
  type?: unknown; bootId?: unknown; sequence?: unknown; timelineId?: unknown; timelineKey?: unknown; phaseId?: unknown; phaseEpoch?: unknown;
  payload?: { cue?: unknown; reason?: unknown } | undefined;
  timelines?: unknown;
  timestamp?: unknown;
  /** The feed sends more (version, sessionId …); the bridge ignores it. */
  [key: string]: unknown;
};

function timelineKey(event: Envelope): string {
  if (typeof event.timelineKey === "string") return event.timelineKey;
  return typeof event.timelineId === "string" ? event.timelineId : "main";
}

/**
 * Turns cue feed events (GET /api/cues) into MIDI. Fires on live `phase` and
 * `cue` events only: the `snapshot` sent on every (re)connect describes the
 * current state, so reconnecting never replays an old one-shot cue.
 */
export class CueBridge {
  private bootId: string | null = null;
  private lastSequence = -1;
  private readonly firedEpochs = new Map<string, number>();
  /** The announced start (server clock) of each timeline's current scene. */
  private readonly sceneStarts = new Map<string, { epoch: number; startedAt: number }>();
  private arrivals: Array<{ at: number; offset: number }> = [];
  /** Bumped by a show end, so actions still waiting for a scene's start are dropped. */
  private resets = 0;

  constructor(
    private config: BridgeConfig,
    private readonly output: MidiOutput,
    private readonly log: Log,
    private readonly schedule: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); },
    private readonly now: () => number = Date.now,
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
    const late = this.lateness(event);
    const timeline = typeof event.timelineId === "string" ? event.timelineId : "main";
    switch (event.type) {
      case "snapshot": {
        const timelines = Array.isArray(event.timelines) ? event.timelines as Envelope[] : [];
        const scenes = timelines.map((timeline) => `${timelineKey(timeline)}: ${String(timeline.phaseId)}`);
        this.log(`connected · ${scenes.length ? `current scene ${scenes.join(", ")}` : "no show running"} · nothing replayed`);
        this.firedEpochs.clear();
        for (const timeline of timelines) {
          if (typeof timeline.timelineId === "string" && typeof timeline.phaseEpoch === "number") this.firedEpochs.set(timelineKey(timeline), timeline.phaseEpoch);
        }
        return;
      }
      case "phase": {
        if (typeof event.phaseId !== "string") return;
        const timeline = timelineKey(event);
        if (typeof event.phaseEpoch === "number") {
          if (this.firedEpochs.get(timeline) === event.phaseEpoch) return;
          this.firedEpochs.set(timeline, event.phaseEpoch);
        }
        const startedAt = event.payload?.phase?.startedAt;
        if (typeof event.phaseEpoch === "number" && typeof startedAt === "number") this.sceneStarts.set(timeline, { epoch: event.phaseEpoch, startedAt });
        else this.sceneStarts.delete(timeline);
        const actions = this.config.scenes[event.phaseId];
        const lead = this.leadMs(timeline, event, late);
        this.log(`scene ${event.phaseId}${timeline === "main" ? "" : ` (${timeline})`}${actions ? "" : " · no MIDI"}${actions && lead ? ` · starts in ${(lead / 1000).toFixed(1)} s` : ""}`);
        if (actions) this.at(timeline, event, lead, () => this.fire(actions, `scene ${event.phaseId}`));
        return;
      }
      case "cue": {
        const cue = event.payload?.cue;
        if (typeof cue !== "string") return;
        const actions = this.config.cues[cue];
        if (!actions) { this.log(`cue "${cue}" · not in the mapping file`); return; }
        this.at(timeline, event, this.leadMs(timeline, event, late), () => this.fire(actions, `cue "${cue}"`));
        return;
      }
      case "retire": {
        const timeline = timelineKey(event);
        if (this.firedEpochs.get(timeline) === event.phaseEpoch) this.firedEpochs.delete(timeline);
        return;
      }
      case "reset": {
        this.firedEpochs.clear();
        // Group paths reunite with a reset too; only the return to idle ends the show.
        if (event.phaseId !== "idle") return;
        this.resets += 1;
        this.sceneStarts.clear();
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

  /**
   * Run `fn` now, or once the scene's synchronized pre-roll is over: a video with phone audio is announced
   * a few seconds before it starts, and music must start with the picture, not with the announcement.
   * Dropped if another scene starts on that timeline (or the show ends) first.
   */
  private at(timeline: string, event: Envelope, delayMs: number, fn: () => void): void {
    if (delayMs <= 0) { fn(); return; }
    const epoch = event.phaseEpoch;
    const resets = this.resets;
    this.schedule(() => {
      if (this.resets !== resets || this.sceneStarts.get(timeline)?.epoch !== epoch) return;
      fn();
    }, delayMs);
  }

  /** How much later than usual this event arrived, in ms (0 for the fastest one seen recently); per connection. */
  private lateness(event: Envelope): number {
    if (typeof event.timestamp !== "number") return 0;
    const at = this.now();
    if (event.type === "snapshot") this.arrivals = [];
    this.arrivals = this.arrivals.filter((sample) => at - sample.at <= ARRIVAL_WINDOW_MS);
    const offset = at - event.timestamp;
    this.arrivals.push({ at, offset });
    return Math.max(0, offset - Math.min(...this.arrivals.map((sample) => sample.offset)));
  }

  /** How long until the current scene of `timeline` starts (0 if it already has), less any lateness. */
  private leadMs(timeline: string, event: Envelope, late: number): number {
    const start = this.sceneStarts.get(timeline);
    if (!start || start.epoch !== event.phaseEpoch || typeof event.timestamp !== "number") return 0;
    const announced = start.startedAt - event.timestamp;
    if (!(announced > 0 && announced <= MAX_LEAD_MS)) return 0;
    return Math.max(0, announced - late);
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
