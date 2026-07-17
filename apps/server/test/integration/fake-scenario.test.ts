import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scenarioSchema } from "@smartphonecracy/scenario";
import type { WebSocket } from "ws";
import { AdmissionController } from "../../src/admission/index.js";
import { PhaseEngine, type PhaseCheckpoint } from "../../src/engine/phase-engine.js";

class TestSocket extends EventEmitter {
  readyState = 1;
  readonly sent: any[] = [];

  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", code, reason);
  }

  terminate(): void {
    this.close(1006, "terminated");
  }

  message(value: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(value)));
  }
}

const scenarioPath = fileURLToPath(new URL("../../../../content/scenarios/dev.json", import.meta.url));
const scenario = scenarioSchema.parse(JSON.parse(readFileSync(scenarioPath, "utf8")));
const showtest1Path = fileURLToPath(new URL("../../../../content/scenarios/showtest1.json", import.meta.url));
const showtest1 = scenarioSchema.parse(JSON.parse(readFileSync(showtest1Path, "utf8")));

function request(ip: string): IncomingMessage {
  return { headers: {}, socket: { remoteAddress: ip } } as unknown as IncomingMessage;
}

function last(socket: TestSocket, type: string): any {
  return socket.sent.filter((message) => message.t === type).at(-1);
}

function createHarness(
  policy: { noParticipantGraceMs?: number } = {},
  testScenario: typeof scenario = scenario,
) {
  let now = 1_000;
  let sessionCounter = 0;
  const checkpoints: PhaseCheckpoint[] = [];
  let activeDisplay: TestSocket | undefined;
  let engine: PhaseEngine;
  const admission = new AdmissionController({
    installationId: "inst-1",
    roomId: "room-1",
    secret: "integration-test-secret",
    now: () => now,
    disconnectGraceMs: 50,
    policy: { maxParticipants: 30, joinGrantTtlMs: 120_000, participantLeaseTtlMs: 7_200_000 },
    sessionId: () => engine.currentSessionId,
    isNewParticipantAllowed: () => engine.lifecycleState !== "active",
    onClientMessage: (message, socket, req) => engine.handleClientMessage(message, socket, req),
    onParticipantJoin: (participant, socket) => engine.participantJoined(socket, participant),
    onSocketClosed: (socket) => engine.socketClosed(socket),
  });
  engine = new PhaseEngine({
    scenario: testScenario,
    registry: admission.registry,
    installationId: "inst-1",
    roomId: "room-1",
    displayToken: "display-secret",
    now: () => now,
    sessionIdFactory: () => `session-${++sessionCounter}`,
    policy: {
      lobbyCountdownMs: 100,
      interactiveIdleTimeoutMs: 60_000,
      maxSessionDurationMs: 120_000,
      displayDisconnectTimeoutMs: 500,
      noParticipantGraceMs: policy.noParticipantGraceMs ?? 500,
    },
    onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
  });

  const connect = (socket: TestSocket, ip: string) => {
    admission.handleConnection(socket as unknown as WebSocket, request(ip));
  };
  const display = () => {
    const socket = new TestSocket();
    activeDisplay = socket;
    connect(socket, "192.0.2.1");
    socket.message({
      t: "display_join", v: 2, clientVersion: "test", installationId: "inst-1",
      roomId: "room-1", displayToken: "display-secret",
    });
    return socket;
  };
  const phone = async (suffix: number, participantLease?: string) => {
    const socket = new TestSocket();
    connect(socket, `198.51.100.${suffix}`);
    socket.message({
      t: "join", v: 2, clientVersion: "test", installationId: "inst-1", roomId: "room-1",
      joinGrant: admission.issueJoinGrant(now).token,
      ...(participantLease === undefined ? {} : { participantLease }),
    });
    await Promise.resolve();
    return socket;
  };
  const advance = (milliseconds: number) => {
    now += milliseconds;
    if (activeDisplay?.readyState === 1) {
      activeDisplay.message({
        t: "display_heartbeat",
        v: 2,
        sessionId: engine.currentSessionId,
        phaseId: engine.currentPhaseId,
        phaseEpoch: engine.currentPhaseEpoch,
        clientTime: now,
      });
    }
    engine.tick(now);
  };
  const input = (socket: TestSocket, seq: number, x: number, y: number) => {
    socket.message({
      t: "input", v: 2, sessionId: engine.currentSessionId, phaseId: engine.currentPhaseId,
      phaseEpoch: engine.currentPhaseEpoch, seq, x, y, clientTime: now,
    });
  };

  return { admission, advance, checkpoints, display, engine, input, phone, now: () => now };
}

