import { lookTargets, own, sceneSteps, type BridgeConfig } from "./config.js";
import type { Log } from "./eos.js";
import type { LookPlayer } from "./player.js";
import { swatches } from "./swatch.js";

type Envelope = {
  type?: unknown; bootId?: unknown; sequence?: unknown; timelineId?: unknown; phaseId?: unknown; phaseEpoch?: unknown;
  timestamp?: unknown;
  payload?: { cue?: unknown; winner?: unknown; leader?: unknown; phase?: { startedAt?: unknown } | undefined } | undefined;
  timelines?: unknown;
  /** The feed sends more (version, sessionId …); the bridge ignores it. */
  [key: string]: unknown;
};

/** Vote outcomes where no field won. They use the scene's `none` look unless it names them itself. */
const NO_FIELD_WINNER = new Set(["tie", "empty", "fixed"]);
/** Longest wait for a scheduled scene start; anything longer is treated as a clock problem and fired now. */
const MAX_LEAD_MS = 60_000;
/** How far back arrival times count when judging how fast events normally arrive. */
const ARRIVAL_WINDOW_MS = 10 * 60_000;

export type Schedule = (fn: () => void, ms: number) => () => void;
const realSchedule: Schedule = (fn, ms) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); };
/** Monotonic laptop time in ms. */
export type Now = () => number;

/**
 * Turns cue feed events (GET /api/cues) into looks. Fires on live `phase`,
 * `cue` and `result` events only: the `snapshot` sent on every (re)connect
 * describes the current state, so reconnecting never replays a look.
 *
 * Scenes can start in the future: a synchronized-audio video scene is
 * announced with `startedAt` a few seconds ahead (the phones' preparation
 * time). The scene's look and its cues then wait for that moment, measured on
 * the server's clock (`startedAt` − the event's `timestamp`), so the laptop's
 * clock does not matter. An event that arrives later than events usually do
 * waits that much less. A newer scene on the same timeline cancels them.
 *
 * A scene can also hold timed steps (looks at set times within it, as monitor
 * cues are). They count from the scene's start on the server's clock. On a
 * reconnect the steps still ahead of the current scene are scheduled again;
 * the ones already past are not replayed.
 */
export class LightingBridge {
  private bootId: string | null = null;
  private lastSequence = -1;
  private readonly sceneEpochs = new Map<string, number>();
  private readonly resultEpochs = new Map<string, number>();
  /** Per timeline: the current scene's epoch and scheduled start (server clock). */
  private readonly sceneStarts = new Map<string, { epoch: number; startedAt: number }>();
  /** Per timeline: looks waiting for their scene's scheduled start, and which scene (epoch) they belong to. */
  private readonly pending = new Map<string, { epoch: number | undefined; cancels: Array<() => void> }>();
  /**
   * Recent (laptop arrival − server timestamp) samples on this connection. Their minimum is the clocks'
   * difference plus the fastest delivery; how far an event is above it is how late that event arrived.
   */
  private arrivals: Array<{ at: number; offset: number }> = [];

  constructor(
    private config: BridgeConfig,
    private readonly player: LookPlayer,
    private readonly log: Log,
    private readonly schedule: Schedule = realSchedule,
    private readonly now: Now = () => performance.now(),
    /** Add a colour swatch per lamp to each look's log line (for a terminal that shows colour). */
    private readonly showSwatches = false,
  ) {}

  /** Swap in an edited lighting file without reconnecting. */
  setConfig(config: BridgeConfig): void {
    this.config = config;
  }

