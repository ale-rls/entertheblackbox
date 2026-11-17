import { Socket } from "node:net";
import type { ChannelValues, Param } from "./config.js";
import { oscAddress, oscMessage, slipEncode, SlipDecoder, type OscArg } from "./osc.js";

export type Log = (line: string) => void;

/** Where looks go. The Eos connection implements it; tests and --dry-run use stand-ins. */
export type LightOutput = {
  readonly name: string;
  /**
   * Set some parameters on one Eos channel. `final` marks the last frame of a
   * look (or a snap). Returns false when the values could not be delivered.
   */
  set(channel: number, values: ChannelValues, final: boolean): boolean;
  close(): void;
};

export type EosTarget = { host: string; port: number; user: number };
export type FixtureSetup = Array<{ channel: number; params: Record<string, number> }>;

/** Eos parameter names as /eos/chan/<n>/param/<name> accepts them. */
const PARAM_NAME: Record<Param, string> = { intens: "intens", red: "red", green: "green", blue: "blue", amber: "amber", mint: "mint" };

const sameTarget = (a: EosTarget, b: EosTarget) => a.host === b.host && a.port === b.port && a.user === b.user;

/**
 * One OSC-over-TCP connection to Eos, reconnecting on its own. While it is
 * down, `set` returns false and nothing is sent; `onConnectionChange` tells
 * the player so it stops trusting what it believes the desk shows.
 */
export class EosConnection implements LightOutput {
  private socket: Socket | null = null;
  private connected = false;
  private closed = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private warnedAt = 0;
  private decoder = new SlipDecoder();
  private pongWaiters: Array<() => void> = [];
  /** The desk stopped reading (the socket's buffer is full): values are skipped, not queued, until it drains. */
  private behind = false;

  constructor(
    private target: EosTarget,
    private readonly log: Log,
    private readonly options: {
      /** Sent after every (re)connect: channel → parameters (e.g. dim mode). */
      setup?: FixtureSetup;
      /** Called with true on connect (after the setup went out), false when an open connection is lost. */
      onConnectionChange?: (connected: boolean) => void;
      /** Called when a desk that had stopped reading has taken the backlog: what was skipped meanwhile can go out. */
      onCaughtUp?: () => void;
      retryMs?: number;
    } = {},
  ) {}

  get name(): string {
    return `Eos ${this.target.host}:${this.target.port}`;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Store a reloaded setup; send it only if it changed (every connect sends it anyway). */
  setSetup(setup: FixtureSetup): void {
    const changed = JSON.stringify(setup) !== JSON.stringify(this.options.setup ?? []);
    this.options.setup = setup;
    if (changed && this.connected) this.applySetup();
  }

  /**
   * Apply a reloaded lighting file's desk settings. Switches desks first, so a
   * new setup never reaches the old desk: if the target changed, the setup is
   * only stored and goes out when the new connection opens. Returns true when
   * the desk changed.
   */
  configure(target: EosTarget, setup: FixtureSetup): boolean {
    const moved = this.retarget(target);
    this.setSetup(setup);
    return moved;
  }

  /** Switch to another desk address/port/user: drop the connection and reconnect there. */
  retarget(target: EosTarget): boolean {
    if (sameTarget(target, this.target)) return false;
    const before = this.name;
    this.target = { ...target };
    this.log(`desk settings changed (${before} → ${this.name}, user ${target.user}) · reconnecting`);
    clearTimeout(this.retryTimer);
    const socket = this.socket;
    this.dropSocket();
    socket?.destroy();
    this.connect();
    return true;
  }

  connect(): void {
    if (this.closed) return;
    const socket = new Socket();
    this.socket = socket;
    this.decoder = new SlipDecoder();
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 5_000);
    socket.on("connect", () => {
      if (socket !== this.socket) return;
      this.connected = true;
      this.behind = false;
      this.warnedAt = 0;
      this.log(`connected to ${this.name} as Eos user ${this.target.user}`);
      this.send("/eos/user", this.target.user);
      this.applySetup();
      this.options.onConnectionChange?.(true);
    });
    socket.on("drain", () => {
      if (socket !== this.socket || !this.behind) return;
      this.behind = false;
      this.log(`${this.name} caught up · sending the current look`);
      this.options.onCaughtUp?.();
    });
    // Eos streams state updates to every client; only pongs matter here.
    socket.on("data", (chunk) => {
      if (socket !== this.socket) return;
      for (const frame of this.decoder.push(chunk)) {
        if (oscAddress(frame) === "/eos/out/ping") for (const resolve of this.pongWaiters.splice(0)) resolve();
      }
    });
    socket.on("error", (error) => {
      if (socket !== this.socket) return;
      const now = Date.now();
      if (now - this.warnedAt > 10_000) {
        this.log(`cannot reach ${this.name} (${error.message}) · retrying`);
        this.warnedAt = now;
      }
    });
    socket.on("close", () => {
      if (socket !== this.socket) return;
      this.dropSocket();
      if (!this.closed) this.retryTimer = setTimeout(() => this.connect(), this.options.retryMs ?? 2_000);
    });
    socket.connect(this.target.port, this.target.host);
  }

