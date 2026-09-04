#!/usr/bin/env node

import { PROTOCOL_VERSION } from "../packages/protocol/src/index.js";

type Options = {
  url: string;
  count: number;
  durationMs: number;
  installationId: string;
  roomId: string;
  displayToken: string;
  joinRateLimitMaxAttempts: number;
  joinRateLimitWindowMs: number;
  continuousMovement: boolean;
  grant?: string;
};

type PhoneState = {
  socket: WebSocket;
  lease?: string;
  sessionId: string;
  phaseEpoch: number;
  questionActive: boolean;
  seq: number;
};

export class LoadMetrics {
  inputsAttempted = 0;
  inputsSent = 0;
  reconnects = 0;
  rejected = 0;
  cursorTicks = 0;
  readonly latencies: number[] = [];

  summary(): Record<string, number> {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const percentile = (fraction: number) => sorted.length === 0
      ? 0
      : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
    const dropped = this.inputsAttempted - this.inputsSent;
    return {
      inputsAttempted: this.inputsAttempted,
      inputsSent: this.inputsSent,
      dropped,
      dropPercent: this.inputsAttempted === 0 ? 0 : (dropped / this.inputsAttempted) * 100,
      reconnects: this.reconnects,
      rejected: this.rejected,
      cursorTicks: this.cursorTicks,
      latencySamples: sorted.length,
      latencyP50Ms: percentile(0.5),
      latencyP95Ms: percentile(0.95),
      latencyMaxMs: sorted.at(-1) ?? 0,
    };
  }
}