  handle(event: Envelope): void {
    if (typeof event.bootId === "string" && typeof event.sequence === "number") {
      if (event.bootId === this.bootId && event.sequence <= this.lastSequence && event.type !== "snapshot") return;
      if (event.bootId !== this.bootId) { this.sceneEpochs.clear(); this.resultEpochs.clear(); this.sceneStarts.clear(); this.cancelAll(); }
      this.bootId = event.bootId;
      this.lastSequence = Math.max(event.type === "snapshot" ? -1 : this.lastSequence, event.sequence);
    }
    const timeline = typeof event.timelineId === "string" ? event.timelineId : "main";
    const late = this.lateness(event);
    switch (event.type) {
      case "snapshot": {
        const timelines = Array.isArray(event.timelines) ? event.timelines as Envelope[] : [];
        const scenes = timelines.map((entry) => `${String(entry.timelineId)}: ${String(entry.phaseId)}`);
        this.log(`connected · ${scenes.length ? `current scene ${scenes.join(", ")}` : "no show running"} · nothing replayed`);
        // Events may have been missed while disconnected: a look still waiting for its scene's start only
        // survives if that scene is still the current one on its timeline.
        // The feed keeps a group's last scene after a forced reunion (no reset is sent). Epochs come from one
        // counter, so a group scene older than main's current scene belongs to a branch that is over.
        const mainEpoch = timelines.find((entry) => entry.timelineId === "main")?.phaseEpoch;
        const live = timelines.filter((entry) => typeof entry.timelineId === "string" && typeof entry.phaseEpoch === "number"
          && (entry.timelineId === "main" || typeof mainEpoch !== "number" || (entry.phaseEpoch as number) > mainEpoch));
        const current = new Map(live.map((entry) => [entry.timelineId as string, entry.phaseEpoch]));
        for (const [waiting, { epoch }] of [...this.pending]) {
          if (epoch === undefined || current.get(waiting) !== epoch) this.cancel(waiting);
        }
        for (const timelineId of [...this.sceneEpochs.keys()]) {
          if (!current.has(timelineId)) { this.sceneEpochs.delete(timelineId); this.sceneStarts.delete(timelineId); }
        }
        for (const entry of live) {
          if (typeof entry.timelineId !== "string" || typeof entry.phaseEpoch !== "number") continue;
          this.sceneEpochs.set(entry.timelineId, entry.phaseEpoch);
          if ((entry.payload as { result?: unknown } | undefined)?.result !== undefined) this.resultEpochs.set(entry.timelineId, entry.phaseEpoch);
          // Timed steps still ahead in a scene that is running: lost with the connection unless scheduled again.
          const startedAt = entry.payload?.phase?.startedAt;
          if (this.pending.has(entry.timelineId) || typeof entry.phaseId !== "string" || typeof startedAt !== "number"
            || typeof event.timestamp !== "number") continue;
          this.sceneStarts.set(entry.timelineId, { epoch: entry.phaseEpoch, startedAt });
          const into = event.timestamp - startedAt + late;
          for (const step of sceneSteps(this.config, entry.phaseId)) {
            if (step.atMs > into) this.at(entry.timelineId, entry, step.atMs - into, this.prepare(step.look, `scene ${entry.phaseId} at ${step.atMs / 1000} s`));
          }
        }
        return;
      }
      case "phase": {
        if (typeof event.phaseId !== "string") return;
        if (typeof event.phaseEpoch === "number") {
          if (this.sceneEpochs.get(timeline) === event.phaseEpoch) return;
          this.sceneEpochs.set(timeline, event.phaseEpoch);
        }
        // A new scene on this timeline replaces anything still waiting for the previous one's start.
        this.cancel(timeline);
        // Group timelines only exist inside a group-branch scene on main, so a new main scene ends them all.
        // A forced reunion sends no reset (only groups finishing on their own do), so this is the only sign.
        if (timeline === "main") this.endGroupTimelines();
        const startedAt = event.payload?.phase?.startedAt;
        if (typeof event.phaseEpoch === "number" && typeof startedAt === "number") this.sceneStarts.set(timeline, { epoch: event.phaseEpoch, startedAt });
        else this.sceneStarts.delete(timeline);
        const lead = this.leadMs(timeline, event, late);
        const steps = sceneSteps(this.config, event.phaseId);
        this.log(`scene ${event.phaseId}${timeline === "main" ? "" : ` (${timeline})`}${lead ? ` · starts in ${(lead / 1000).toFixed(1)} s` : ""}${steps.length ? (steps.length > 1 ? ` · ${steps.length} light steps` : "") : " · no look"}`);
        // How far into the scene it already is when the event is handled (0 while it is still to start).
        const into = lead > 0 ? 0 : this.intoSceneMs(timeline, event) + late;
        const due = steps.filter((step) => lead + step.atMs - into <= 0);
        const latestDue = due[due.length - 1];
        if (latestDue) this.play(latestDue.look, `scene ${event.phaseId}${latestDue.atMs ? ` at ${latestDue.atMs / 1000} s` : ""}`);
        for (const step of steps.slice(due.length)) {
          this.at(timeline, event, lead + step.atMs - into, this.prepare(step.look, `scene ${event.phaseId}${step.atMs ? ` at ${step.atMs / 1000} s` : ""}`));
        }
        return;
      }
      case "cue": {
        const cue = event.payload?.cue;
        if (typeof cue !== "string") return;
        const look = own(this.config.cues, cue);
        if (!look) { this.log(`cue "${cue}" · not in the lighting file`); return; }
        this.at(timeline, event, this.leadMs(timeline, event, late), this.prepare(look, `cue "${cue}"`));
        return;
      }
      case "result": {
        if (typeof event.phaseId !== "string") return;
        if (typeof event.phaseEpoch === "number") {
          if (this.resultEpochs.get(timeline) === event.phaseEpoch) return;
          this.resultEpochs.set(timeline, event.phaseEpoch);
        }
        const looks = own(this.config.results, event.phaseId);
        if (!looks) return;
        const winner = typeof event.payload?.winner === "string" ? event.payload.winner : null;
        // A question with a fixed next scene still has a field the audience chose: light that one.
        const leader = winner === "fixed" && typeof event.payload?.leader === "string" ? event.payload.leader : null;
        const leaderLook = leader !== null ? own(looks, leader) : undefined;
        const shown = leaderLook ? leader : winner;
        // A field's own look; for tie/empty/fixed (or no winner) a look named after it, else `none`.
        const look = leaderLook
          ?? (winner !== null ? own(looks, winner) : undefined)
          ?? (winner === null || NO_FIELD_WINNER.has(winner) ? own(looks, "none") : undefined);
        this.log(`vote ${event.phaseId} → ${leaderLook ? `${leader} (fixed next scene)` : winner ?? "no winner"}${look ? "" : " · no look"}`);
        if (look) this.play(look, `vote ${event.phaseId} → ${shown ?? "none"}`);
        return;
      }
      case "reset": {
        // Every reset ends every timeline: the return to idle, and a group-branch reunion (sent on "main",
        // named after the reunion scene), including one the operator forces while a path is pre-rolling.
        // Nothing still waiting for a scene's start may fire after it.
        this.cancelAll();
        this.sceneStarts.clear();
        if (event.phaseId !== "idle") return;
        this.log("show ended");
        if (this.config.showEnd) this.play(this.config.showEnd, "show end");
        return;
      }
      default:
        return;
    }
  }