  /** Resolves true when Eos answers /eos/ping within `timeoutMs`. */
  ping(timeoutMs = 3_000): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pongWaiters = this.pongWaiters.filter((waiter) => waiter !== done); resolve(false); }, timeoutMs);
      const done = () => { clearTimeout(timer); resolve(true); };
      this.pongWaiters.push(done);
      this.send("/eos/ping", "eos-bridge");
    });
  }

  set(channel: number, values: ChannelValues): boolean {
    if (!this.connected || !this.socket) return false;
    // A desk that stops reading (Nomad hanging with the connection open) would make every fade frame queue up
    // in memory and play back stale later. Skip instead: the player treats the values as undelivered.
    if (this.socket.writableNeedDrain) {
      if (!this.behind) { this.behind = true; this.log(`${this.name} is not keeping up · skipping light changes until it does`); }
      return false;
    }
    // Address every value to its channel. Never /eos/param/<name>: that hits whatever is selected, and in a
    // burst of messages the selection has already moved on to a later channel (only the last lamp changes).
    for (const [param, value] of Object.entries(values) as Array<[Param, number]>) {
      if (param === "intens") this.send(`/eos/chan/${channel}`, { float: value });
      else this.send(`/eos/chan/${channel}/param/${PARAM_NAME[param]}`, { float: value });
    }
    return true;
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    const socket = this.socket;
    this.dropSocket();
    socket?.end();
    socket?.destroy();
  }

  /** Forget the current socket; report the loss if it was open. */
  private dropSocket(): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.socket = null;
    // Closing on purpose (the bridge exiting) is not a loss worth reporting.
    if (wasConnected && !this.closed) {
      this.log(`lost ${this.name} · reconnecting…`);
      this.options.onConnectionChange?.(false);
    }
  }

  private applySetup(): void {
    const setup = this.options.setup ?? [];
    for (const { channel, params } of setup) {
      for (const [param, value] of Object.entries(params)) this.send(`/eos/chan/${channel}/param/${param}`, { float: value });
    }
    if (setup.length) {
      this.log(`fixture setup sent (${setup.map(({ channel, params }) => `${channel}: ${Object.entries(params).map(([p, v]) => `${p} ${v}`).join(", ")}`).join(" · ")})`);
    }
  }

  private send(address: string, ...args: OscArg[]): void {
    if (!this.connected || !this.socket) return;
    this.socket.write(slipEncode(oscMessage(address, ...args)));
  }
}

/** --dry-run: log where each look ends up (fade frames in between are not printed). */
export function dryRunOutput(log: Log): LightOutput {
  return {
    name: "dry run (nothing sent)",
    set: (channel, values, final) => {
      if (final) log(`  chan ${channel} ← ${Object.entries(values).map(([param, value]) => `${param} ${value}`).join(", ")}`);
      return true;
    },
    close: () => {},
  };
}
