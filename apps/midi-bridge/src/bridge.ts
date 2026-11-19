import { describeAction, midiBytes, type BridgeConfig, type MidiAction } from "./config.js";

export type MidiOutput = { name: string; send: (bytes: number[]) => void };
export type Log = (line: string) => void;

type Envelope = {
  type?: unknown; bootId?: unknown; sequence?: unknown; timelineId?: unknown; timelineKey?: unknown; phaseId?: unknown; phaseEpoch?: unknown;
  payload?: { cue?: unknown; reason?: unknown; phase?: { startedAt?: unknown } | undefined } | undefined;
  timelines?: unknown;
  timestamp?: unknown;
  /** The feed sends more (version, sessionId …); the bridge ignores it. */
  [key: string]: unknown;
};

/** A scene start announced further ahead than this is not a synchronized pre-roll: fire at once. */
const MAX_LEAD_MS = 60_000;
/** How long an arrival sample counts towards "how fast events usually arrive". */
const ARRIVAL_WINDOW_MS = 10 * 60_000;

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
      if (event.bootId !== this.bootId) { this.firedEpochs.clear(); this.sceneStarts.clear(); }
      this.bootId = event.bootId;
      this.lastSequence = Math.max(event.type === "snapshot" ? -1 : this.lastSequence, event.sequence);
    }
    const late = this.lateness(event);
    const timeline = timelineKey(event);
    switch (event.type) {
      case "snapshot": {
        const timelines = Array.isArray(event.timelines) ? event.timelines as Envelope[] : [];
        const scenes = timelines.map((timeline) => `${timelineKey(timeline)}: ${String(timeline.phaseId)}`);
        this.log(`connected · ${scenes.length ? `current scene ${scenes.join(", ")}` : "no show running"} · nothing replayed`);
        this.firedEpochs.clear();
        // As in the Eos bridge: a group scene older than the shared timeline belongs to a branch that has ended.
        const mainEpoch = timelines.find((entry) => timelineKey(entry) === "main")?.phaseEpoch;
        const current = new Map<string, number>();
        for (const timeline of timelines) {
          if (typeof timeline.timelineId !== "string" || typeof timeline.phaseEpoch !== "number") continue;
          this.firedEpochs.set(timelineKey(timeline), timeline.phaseEpoch);
          if (timelineKey(timeline) === "main" || typeof mainEpoch !== "number" || timeline.phaseEpoch > mainEpoch) current.set(timelineKey(timeline), timeline.phaseEpoch);
        }
        // Events (a retire, a reunion) may have been missed while disconnected: music still waiting for its
        // scene's pre-roll only survives if that scene is still the current one on its timeline.
        for (const [waiting, { epoch }] of [...this.sceneStarts]) if (current.get(waiting) !== epoch) this.sceneStarts.delete(waiting);
        return;
      }
      case "phase": {
        if (typeof event.phaseId !== "string") return;
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
        if (this.firedEpochs.get(timeline) === event.phaseEpoch) this.firedEpochs.delete(timeline);
        // A retired timeline's scene never starts: drop music still waiting for its pre-roll.
        if (this.sceneStarts.get(timeline)?.epoch === event.phaseEpoch) this.sceneStarts.delete(timeline);
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