  /** Play a look by name, or the look a cue or scene points at (for testing in the room). */
  test(name: string): boolean {
    const look = own(this.config.looks, name) ? name
      : own(this.config.cues, name) ?? sceneSteps(this.config, name)[0]?.look ?? (name === "showEnd" ? this.config.showEnd : undefined);
    if (!look) return false;
    this.play(look, `test "${name}"`);
    return true;
  }

  /**
   * How much later than usual this event arrived, in ms (0 for the fastest one seen recently). Sampled
   * per connection: a reconnect may take another route, so the snapshot starts the samples over.
   */
  private lateness(event: Envelope): number {
    if (typeof event.timestamp !== "number") return 0;
    const at = this.now();
    if (event.type === "snapshot") this.arrivals = [];
    this.arrivals = this.arrivals.filter((sample) => at - sample.at <= ARRIVAL_WINDOW_MS);
    const offset = at - event.timestamp;
    this.arrivals.push({ at, offset });
    return Math.max(0, offset - Math.min(...this.arrivals.map((sample) => sample.offset)));
  }

  /**
   * How long until the current scene of `timeline` starts (0 if it already has): the wait announced on the
   * server's clock, less however much later than usual the event arrived.
   */
  private leadMs(timeline: string, event: Envelope, late: number): number {
    const start = this.sceneStarts.get(timeline);
    if (!start || start.epoch !== event.phaseEpoch || typeof event.timestamp !== "number") return 0;
    const announced = start.startedAt - event.timestamp;
    if (!(announced > 0 && announced <= MAX_LEAD_MS)) return 0;
    return Math.max(0, announced - late);
  }