export function parseArgs(argv: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) throw new Error(`unexpected argument: ${flag ?? ""}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
  }
  const integer = (flag: string, fallback: number, min: number, max: number): number => {
    const raw = values.get(flag);
    const result = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(result) || result < min || result > max) {
      throw new Error(`${flag} must be an integer from ${min} to ${max}`);
    }
    return result;
  };
  return {
    url: values.get("--url") ?? "ws://127.0.0.1:3000/ws",
    count: integer("--count", 30, 1, 1_000),
    durationMs: integer("--duration-ms", 70_000, 1_000, 3_600_000),
    installationId: values.get("--installation-id") ?? "dev-installation",
    roomId: values.get("--room-id") ?? "main",
    displayToken: values.get("--display-token") ?? "dev-display-token",
    // Must match the target server's JOIN_RATE_LIMIT_MAX_ATTEMPTS /
    // JOIN_RATE_LIMIT_WINDOW_MS (apps/server/src/config.ts) -- these drive
    // the reconnect-timing math below, which otherwise trips the server's
    // own per-IP join limiter mid-test since every simulated client
    // connects from this one machine's address.
    joinRateLimitMaxAttempts: integer("--join-rate-limit-max-attempts", 30, 1, 100_000),
    joinRateLimitWindowMs: integer("--join-rate-limit-window-ms", 60_000, 1_000, 3_600_000),
    // Ignores real question-phase gating and drags every phone constantly,
    // regardless of scenario phase -- the server accepts "input" and
    // updates cursor position any time the session/phaseEpoch match
    // (phase-engine.ts's "input" case), independent of vote-window timing,
    // so this exercises display rendering under sustained movement without
    // needing to time the run against a specific phase's open/close window.
    continuousMovement: (values.get("--continuous-movement") ?? "false") === "true",
    // A grant copied from an already-connected real display (its `qr_grant`
    // message's `url` query param `g`), so this run never opens its own
    // display_join -- the server allows only one display connection and
    // force-closes/reloads whichever one held it before (phase-engine.ts's
    // "display replaced" handling), which would kick a real kiosk/observer
    // browser mid-test.
    ...(values.get("--grant") === undefined ? {} : { grant: values.get("--grant")! }),
  };
}

const encode = (message: unknown): string => JSON.stringify(message);

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
  });
}

function waitForMessage<T>(socket: WebSocket, accept: (message: any) => T | undefined): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(undefined, new Error("timed out waiting for server message")), 10_000);
    const onMessage = (event: MessageEvent) => {
      try {
        const accepted = accept(JSON.parse(String(event.data)));
        if (accepted !== undefined) finish(accepted);
      } catch (error) {
        finish(undefined, error as Error);
      }
    };
    const onClose = () => finish(undefined, new Error("socket closed while waiting for server message"));
    const finish = (value?: T, error?: Error) => {
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      if (error) reject(error); else resolve(value as T);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose, { once: true });
  });
}

async function openDisplay(options: Options, metrics: LoadMetrics): Promise<{ socket: WebSocket; grant: string }> {
  const socket = new WebSocket(options.url);
  await waitForOpen(socket);
  const grantPromise = waitForMessage(socket, (message) => {
    if (message.t !== "qr_grant") return undefined;
    return new URL(message.url).searchParams.get("g") ?? "";
  });
  socket.send(encode({
    t: "display_join", v: PROTOCOL_VERSION, clientVersion: "load-test", installationId: options.installationId,
    roomId: options.roomId, displayToken: options.displayToken,
  }));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.t === "cursors") metrics.cursorTicks += 1;
    if ((message.t === "snapshot" || message.t === "phase") && message.phase?.kind === "video") {
      socket.send(encode({
        t: "video_ended", v: PROTOCOL_VERSION, sessionId: message.sessionId, phaseId: message.phase.id,
        phaseEpoch: message.phaseEpoch, mediaId: message.phase.mediaId,
      }));
    }
  });
  return { socket, grant: await grantPromise };
}

async function openPhone(options: Options, grant: string, metrics: LoadMetrics, previous?: PhoneState): Promise<PhoneState> {
  const socket = new WebSocket(options.url);
  await waitForOpen(socket);
  const state: PhoneState = {
    socket, lease: previous?.lease, sessionId: previous?.sessionId ?? "idle",
    phaseEpoch: previous?.phaseEpoch ?? 0, questionActive: previous?.questionActive ?? false, seq: previous?.seq ?? 0,
  };
  const identityPromise = waitForMessage(socket, (message) => {
    if (message.t === "join_rejected") {
      metrics.rejected += 1;
      throw new Error(`join rejected: ${message.reason}`);
    }
    return message.t === "identity" ? message : undefined;
  });
  socket.send(encode({
    t: "join", v: PROTOCOL_VERSION, clientVersion: "load-test", installationId: options.installationId, name: "Simulated participant",
    roomId: options.roomId, joinGrant: grant, ...(state.lease ? { participantLease: state.lease } : {}),
  }));
  const identity = await identityPromise;
  state.lease = identity.participantLease;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.t === "snapshot" || message.t === "phase") {
      state.sessionId = message.sessionId;
      state.phaseEpoch = message.phaseEpoch;
      // Real shows use "video-position-question" (a video-backed variant of
      // "position-question", see packages/scenario/src/schema.ts) for every
      // interactive phase -- checking only the bare kind meant this script
      // never sent drag input against real production content.
      state.questionActive = message.phase?.kind === "position-question"
        || message.phase?.kind === "video-position-question";
    } else if (message.t === "pong") {
      metrics.latencies.push(Math.max(0, Date.now() - message.echoClientTime));
    }
  });
  return state;
}

export async function runSimulation(options: Options): Promise<Record<string, number>> {
  const metrics = new LoadMetrics();
  // A supplied --grant means an operator is already watching a real display
  // connection (e.g. to eyeball frontend performance) -- opening a second
  // display_join here would force-close and reload it (see the --grant
  // parsing comment above), so skip owning a display connection entirely.
  const display: { socket: WebSocket | null; grant: string } = options.grant === undefined
    ? await openDisplay(options, metrics)
    : { socket: null, grant: options.grant };
  const phones = await Promise.all(Array.from({ length: options.count }, () => openPhone(options, display.grant, metrics)));
  const movement = setInterval(() => {
    phones.forEach((phone, index) => {
      if (!phone.questionActive && !options.continuousMovement) return;
      metrics.inputsAttempted += 1;
      if (phone.socket.readyState !== WebSocket.OPEN) return;
      const angle = (phone.seq + index * 7) / 15;
      phone.socket.send(encode({
        t: "input", v: PROTOCOL_VERSION, sessionId: phone.sessionId, phaseEpoch: phone.phaseEpoch,
        seq: phone.seq++, x: 0.5 + Math.cos(angle) * 0.48, y: 0.5 + Math.sin(angle) * 0.48,
      }));
      metrics.inputsSent += 1;
    });
  }, 40);
  const pings = setInterval(() => {
    const clientTime = Date.now();
    for (const phone of phones) {
      if (phone.socket.readyState === WebSocket.OPEN) phone.socket.send(encode({ t: "ping", v: PROTOCOL_VERSION, clientTime }));
    }
  }, 1_000);

  const totalJoins = options.count + Math.ceil(options.count / 2);
  const reconnectAt = totalJoins > options.joinRateLimitMaxAttempts
    ? options.joinRateLimitWindowMs + 100
    : Math.floor(options.durationMs / 2);
  if (reconnectAt + 200 >= options.durationMs) {
    throw new Error(
      `duration is too short for reconnects under the ${options.joinRateLimitMaxAttempts} joins per ${options.joinRateLimitWindowMs}ms local rate limit`,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, reconnectAt));
  for (let index = 0; index < phones.length; index += 2) phones[index]!.socket.close();
  await new Promise((resolve) => setTimeout(resolve, 200));
  for (let index = 0; index < phones.length; index += 2) {
    phones[index] = await openPhone(options, display.grant, metrics, phones[index]);
    metrics.reconnects += 1;
  }
  await new Promise((resolve) => setTimeout(resolve, options.durationMs - reconnectAt - 200));

  clearInterval(movement);
  clearInterval(pings);
  for (const phone of phones) phone.socket.close();
  display.socket?.close();
  return metrics.summary();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summary = await runSimulation(options);
  console.log(JSON.stringify({ clients: options.count, durationMs: options.durationMs, ...summary }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`simulate-clients failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