describe("fake scenario server integration", () => {
  it.each([
    { label: "Crazy", x: 0.2, winner: "min", target: "video-3f7f2c", media: "video-3.mp4" },
    { label: "Weird", x: 0.8, winner: "max", target: "video-242f2a", media: "video-2.mp4" },
  ])("runs showtest1's $label branch to its result video and back to idle", async ({ x, winner, target, media }) => {
    const h = createHarness({}, showtest1);
    const display = h.display();
    const phone = await h.phone(1);

    h.advance(100);
    expect(h.engine.currentPhaseId).toBe("video-5c6497");
    display.message({
      t: "video_ended", v: 2, sessionId: h.engine.currentSessionId, phaseId: "video-5c6497",
      phaseEpoch: h.engine.currentPhaseEpoch, mediaId: "video-1.mp4",
    });
    expect(h.engine.currentPhaseId).toBe("position-question-068b73");

    h.advance(50_000);
    h.input(phone, 1, x, 0.5);
    await Promise.resolve();
    h.advance(10_000);
    expect(last(display, "question_resolved")).toMatchObject({ winner, resolvedTarget: target });

    h.advance(5_000);
    expect(h.engine.currentPhaseId).toBe(target);
    display.message({
      t: "video_ended", v: 2, sessionId: h.engine.currentSessionId, phaseId: target,
      phaseEpoch: h.engine.currentPhaseEpoch, mediaId: media,
    });
    expect(h.engine.lifecycleState).toBe("idle");
    expect(h.engine.currentPhaseId).toBe("idle");
  });

  it("drives join through lobby, video, all question resolutions, and back to idle", async () => {
    const h = createHarness();
    const display = h.display();
    const phone = await h.phone(1);

    expect(last(phone, "identity")).toMatchObject({ t: "identity", sessionId: "idle" });
    expect(h.engine.lifecycleState).toBe("lobby");
    h.advance(100);
    expect(h.engine.currentPhaseId).toBe("intro-video");

    display.message({
      t: "video_ended", v: 2, sessionId: h.engine.currentSessionId, phaseId: "intro-video",
      phaseEpoch: h.engine.currentPhaseEpoch, mediaId: "intro.mp4",
    });
    expect(h.engine.currentPhaseId).toBe("question-fixed");
    h.input(phone, 1, 0.8, 0.2);
    await Promise.resolve();
    h.advance(20_000);
    expect(last(display, "question_resolved")).toMatchObject({ winner: "fixed", resolvedTarget: "question-quadrant" });
    h.advance(3_000);
    expect(h.engine.currentPhaseId).toBe("question-quadrant");

    h.input(phone, 2, 0.8, 0.2);
    await Promise.resolve();
    h.advance(20_000);
    expect(last(display, "question_resolved")).toMatchObject({ winner: "q1", resolvedTarget: "question-two-quadrant" });
    h.advance(3_000);
    expect(h.engine.currentPhaseId).toBe("question-two-quadrant");

    h.input(phone, 3, 0.8, 0.2);
    await Promise.resolve();
    h.advance(20_000);
    expect(last(display, "question_resolved")).toMatchObject({
      field: { type: "two-quadrant", axis: "x" },
      quadrantCounts: { min: 0, max: 1 },
      winner: "max",
      resolvedTarget: "idle",
    });
    h.advance(3_000);
    expect(h.engine.lifecycleState).toBe("idle");
    expect(h.engine.currentPhaseId).toBe("idle");
    expect(h.checkpoints.map((checkpoint) => checkpoint.reason)).toEqual(expect.arrayContaining([
      "lobby-start", "session-start", "video-complete", "question-freeze-complete",
    ]));
  });

  it("rejects a late join, reconnects an existing lease, and completes the scenario", async () => {
    const h = createHarness();
    const display = h.display();
    const first = await h.phone(1);
    const firstLease = last(first, "identity").participantLease as string;
    h.advance(100);
    display.message({
      t: "video_ended", v: 2, sessionId: h.engine.currentSessionId, phaseId: "intro-video",
      phaseEpoch: h.engine.currentPhaseEpoch, mediaId: "intro.mp4",
    });
    const late = await h.phone(2);
    expect(last(late, "join_rejected")).toMatchObject({ reason: "show_in_progress" });
    first.close();
    const reconnected = await h.phone(3, firstLease);
    expect(last(reconnected, "snapshot")).toMatchObject({ phase: { id: "question-fixed" } });
    h.input(reconnected, 1, 0.2, 0.2);
    await Promise.resolve();
    h.advance(20_000);
    expect(last(display, "question_resolved")).toMatchObject({ winner: "fixed" });
    expect(h.admission.registry.connectedCount).toBe(1);
    h.advance(3_000);
    h.input(reconnected, 2, 0.2, 0.2);
    await Promise.resolve();
    h.advance(20_000);
    h.advance(3_000);
    h.input(reconnected, 3, 0.2, 0.2);
    await Promise.resolve();
    h.advance(20_000);
    expect(last(display, "question_resolved")).toMatchObject({ winner: "min", resolvedTarget: "idle" });
    h.advance(3_000);
    expect(h.engine.lifecycleState).toBe("idle");
  });

  it("abandons a solo session after disconnect grace and recovers active state after a crash", async () => {
    const abandoned = createHarness({ noParticipantGraceMs: 200 });
    abandoned.display();
    const solo = await abandoned.phone(1);
    abandoned.advance(100);
    expect(abandoned.engine.lifecycleState).toBe("active");
    solo.close();
    abandoned.advance(200);
    expect(abandoned.engine.lifecycleState).toBe("active");
    abandoned.advance(200);
    expect(abandoned.engine.lifecycleState).toBe("idle");
    expect(abandoned.checkpoints.at(-1)?.reason).toBe("no-participants");

    const recovered = createHarness();
    recovered.display();
    await recovered.phone(2);
    recovered.advance(100);
    recovered.engine.recoverAfterCrash(recovered.now());
    expect(recovered.engine.lifecycleState).toBe("idle");
    expect(recovered.checkpoints.slice(-2).map((checkpoint) => [checkpoint.kind, checkpoint.reason])).toEqual([
      ["recovery", "crash-recovery"],
      ["transition", "crash-recovery"],
    ]);
  });
});