  /** How long the current scene of `timeline` had been running when the server sent `event` (0 if unknown). */
  private intoSceneMs(timeline: string, event: Envelope): number {
    const start = this.sceneStarts.get(timeline);
    if (!start || start.epoch !== event.phaseEpoch || typeof event.timestamp !== "number") return 0;
    return Math.max(0, event.timestamp - start.startedAt);
  }

  /** Run `fn` now, or after `delayMs` if its scene is still the current one on `timeline` by then. */
  private at(timeline: string, event: Envelope, delayMs: number, fn: () => void): void {
    if (delayMs <= 0) { fn(); return; }
    const epoch = typeof event.phaseEpoch === "number" ? event.phaseEpoch : undefined;
    const entry = this.pending.get(timeline);
    const list = entry && entry.epoch === epoch ? entry : { epoch, cancels: [] };
    if (list !== entry) { this.cancel(timeline); this.pending.set(timeline, list); }
    const cancel = this.schedule(() => {
      list.cancels = list.cancels.filter((item) => item !== cancel);
      if (!list.cancels.length && this.pending.get(timeline) === list) this.pending.delete(timeline);
      // Second safeguard: a newer scene on this timeline (or a reconnect that saw one) makes this obsolete.
      if (epoch !== undefined && this.sceneEpochs.get(timeline) !== epoch) return;
      fn();
    }, delayMs);
    list.cancels.push(cancel);
  }

  private cancel(timeline: string): void {
    for (const cancel of this.pending.get(timeline)?.cancels ?? []) cancel();
    this.pending.delete(timeline);
  }

  /** Drop everything waiting on, and everything known about, every group timeline (all but main). */
  private endGroupTimelines(): void {
    for (const timeline of [...this.pending.keys()]) if (timeline !== "main") this.cancel(timeline);
    for (const timeline of [...this.sceneEpochs.keys()]) if (timeline !== "main") this.sceneEpochs.delete(timeline);
    for (const timeline of [...this.sceneStarts.keys()]) if (timeline !== "main") this.sceneStarts.delete(timeline);
  }

  private cancelAll(): void {
    for (const timeline of [...this.pending.keys()]) this.cancel(timeline);
  }

  private play(lookName: string, label: string): void {
    this.prepare(lookName, label)();
  }

  /**
   * Resolve a look now (its fixtures, colours and fade) and return what plays it. A look waiting for its
   * scene's start is resolved when the event arrives, so saving the lighting file meanwhile cannot leave
   * it pointing at a look that was renamed or removed.
   */
  private prepare(lookName: string, label: string): () => void {
    const look = own(this.config.looks, lookName);
    if (!look) return () => this.log(`${label} → look "${lookName}" is missing`);
    const targets = lookTargets(this.config, look);
    return () => {
      this.player.play(targets, look.fade);
      const line = `${label} → look "${lookName}"${look.fade ? ` (${look.fade} s fade)` : ""}`;
      this.log(this.showSwatches ? `${line}  ${swatches(this.config, (channel) => this.player.state(channel))}` : line);
    };
  }
}
