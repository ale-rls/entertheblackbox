import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { scenarioSchema } from "@entertheblackbox/scenario";
import type { WebSocket } from "ws";
import { ParticipantRegistry } from "../admission/index.js";
import type {
  MovementBatchFlushed,
  MovementRecordingFinalized,
  MovementRecordingStarted,
} from "../movement/index.js";
import { PhaseEngine, type PhaseCheckpoint } from "./phase-engine.js";
import type { GhostPool } from "../ghosts/index.js";
import type { FinalVoteSnapshot } from "../votes/index.js";

class MockSocket extends EventEmitter {
  readyState = 1;
  readonly sent: any[] = [];
  readonly closes: Array<{ code: number | undefined; reason: string | undefined }> = [];

  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
    this.readyState = 3;
    this.emit("close");
  }

  terminate(): void {
    this.close(1006, "terminated");
  }
}

const scenario = scenarioSchema.parse({
  version: "engine-test-1",
  entryPhaseId: "intro",
  cyclesAllowed: false,
  phases: [
    { kind: "idle", id: "idle" },
    { kind: "video", id: "intro", src: "intro.mp4", expectedDurationMs: 100, next: "question" },
    {
      kind: "position-question",
      id: "question",
      text: "Choose",
      xAxis: { minLabel: "left", maxLabel: "right" },
      yAxis: { minLabel: "up", maxLabel: "down" },
      durationMs: 200,
      freezeMs: 20,
      connectionStaleAfterMs: 100,
      showLiveCounts: false,
      next: { type: "fixed", target: "idle" },
    },
  ],
});

function setup(options: {
  now: () => number;
  sessionIdFactory?: () => string;
  checkpoints?: PhaseCheckpoint[];
  lobbyCountdownMs?: number;
  interactiveIdleTimeoutMs?: number;
  maxSessionDurationMs?: number;
  displayDisconnectTimeoutMs?: number;
  testScenario?: typeof scenario;
  onVoteSnapshotEnqueued?: (snapshot: FinalVoteSnapshot) => void;
  sessionEnds?: Array<{ reason: string; sessionId: string; endedAt: number }>;
  movementStarted?: MovementRecordingStarted[];
  movementBatches?: MovementBatchFlushed[];
  movementFinalized?: MovementRecordingFinalized[];
  ghostPool?: GhostPool;
  qr?: boolean | { allowLateJoin: boolean };
  autoStartOnFirstParticipant?: boolean;
  scheduledStartTimes?: number[];
  groupSelection?: NonNullable<ConstructorParameters<typeof PhaseEngine>[0]["groupSelection"]>;
  cueEvents?: Array<{ type: string }>;
} ) {
  const registry = new ParticipantRegistry(2, 50);
  const checkpoints = options.checkpoints ?? [];
  const engine = new PhaseEngine({
    scenario: options.testScenario ?? scenario,
    registry,
    installationId: "inst-1",
    roomId: "room-1",
    showId: "show-1",
    displayToken: "display-secret",
    now: options.now,
    sessionIdFactory: options.sessionIdFactory ?? (() => "session-1"),
    policy: {
      lobbyCountdownMs: options.lobbyCountdownMs ?? 100,
      interactiveIdleTimeoutMs: options.interactiveIdleTimeoutMs ?? 100,
      maxSessionDurationMs: options.maxSessionDurationMs ?? 10_000,
      displayDisconnectTimeoutMs: options.displayDisconnectTimeoutMs ?? 1_000_000,
    },
    onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
    ...(options.cueEvents === undefined ? {} : { onCueEvent: (event: { type: string }) => { options.cueEvents!.push(event); } }),
    ...(options.groupSelection === undefined ? {} : { groupSelection: options.groupSelection }),
    ...(options.autoStartOnFirstParticipant === undefined ? {} : { autoStartOnFirstParticipant: options.autoStartOnFirstParticipant }),
    ...(options.scheduledStartTimes === undefined ? {} : { scheduledStartTimes: options.scheduledStartTimes }),
    ...(options.sessionEnds === undefined
      ? {}
      : { onSessionEnded: (event: { reason: string; sessionId: string; endedAt: number }) => options.sessionEnds!.push(event) }),
    ...(options.onVoteSnapshotEnqueued === undefined
      ? {}
      : { onVoteSnapshotEnqueued: options.onVoteSnapshotEnqueued }),
    ...(options.movementStarted === undefined
      ? {}
      : { onMovementRecordingStarted: (event: MovementRecordingStarted) => options.movementStarted!.push(event) }),
    ...(options.movementBatches === undefined
      ? {}
      : { onMovementBatchFlushed: (event: MovementBatchFlushed) => options.movementBatches!.push(event) }),
    ...(options.movementFinalized === undefined
      ? {}
      : {
          onMovementRecordingFinalized: (event: MovementRecordingFinalized) =>
            options.movementFinalized!.push(event),
        }),
    ...(options.ghostPool === undefined ? {} : { ghostPool: options.ghostPool }),
    ...(options.qr
      ? {
          qr: {
            phoneJoinBaseUrl: "https://phone.example/join",
            issueGrant: (issuedAt: number) => ({
              token: `grant-${issuedAt}`,
              claims: { installationId: "inst-1", roomId: "room-1", expiresAt: issuedAt + 120_000 },
            }),
            ...(typeof options.qr === "object" ? options.qr : {}),
          },
        }
      : {}),
  });
  return { engine, registry, checkpoints };
}

const longVideoScenario = scenarioSchema.parse({
  ...scenario,
  phases: scenario.phases.map((phase) => phase.id === "intro"
    ? { ...phase, expectedDurationMs: 220_000 }
    : phase),
});

const liveCountsScenario = scenarioSchema.parse({
  ...scenario,
  phases: scenario.phases.map((phase) => phase.kind === "position-question"
    ? { ...phase, showLiveCounts: true }
    : phase),
});

const targetAudienceScenario = (targetAudienceSize: number) => scenarioSchema.parse({
  ...scenario,
  targetAudienceSize,
});

const ratingScenario = scenarioSchema.parse({
  ...scenario,
  version: "engine-test-rating",
  phases: scenario.phases.map((phase) => phase.id === "intro"
    ? { ...phase, rating: { candidateLabel: "OpenApollo" } }
    : phase),
});

const compositeVideoQuestionScenario = scenarioSchema.parse({
  version: "engine-test-video-question",
  entryPhaseId: "video-question",
  cyclesAllowed: false,
  phases: [
    { kind: "idle", id: "idle" },
    {
      kind: "video-position-question",
      id: "video-question",
      src: "question.mp4",
      expectedDurationMs: 1_000,
      text: "Choose while the video plays",
      field: {
        type: "four-quadrant",
        xAxis: { minLabel: "left", maxLabel: "right" },
        yAxis: { minLabel: "up", maxLabel: "down" },
      },
      showAtMs: 15,
      openAtMs: 20,
      closeAtMs: 40,
      hideAtMs: 50,
      connectionStaleAfterMs: 100,
      showLiveCounts: true,
      rating: { candidateLabel: "OpenApollo" },
      next: { type: "fixed", target: "idle" },
    },
  ],
});

const twoQuadrantScenario = scenarioSchema.parse({
  ...scenario,
  version: "engine-test-two-quadrant",
  phases: scenario.phases.map((phase) => phase.kind === "position-question"
    ? {
        ...phase,
        field: {
          type: "two-quadrant",
          axis: "x",
          variant: "spectrum",
          labels: { minLabel: "Disagree", maxLabel: "Agree" },
        },
        showLiveCounts: true,
        next: {
          type: "quadrant-plurality",
          map: { min: "idle", max: "idle" },
          tie: "idle",
          empty: "idle",
          countedStatuses: ["valid", "stale", "disconnected"],
        },
      }
    : phase),
});

function addParticipant(registry: ParticipantRegistry, socket: WebSocket, now: number, id: string): void {
  const result = registry.admit({
    participantLease: `lease-${id}`,
    clientId: id,
    name: id,
    leaseExpiresAt: now + 10_000,
    socket,
    now,
  });
  expect(result.ok).toBe(true);
}

function connectDisplay(engine: PhaseEngine, socket: WebSocket): void {
  engine.handleClientMessage({
    t: "display_join",
    v: 2,
    clientVersion: "test",
    installationId: "inst-1",
    roomId: "room-1",
    displayToken: "display-secret",
  }, socket);
}

/** Ends the current video the way production does: the server clock reaches its end. */
function finishVideo(engine: PhaseEngine): number {
  const endAt = engine.getSnapshot().deadlineAt;
  if (endAt === null) throw new Error("expected a video deadline");
  engine.tick(endAt);
  return endAt;
}

function connectSignage(engine: PhaseEngine, socket: WebSocket, signageId: string): void {
  engine.handleClientMessage({
    t: "display_join",
    v: 2,
    clientVersion: "test",
    installationId: "inst-1",
    roomId: "room-1",
    displayToken: "display-secret",
    signageId,
  }, socket);
}

describe("PhaseEngine lifecycle", () => {
  it("starts a scheduled show with no participants", () => {
    let now = 1_000;
    const { engine } = setup({ now: () => now, scheduledStartTimes: [2_000], autoStartOnFirstParticipant: false });
    engine.tick(now);
    expect(engine.lifecycleState).toBe("lobby");
    now = 2_000;
    engine.tick(now);
    expect(engine.lifecycleState).toBe("active");
    expect(engine.currentPhaseId).toBe("intro");
    expect(engine.connectedParticipantCount).toBe(0);
  });

  it("waits for an operator or scheduled start when participant-count auto-start is disabled", () => {
    let now = 1_000;
    const { engine, registry } = setup({ now: () => now, autoStartOnFirstParticipant: false });
    const display = new MockSocket();
    const phone = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    connectDisplay(engine, display as unknown as WebSocket);
    engine.participantJoined(phone as unknown as WebSocket, registry.values()[0]);

    expect(engine.lifecycleState).toBe("lobby");
    expect(engine.getSnapshot().deadlineAt).toBeNull();
    now = 10_000;
    engine.tick(now);
    expect(engine.lifecycleState).toBe("lobby");

    engine.setLobbyStartTimes([20_000], now);
    expect(engine.nextLobbyStartAt).toBe(20_000);
    expect(engine.adjustLobbyStart(10_000, now)).toEqual({ ok: true });
    expect(engine.nextLobbyStartAt).toBe(30_000);
    now = 30_000;
    engine.tick(now);
    expect(engine.lifecycleState).toBe("active");
    expect(engine.nextLobbyStartAt).toBeNull();
  });

  it("encodes a broadcast once and reuses it for every open socket", () => {
    const { engine } = setup({ now: () => 1_000 });
    const first = new MockSocket();
    const second = new MockSocket();
    engine.participantJoined(first as unknown as WebSocket);
    engine.participantJoined(second as unknown as WebSocket);
    first.sent.length = 0;
    second.sent.length = 0;
    const stringify = vi.spyOn(JSON, "stringify");

    try {
      (engine as unknown as {
        broadcast(message: { t: "presence"; v: 2; count: number }): void;
      }).broadcast({ t: "presence", v: 2, count: 2 });

      expect(stringify).toHaveBeenCalledTimes(1);
      expect(first.sent).toEqual([{ t: "presence", v: 2, count: 2 }]);
      expect(second.sent).toEqual(first.sent);
    } finally {
      stringify.mockRestore();
    }
  });

  it("pushes a QR grant on display join and authenticated refresh requests", () => {
    const { engine } = setup({ now: () => 1_000, qr: true });
    const display = new MockSocket();
    connectDisplay(engine, display as unknown as WebSocket);
    expect(display.sent.filter((message) => message.t === "qr_grant")).toHaveLength(1);
    const joinUrl = new URL(display.sent.find((message) => message.t === "qr_grant").url);
    expect(joinUrl.toString()).toBe("https://phone.example/join");

    engine.handleClientMessage({ t: "qr_grant_request", v: 2 }, display as unknown as WebSocket);
    expect(display.sent.filter((message) => message.t === "qr_grant")).toHaveLength(2);

    const stranger = new MockSocket();
    engine.handleClientMessage({ t: "qr_grant_request", v: 2 }, stranger as unknown as WebSocket);
    expect(stranger.sent).toEqual([]);
  });

  it("pushes QR grants to signage kiosks, and only QR grants", () => {
    const { engine } = setup({ now: () => 1_000, qr: true });
    const lobby = new MockSocket();
    connectSignage(engine, lobby as unknown as WebSocket, "lobby");

    expect(lobby.sent).toEqual([{ t: "qr_grant", v: 2, url: "https://phone.example/join", expiresAt: 121_000, placement: "large", showJoinUrl: true }]);

    engine.handleClientMessage({ t: "qr_grant_request", v: 2 }, lobby as unknown as WebSocket);
    expect(lobby.sent.filter((message) => message.t === "qr_grant")).toHaveLength(2);
  });

  it("keeps a signage kiosk independent of the main display and other signage spots", () => {
    const { engine } = setup({ now: () => 1_000, qr: true });
    const display = new MockSocket();
    const lobby = new MockSocket();
    const entrance = new MockSocket();
    connectDisplay(engine, display as unknown as WebSocket);
    display.sent.length = 0;
    connectSignage(engine, lobby as unknown as WebSocket, "lobby");
    connectSignage(engine, entrance as unknown as WebSocket, "entrance");

    // A newly connecting signage kiosk pushes a grant to every signage
    // socket and the main display, matching the shared push-loop behavior.
    expect(lobby.sent.filter((message) => message.t === "qr_grant")).toHaveLength(2);
    expect(entrance.sent.filter((message) => message.t === "qr_grant")).toHaveLength(1);
    expect(display.sent.filter((message) => message.t === "qr_grant").length).toBeGreaterThan(0);

    // Reconnecting the same signage id replaces the old socket, not the other spot.
    const replacementLobby = new MockSocket();
    connectSignage(engine, replacementLobby as unknown as WebSocket, "lobby");
    expect(lobby.closes.length).toBeGreaterThan(0);
    expect(entrance.closes).toEqual([]);
    expect(display.closes).toEqual([]);
  });

  it.each([true, false])("keeps the join QR on signage during the show only while late joining is allowed (%s)", (allowLateJoin) => {
    const { engine } = setup({ now: () => 1_000, qr: { allowLateJoin } });
    const display = new MockSocket();
    const entrance = new MockSocket();
    connectDisplay(engine, display as unknown as WebSocket);
    connectSignage(engine, entrance as unknown as WebSocket, "entrance");
    display.sent.length = 0;
    entrance.sent.length = 0;
    expect(engine.adminStart(1_000)).toEqual({ ok: true });
    // Never over the projection while the show runs.
    expect(display.sent.filter((message) => message.t === "qr_grant")).toEqual([]);
    expect(display.sent.some((message) => message.t === "qr_hidden")).toBe(true);
    const lastQr = () => entrance.sent.filter((message) => message.t === "qr_grant" || message.t === "qr_hidden").at(-1)?.t;
    expect(lastQr()).toBe(allowLateJoin ? "qr_grant" : "qr_hidden");
    entrance.sent.length = 0;
    engine.handleClientMessage({ t: "qr_grant_request", v: 2 }, entrance as unknown as WebSocket);
    expect(lastQr()).toBe(allowLateJoin ? "qr_grant" : "qr_hidden");
  });

  it("starts the lobby and show without a display", () => {
    let now = 1_000;
    const { engine, registry } = setup({ now: () => now });
    const phone = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    expect(engine.lifecycleState).toBe("lobby");
    expect(engine.currentPhaseId).toBe("idle");
    now = 1_100;
    engine.tick(now);
    expect(engine.lifecycleState).toBe("active");
    expect(engine.currentSessionId).toBe("session-1");
    expect(engine.currentPhaseId).toBe("intro");
  });

  it("terminates a display whose socket stays open after its heartbeat expires", () => {
    let now = 1_000;
    const checkpoints: PhaseCheckpoint[] = [];
    const { engine, registry } = setup({
      now: () => now,
      checkpoints,
      lobbyCountdownMs: 10,
      displayDisconnectTimeoutMs: 100,
    });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);

    now = 1_010;
    engine.tick(now);
    expect(engine.lifecycleState).toBe("active");
    expect(engine.isDisplayConnected).toBe(true);

    now = 1_099;
    engine.tick(now);
    expect(engine.lifecycleState).toBe("active");
    expect(display.readyState).toBe(1);

    now = 1_100;
    engine.tick(now);
    expect(display.readyState).toBe(3);
    expect(engine.isDisplayConnected).toBe(false);
    expect(engine.displayHeartbeatAgeMs).toBeNull();
    expect(engine.lifecycleState).toBe("active");
    expect(checkpoints.at(-1)?.reason).toBe("session-start");
  });

  it.each(["lobby", "active"] as const)("keeps the %s running after the display closes", (stage) => {
    let now = 1_000;
    const { engine, registry } = setup({
      now: () => now,
      displayDisconnectTimeoutMs: 10,
      testScenario: longVideoScenario,
    });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);
    if (stage === "active") expect(engine.adminStart(now)).toEqual({ ok: true });
    engine.socketClosed(display as unknown as WebSocket);
    now += 20;
    engine.tick(now);
    expect(engine.lifecycleState).toBe(stage);
    now = 1_200;
    engine.tick(now);
    expect(engine.lifecycleState).toBe("active");
  });

  it.each([false, true])("starts without a display using scheduled=%s", (scheduled) => {
    let now = 1_000;
    const { engine, registry } = setup({
      now: () => now,
      autoStartOnFirstParticipant: false,
      scheduledStartTimes: scheduled ? [1_100] : [],
    });
    if (scheduled) {
      engine.tick(now);
      expect(engine.lifecycleState).toBe("lobby");
    }
    const phone = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    if (scheduled) {
      now = 1_100;
      engine.tick(now);
    } else {
      expect(engine.adminStart(now)).toEqual({ ok: true });
    }
    expect(engine.lifecycleState).toBe("active");
  });

  it("keeps a live display connected while current-phase heartbeats arrive", () => {
    let now = 1_000;
    const { engine, registry } = setup({
      now: () => now,
      lobbyCountdownMs: 10,
      displayDisconnectTimeoutMs: 100,
    });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);

    now = 1_010;
    engine.tick(now);
    expect(engine.lifecycleState).toBe("active");

    for (const heartbeatAt of [1_090, 1_180, 1_270]) {
      now = heartbeatAt;
      engine.handleClientMessage({
        t: "display_heartbeat",
        v: 2,
        sessionId: engine.currentSessionId,
        phaseId: engine.currentPhaseId,
        phaseEpoch: engine.currentPhaseEpoch,
        clientTime: heartbeatAt,
      }, display as unknown as WebSocket);
      now += 99;
      engine.tick(now);
      expect(engine.lifecycleState).toBe("active");
      expect(engine.isDisplayConnected).toBe(true);
      expect(engine.displayHeartbeatAgeMs).toBe(99);
      expect(display.readyState).toBe(1);
    }
  });

  it("ends a video on the server clock at its expected duration", () => {
    let now = 1_000;
    const { engine, registry } = setup({ now: () => now });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now);
    expect(engine.getSnapshot().deadlineAt).toBe(1_200);
    engine.tick(1_199);
    expect(engine.currentPhaseId).toBe("intro");
    engine.tick(1_200);
    expect(engine.currentPhaseId).toBe("question");
  });

  it("opens and freezes a video vote on its timeline, then branches when the video ends", () => {
    let now = 1_000;
    const { engine, registry } = setup({ now: () => now, testScenario: compositeVideoQuestionScenario });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
    connectDisplay(engine, display as unknown as WebSocket);

    now = 1_100;
    engine.tick(now);
    expect(engine.currentPhaseId).toBe("video-question");
    const epoch = engine.currentPhaseEpoch;

    now = 1_119;
    engine.tick(now);
    expect(display.sent.some((message) => message.t === "question_status")).toBe(false);

    now = 1_120;
    engine.tick(now);
    engine.handleClientMessage({
      t: "input",
      v: 2,
      sessionId: "session-1",
      phaseEpoch: epoch,
      seq: 1,
      x: 0.75,
      y: 0.25,
    }, phone as unknown as WebSocket);
    expect(display.sent.some((message) => message.t === "question_status")).toBe(true);
    engine.handleClientMessage({
      t: "reaction",
      v: 2,
      sessionId: "session-1",
      phaseEpoch: epoch,
      kind: "applause",
    }, phone as unknown as WebSocket);

    now = 1_140;
    engine.tick(now);
    expect(engine.currentPhaseId).toBe("video-question");
    expect(display.sent.find((message) => message.t === "question_resolved")).toMatchObject({
      resolvedTarget: "idle",
      freezeUntil: 1_150,
      winner: "fixed",
    });

    now = 1_400;
    engine.tick(now);
    expect(display.sent.filter((message) => message.t === "rating_status").at(-1)).toMatchObject({
      candidateLabel: "OpenApollo",
      applause: 1,
      boo: 0,
    });
    now = finishVideo(engine);
    expect(engine.currentPhaseId).toBe("idle");
  });

  it.each(["open", "skip"] as const)("keeps video vote buttons disabled until the engine opens the vote (%s)", (action) => {
    let now = 1_000;
    const { engine, registry } = setup({
      now: () => now,
      testScenario: compositeVideoQuestionScenario,
      groupSelection: { current: () => null, select: () => {}, method: () => "phone-buttons" },
    });
    const phone = new MockSocket();
    const display = new MockSocket();
    const socket = phone as unknown as WebSocket;
    addParticipant(registry, socket, now, "p1");
    engine.participantJoined(socket, registry.get("lease-p1"));
    connectDisplay(engine, display as unknown as WebSocket);
    const votingOptions = (client: MockSocket) => client.sent.filter((message) => message.t === "voting_options");

    now = 1_100;
    engine.tick(now);
    expect(votingOptions(phone).map((message) => message.closed)).toEqual([true]);

    const reconnected = new MockSocket();
    const replacementSocket = reconnected as unknown as WebSocket;
    engine.socketClosed(socket);
    now = action === "open" ? 1_120 : 1_119;
    addParticipant(registry, replacementSocket, now, "p1");
    engine.participantJoined(replacementSocket, registry.get("lease-p1"));
    expect(votingOptions(reconnected).map((message) => message.closed)).toEqual([true]);

    const vote = (outcome: string) => engine.handleClientMessage({
      t: "button_vote", v: 2, sessionId: "session-1", phaseEpoch: engine.currentPhaseEpoch, outcome,
    }, replacementSocket);
    vote("q1");
    if (action === "skip") {
      engine.adminSkip(now);
      expect(votingOptions(reconnected).map((message) => message.closed)).toEqual([true, true]);
      expect(display.sent.find((message) => message.t === "question_resolved")?.quadrantCounts).toMatchObject({ q1: 0 });
      return;
    }

    engine.tick(now);
    expect(votingOptions(reconnected).map((message) => message.closed)).toEqual([true, false]);
    vote("q2");
    now = 1_140;
    engine.tick(now);
    expect(votingOptions(reconnected).map((message) => message.closed)).toEqual([true, false, true]);
    expect(display.sent.find((message) => message.t === "question_resolved")?.quadrantCounts).toMatchObject({ q1: 0, q2: 1 });
  });

  it("ignores display video_ended: only the server clock ends a video", () => {
    let now = 1_000;
    const { engine, registry } = setup({ now: () => now });
    const phone = new MockSocket();
    const display = new MockSocket();
    const stranger = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now);
    const event = {
      t: "video_ended" as const,
      v: 2 as const,
      sessionId: "session-1",
      phaseId: "intro",
      phaseEpoch: engine.currentPhaseEpoch,
      mediaId: "intro.mp4",
    };

    engine.handleClientMessage(event, stranger as unknown as WebSocket);
    engine.handleClientMessage(event, display as unknown as WebSocket);
    expect(engine.currentPhaseId).toBe("intro");
    engine.tick(1_200);
    expect(engine.currentPhaseId).toBe("question");
  });

  it("tracks playback issues only for the authenticated display and current video", () => {
    let now = 1_000;
    const { engine, registry } = setup({ now: () => now });
    const phone = new MockSocket();
    const display = new MockSocket();
    const stranger = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now);
    const event = {
      t: "display_playback_status" as const,
      v: 2 as const,
      sessionId: "session-1",
      phaseId: "intro",
      phaseEpoch: engine.currentPhaseEpoch,
      mediaId: "intro.mp4",
      status: "stalled" as const,
      detail: "buffering stopped",
    };

    engine.handleClientMessage(event, stranger as unknown as WebSocket);
    expect(engine.currentDisplayPlaybackIssue).toBeNull();
    engine.handleClientMessage({ ...event, phaseEpoch: event.phaseEpoch - 1 }, display as unknown as WebSocket);
    engine.handleClientMessage({ ...event, mediaId: "other.mp4" }, display as unknown as WebSocket);
    expect(engine.currentDisplayPlaybackIssue).toBeNull();

    now = 1_125;
    engine.handleClientMessage(event, display as unknown as WebSocket);
    expect(engine.currentDisplayPlaybackIssue).toEqual({
      status: "stalled",
      mediaId: "intro.mp4",
      detail: "buffering stopped",
      reportedAt: 1_125,
    });

    engine.handleClientMessage({ ...event, status: "playing", detail: undefined }, display as unknown as WebSocket);
    expect(engine.currentDisplayPlaybackIssue).toBeNull();
  });

  it("clears a playback issue when the server leaves its video phase", () => {
    let now = 1_000;
    const { engine, registry } = setup({ now: () => now });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now);
    engine.handleClientMessage({
      t: "display_playback_status",
      v: 2,
      sessionId: "session-1",
      phaseId: "intro",
      phaseEpoch: engine.currentPhaseEpoch,
      mediaId: "intro.mp4",
      status: "error",
    }, display as unknown as WebSocket);
    expect(engine.currentDisplayPlaybackIssue?.status).toBe("error");

    now = finishVideo(engine);

    expect(engine.currentPhaseId).toBe("question");
    expect(engine.currentDisplayPlaybackIssue).toBeNull();
  });

  it("advances video at its expected duration exactly once", () => {
    let now = 1_000;
    const checkpoints: PhaseCheckpoint[] = [];
    const { engine, registry } = setup({ now: () => now, checkpoints });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now);
    expect(engine.getSnapshot().deadlineAt).toBe(1_200);

    engine.tick(1_199);
    expect(engine.currentPhaseId).toBe("intro");
    engine.tick(1_200);
    expect(engine.currentPhaseId).toBe("question");
    expect(checkpoints.at(-1)?.reason).toBe("video-complete");
    engine.tick(1_202);
    expect(engine.currentPhaseId).toBe("question");
  });

  it("re-anchors interactive idle after a long video phase", () => {
    let now = 1_000;
    const checkpoints: PhaseCheckpoint[] = [];
    const { engine, registry } = setup({
      now: () => now,
      checkpoints,
      interactiveIdleTimeoutMs: 180_000,
      maxSessionDurationMs: 1_000_000,
      testScenario: longVideoScenario,
    });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);

    now = 1_100;
    engine.tick(now);
    expect(engine.currentPhaseId).toBe("intro");

    now = 221_100;
    engine.tick(now);
    engine.tick(now + 1_000);

    expect(engine.lifecycleState).toBe("active");
    expect(engine.currentPhaseId).toBe("question");
    expect(checkpoints.at(-1)?.reason).toBe("video-complete");
  });

  it("keeps the lobby open without phone input", () => {
    let now = 1_000;
    const checkpoints: PhaseCheckpoint[] = [];
    const { engine, registry } = setup({
      now: () => now,
      checkpoints,
      lobbyCountdownMs: 1_000,
      interactiveIdleTimeoutMs: 50,
    });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);

    engine.tick(now + 51);

    expect(engine.lifecycleState).toBe("lobby");
    expect(checkpoints.at(-1)?.reason).toBe("lobby-start");
  });

  it("starts from the lobby even when the last participant disconnects", () => {
    let now = 1_000;
    const checkpoints: PhaseCheckpoint[] = [];
    const { engine, registry } = setup({ now: () => now, checkpoints });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);
    expect(engine.lifecycleState).toBe("lobby");

    now = 1_050;
    registry.releaseSocket(phone as unknown as WebSocket, now);
    engine.socketClosed(phone as unknown as WebSocket);

    expect(engine.lifecycleState).toBe("lobby");
    engine.tick(1_100);
    expect(engine.lifecycleState).toBe("active");
    expect(checkpoints.at(-1)?.reason).toBe("session-start");
  });

  it("emits one deadline event and checkpoints transitions", () => {
    let now = 1_000;
    const checkpoints: PhaseCheckpoint[] = [];
    const { engine, registry } = setup({ now: () => now, checkpoints });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now);
    now = finishVideo(engine);
    engine.recordInput(now + 250);
    now += 200;
    engine.tick(now);
    engine.tick(now + 100);
    expect(checkpoints.map((checkpoint) => checkpoint.reason)).toEqual([
      "lobby-start",
      "session-start",
      "video-complete",
      "question-freeze-complete",
    ]);
  });

  it("allows shows beyond thirty minutes and enforces the default three-hour limit", () => {
    const startedAt = 1_000;
    const checkpoints: PhaseCheckpoint[] = [];
    const engine = new PhaseEngine({
      scenario: scenarioSchema.parse({
        version: "long-show", entryPhaseId: "long-scene", phases: [
          { kind: "idle", id: "idle" },
          { kind: "narration", id: "long-scene", text: "Long performance", durationMs: 4 * 60 * 60 * 1000, next: "idle" },
        ],
      }),
      registry: new ParticipantRegistry(2),
      installationId: "inst-1", roomId: "room-1", showId: "show-1",
      displayToken: "display-secret", now: () => startedAt,
      onCheckpoint: checkpoint => checkpoints.push(checkpoint),
    });
    expect(engine.adminStart(startedAt)).toEqual({ ok: true });
    engine.tick(startedAt + 30 * 60 * 1000);
    expect(engine.lifecycleState).toBe("active");
    engine.tick(startedAt + 3 * 60 * 60 * 1000 - 1);
    expect(engine.lifecycleState).toBe("active");
    engine.tick(startedAt + 3 * 60 * 60 * 1000);
    expect(engine.lifecycleState).toBe("idle");
    expect(checkpoints.at(-1)?.reason).toBe("max-session-duration");
    engine.stop();
  });

  it("keeps interactive scenes running without input but enforces max duration", () => {
    const cases = [
      { label: "interactive-idle-timeout", trigger: (engine: PhaseEngine, now: number) => engine.tick(now + 100) },
      { label: "max-session-duration", trigger: (engine: PhaseEngine, now: number) => engine.tick(now + 100) },
    ] as const;

    for (const testCase of cases) {
      let now = 1_000;
      const checkpoints: PhaseCheckpoint[] = [];
      const { engine, registry } = setup({
        now: () => now,
        checkpoints,
        maxSessionDurationMs: testCase.label === "max-session-duration" ? 50 : 10_000,
      });
      const phone = new MockSocket();
      const display = new MockSocket();
      addParticipant(registry, phone as unknown as WebSocket, now, "p1");
      engine.participantJoined(phone as unknown as WebSocket);
      connectDisplay(engine, display as unknown as WebSocket);
      now = 1_100;
      engine.tick(now);
      now = finishVideo(engine);
      testCase.trigger(engine, now);
      expect(engine.lifecycleState, testCase.label).toBe(testCase.label === "max-session-duration" ? "idle" : "active");
      expect(checkpoints.at(-1)?.reason, testCase.label).toBe(testCase.label === "max-session-duration" ? testCase.label : "video-complete");
    }
  });

  it("keeps an active show running when every participant disconnects", () => {
    let now = 1_000;
    const checkpoints: PhaseCheckpoint[] = [];
    const { engine, registry } = setup({ now: () => now, checkpoints });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now);

    registry.releaseSocket(phone as unknown as WebSocket, now);
    engine.socketClosed(phone as unknown as WebSocket);
    now = finishVideo(engine);
    engine.tick(now + 100);

    expect(engine.lifecycleState).toBe("active");
    expect(engine.currentPhaseId).toBe("question");
    expect(checkpoints.at(-1)?.reason).toBe("video-complete");
    engine.tick(now + 200);
    engine.tick(now + 220);
    expect(engine.lifecycleState).toBe("idle");
    expect(checkpoints.at(-1)?.reason).toBe("question-freeze-complete");
  });

  it("recovers active state to idle and authenticates/replaces displays", () => {
    let now = 1_000;
    const checkpoints: PhaseCheckpoint[] = [];
    const { engine, registry } = setup({ now: () => now, checkpoints });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);
    for (const invalidToken of ["display-secrex", "wrong"]) {
      const invalid = new MockSocket();
      engine.handleClientMessage({
        t: "display_join",
        v: 2,
        clientVersion: "test",
        installationId: "inst-1",
        roomId: "room-1",
        displayToken: invalidToken,
      }, invalid as unknown as WebSocket);
      expect(invalid.closes[0]?.code).toBe(1008);
    }
    const replacement = new MockSocket();
    connectDisplay(engine, replacement as unknown as WebSocket);
    expect(display.closes[0]?.code).toBe(4002);
    now = 1_100;
    engine.tick(now);
    engine.recoverAfterCrash(now);
    expect(engine.lifecycleState).toBe("idle");
    expect(checkpoints.at(-2)?.kind).toBe("recovery");
  });

  it("applies admin start and idle controls across lifecycle states", () => {
    let now = 1_000;
    const checkpoints: PhaseCheckpoint[] = [];
    const { engine, registry } = setup({ now: () => now, checkpoints });

    expect(engine.adminStart(now)).toEqual({ ok: true });
    expect(engine.adminRestart(now)).toEqual({ ok: true });
    expect(engine.adminIdle(now)).toEqual({ ok: true });
    expect(engine.lifecycleState).toBe("idle");

    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);
    expect(engine.lifecycleState).toBe("lobby");

    now = 1_010;
    expect(engine.adminStart(now)).toEqual({ ok: true });
    expect(engine.lifecycleState).toBe("active");
    expect(engine.currentPhaseId).toBe("intro");
    expect(engine.adminStart(now)).toEqual({ ok: false, reason: "wrong-phase" });

    now = 1_020;
    expect(engine.adminIdle(now)).toEqual({ ok: true });
    expect(engine.lifecycleState).toBe("idle");
    expect(engine.currentPhaseId).toBe("idle");
    expect(checkpoints.at(-1)?.reason).toBe("admin-idle");
  });

  it("signals session end once when active play returns to idle", () => {
    let now = 1_000;
    const sessionEnds: Array<{ reason: string; sessionId: string; endedAt: number }> = [];
    const { engine, registry } = setup({ now: () => now, sessionEnds });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now);

    now = 1_125;
    expect(engine.adminIdle(now)).toEqual({ ok: true });
    expect(sessionEnds).toEqual([{ reason: "admin-idle", sessionId: "session-1", endedAt: 1_125 }]);

    engine.adminIdle(1_150);
    expect(sessionEnds).toHaveLength(1);
  });

  it("projects live cursor movement during the lobby without starting a movement recording", () => {
    const now = 1_000;
    const movementStarted: MovementRecordingStarted[] = [];
    const { engine, registry } = setup({ now: () => now, movementStarted });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    const participant = registry.get("lease-p1");
    if (participant === undefined) throw new Error("expected participant record");
    engine.participantJoined(phone as unknown as WebSocket, participant);
    connectDisplay(engine, display as unknown as WebSocket);
    expect(engine.lifecycleState).toBe("lobby");

    engine.handleClientMessage({
      t: "input",
      v: 2,
      sessionId: "lobby",
      phaseEpoch: engine.currentPhaseEpoch,
      seq: 0,
      x: 0.25,
      y: 0.75,
    }, phone as unknown as WebSocket);
    (engine as unknown as { cursors: { tick(): void } }).cursors.tick();

    expect(display.sent.filter((message) => message.t === "cursors").at(-1)).toMatchObject({
      cursors: [{ clientId: "p1", color: participant.color, x: 0.25, y: 0.75 }],
    });
    expect(movementStarted).toEqual([]);
  });

  it("replays stationary cursors after show starts, restarts, and lobby updates", () => {
    let now = 1_000;
    let sessionNumber = 0;
    const { engine, registry } = setup({ now: () => now, sessionIdFactory: () => `session-${++sessionNumber}` });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    const participant = registry.get("lease-p1");
    if (participant === undefined) throw new Error("expected participant record");
    engine.participantJoined(phone as unknown as WebSocket, participant);
    connectDisplay(engine, display as unknown as WebSocket);

    const cursors = (engine as unknown as { cursors: { tick(): void } }).cursors;
    cursors.tick();
    const roster = [{ clientId: "p1", color: participant.color, x: 0.5, y: 0.5 }];
    expect(display.sent.filter((message) => message.t === "cursors")).toEqual([
      expect.objectContaining({ cursors: roster }),
    ]);

    now = 1_100;
    engine.tick(now);
    cursors.tick();
    cursors.tick();

    expect(display.sent.filter((message) => message.t === "phase" || message.t === "cursors").slice(-2)).toEqual([
      expect.objectContaining({ t: "phase", sessionId: "session-1", phase: expect.objectContaining({ id: "intro" }) }),
      expect.objectContaining({ t: "cursors", cursors: roster }),
    ]);

    now = 1_150;
    expect(engine.adminRestart(now)).toEqual({ ok: true });
    cursors.tick();
    cursors.tick();

    expect(display.sent.filter((message) => message.t === "phase" || message.t === "cursors").slice(-2)).toEqual([
      expect.objectContaining({ t: "phase", sessionId: "session-2", phase: expect.objectContaining({ id: "intro" }) }),
      expect.objectContaining({ t: "cursors", cursors: roster }),
    ]);

    now = 1_175;
    engine.adminIdle(now);
    cursors.tick();
    engine.setLobbyStartTimes([2_000], now);
    cursors.tick();
    cursors.tick();

    expect(display.sent.filter((message) => message.t === "phase" || message.t === "cursors").slice(-2)).toEqual([
      expect.objectContaining({ t: "phase", sessionId: "lobby" }),
      expect.objectContaining({ t: "cursors", cursors: roster }),
    ]);

    engine.setLobbyStartTimes([3_000], now);
    cursors.tick();
    cursors.tick();

    expect(display.sent.filter((message) => message.t === "phase" || message.t === "cursors").slice(-2)).toEqual([
      expect.objectContaining({ t: "phase", sessionId: "lobby", phase: expect.objectContaining({ deadlineAt: 3_000 }) }),
      expect.objectContaining({ t: "cursors", cursors: roster }),
    ]);
  });

  it("resets the cursor sequence when a replacement socket rejoins before the old socket closes", () => {
    let now = 1_000;
    let snapshot: FinalVoteSnapshot | undefined;
    const { engine, registry } = setup({
      now: () => now,
      interactiveIdleTimeoutMs: 1_000,
      onVoteSnapshotEnqueued: (value) => { snapshot = value; },
    });
    const first = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, first as unknown as WebSocket, now, "p1");
    const participant = registry.get("lease-p1");
    if (participant === undefined) throw new Error("expected participant record");
    engine.participantJoined(first as unknown as WebSocket, participant);
    connectDisplay(engine, display as unknown as WebSocket);
    expect(engine.adminStart(now)).toEqual({ ok: true });

    const highSeq = engine.currentPhaseEpoch;
    engine.handleClientMessage({
      t: "input", v: 2, sessionId: "session-1", phaseEpoch: highSeq, seq: 50, x: 0.8, y: 0.2,
    }, first as unknown as WebSocket);
    (engine as unknown as { cursors: { tick(): void } }).cursors.tick();
    expect(display.sent.filter((message) => message.t === "cursors").at(-1)).toMatchObject({
      cursors: [{ clientId: "p1", color: participant.color, x: 0.8, y: 0.2 }],
    });

    const replacement = new MockSocket();
    const admission = registry.admit({
      participantLease: "lease-p1",
      clientId: "p1",
      name: "p1",
      leaseExpiresAt: now + 10_000,
      socket: replacement as unknown as WebSocket,
      now,
    });
    expect(admission.ok).toBe(true);
    engine.participantJoined(replacement as unknown as WebSocket, participant);
    registry.releaseSocket(first as unknown as WebSocket, now);
    engine.socketClosed(first as unknown as WebSocket);

    now = 1_100;
    now = finishVideo(engine);
    const questionEpoch = engine.currentPhaseEpoch;
    engine.handleClientMessage({
      t: "input", v: 2, sessionId: "session-1", phaseEpoch: questionEpoch, seq: 0, x: 0.1, y: 0.9,
    }, replacement as unknown as WebSocket);
    (engine as unknown as { cursors: { tick(): void } }).cursors.tick();

    expect(display.sent.filter((message) => message.t === "cursors").at(-1)).toMatchObject({
      cursors: [{ clientId: "p1", color: participant.color, x: 0.1, y: 0.9 }],
    });
    expect(engine.adminSkip(1_120)).toEqual({ ok: true });
    expect(snapshot?.votes).toEqual([
      expect.objectContaining({ participantId: "p1", x: 0.1, y: 0.9 }),
    ]);
  });

  it("replays ghost cursors alongside live ones, capped at max(0, targetAudienceSize - liveCount)", () => {
    let now = 1_000;
    const ghostPool: GhostPool = {
      tracks: [{ recordingId: "rec-a", samples: [{ t: 0, x: 0, y: 0 }, { t: 200, x: 1, y: 1 }] }],
    };
    const { engine, registry } = setup({
      now: () => now,
      testScenario: targetAudienceScenario(2),
      ghostPool,
    });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    const participant = registry.get("lease-p1");
    if (participant === undefined) throw new Error("expected participant record");
    engine.participantJoined(phone as unknown as WebSocket, participant);
    connectDisplay(engine, display as unknown as WebSocket);
    expect(engine.adminStart(now)).toEqual({ ok: true });

    (engine as unknown as { cursors: { tick(): void } }).cursors.tick();
    const cursors = display.sent.filter((message) => message.t === "cursors").at(-1)?.cursors;
    expect(cursors).toContainEqual(expect.objectContaining({ clientId: "ghost:rec-a", ghost: true }));
    expect(cursors).toHaveLength(2); // 1 live (default position) + 1 ghost, filling to targetAudienceSize 2
  });

  it("replays a stationary ghost-only roster to a reconnecting display", () => {
    const now = 1_000;
    const { engine } = setup({
      now: () => now,
      testScenario: targetAudienceScenario(1),
      ghostPool: { tracks: [{ recordingId: "rec-a", samples: [{ t: 0, x: 0.25, y: 0.75 }] }] },
    });
    const display = new MockSocket();
    connectDisplay(engine, display as unknown as WebSocket);
    expect(engine.adminStart(now)).toEqual({ ok: true });

    const cursors = (engine as unknown as { cursors: { tick(): void } }).cursors;
    cursors.tick();
    const roster = [expect.objectContaining({ clientId: "ghost:rec-a", x: 0.25, y: 0.75, ghost: true })];
    expect(display.sent.filter((message) => message.t === "cursors")).toEqual([
      expect.objectContaining({ tick: 0, cursors: roster }),
    ]);

    engine.socketClosed(display as unknown as WebSocket);
    const reconnectedDisplay = new MockSocket();
    connectDisplay(engine, reconnectedDisplay as unknown as WebSocket);
    cursors.tick();
    cursors.tick();

    expect(reconnectedDisplay.sent.filter((message) => message.t === "cursors")).toEqual([
      expect.objectContaining({ tick: 1, cursors: roster }),
    ]);
  });

  it("shows no ghosts once live participants already fill targetAudienceSize", () => {
    let now = 1_000;
    const ghostPool: GhostPool = {
      tracks: [{ recordingId: "rec-a", samples: [{ t: 0, x: 0, y: 0 }] }],
    };
    const { engine, registry } = setup({
      now: () => now,
      testScenario: targetAudienceScenario(1),
      ghostPool,
    });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    const participant = registry.get("lease-p1");
    if (participant === undefined) throw new Error("expected participant record");
    engine.participantJoined(phone as unknown as WebSocket, participant);
    connectDisplay(engine, display as unknown as WebSocket);
    expect(engine.adminStart(now)).toEqual({ ok: true });

    (engine as unknown as { cursors: { tick(): void } }).cursors.tick();
    const cursors = display.sent.filter((message) => message.t === "cursors").at(-1)?.cursors;
    expect(cursors?.some((c: { ghost?: boolean }) => c.ghost)).toBe(false);
  });

  it("clears ghosts once the session returns to idle", () => {
    let now = 1_000;
    const ghostPool: GhostPool = {
      tracks: [{ recordingId: "rec-a", samples: [{ t: 0, x: 0, y: 0 }] }],
    };
    const { engine, registry } = setup({
      now: () => now,
      testScenario: targetAudienceScenario(2),
      ghostPool,
      interactiveIdleTimeoutMs: 1_000,
    });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    const participant = registry.get("lease-p1");
    if (participant === undefined) throw new Error("expected participant record");
    engine.participantJoined(phone as unknown as WebSocket, participant);
    connectDisplay(engine, display as unknown as WebSocket);
    expect(engine.adminStart(now)).toEqual({ ok: true });
    (engine as unknown as { cursors: { tick(): void } }).cursors.tick();
    expect(display.sent.filter((message) => message.t === "cursors").at(-1)?.cursors)
      .toContainEqual(expect.objectContaining({ ghost: true }));

    now = 1_050;
    expect(engine.adminIdle(now)).toEqual({ ok: true });
    (engine as unknown as { cursors: { tick(): void } }).cursors.tick();
    expect(display.sent.filter((message) => message.t === "cursors").at(-1)?.cursors)
      .not.toContainEqual(expect.objectContaining({ ghost: true }));
  });

  it("records movement during a video phase, not just position-question phases", () => {
    let now = 1_000;
    const movementStarted: MovementRecordingStarted[] = [];
    const movementBatches: MovementBatchFlushed[] = [];
    const { engine, registry } = setup({ now: () => now, movementStarted, movementBatches });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
    connectDisplay(engine, display as unknown as WebSocket);
    expect(engine.adminStart(now)).toEqual({ ok: true });
    expect(engine.currentPhaseId).toBe("intro");

    const videoEpoch = engine.currentPhaseEpoch;
    engine.handleClientMessage({
      t: "input", v: 2, sessionId: "session-1", phaseEpoch: videoEpoch, seq: 0, x: 0.4, y: 0.6,
    }, phone as unknown as WebSocket);

    expect(movementStarted).toEqual([
      expect.objectContaining({ sessionId: "session-1", participantId: "p1", showId: "show-1", startedAt: now }),
    ]);
    engine.tick(now + 100);
    expect(movementBatches).toEqual([]);
  });

  it("finalizes every open movement recording as completed when the session ends", () => {
    let now = 1_000;
    const movementFinalized: MovementRecordingFinalized[] = [];
    const { engine, registry } = setup({ now: () => now, movementFinalized });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
    connectDisplay(engine, display as unknown as WebSocket);
    expect(engine.adminStart(now)).toEqual({ ok: true });

    const videoEpoch = engine.currentPhaseEpoch;
    engine.handleClientMessage({
      t: "input", v: 2, sessionId: "session-1", phaseEpoch: videoEpoch, seq: 0, x: 0.4, y: 0.6,
    }, phone as unknown as WebSocket);

    now = 1_050;
    expect(engine.adminIdle(now)).toEqual({ ok: true });
    expect(movementFinalized).toEqual([
      expect.objectContaining({ status: "completed", sampleCount: 1, endedAt: now }),
    ]);
  });

  it("finalizes a movement recording as abandoned when the participant's socket closes mid-session", () => {
    let now = 1_000;
    const movementFinalized: MovementRecordingFinalized[] = [];
    const { engine, registry } = setup({ now: () => now, movementFinalized });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
    connectDisplay(engine, display as unknown as WebSocket);
    expect(engine.adminStart(now)).toEqual({ ok: true });

    const videoEpoch = engine.currentPhaseEpoch;
    engine.handleClientMessage({
      t: "input", v: 2, sessionId: "session-1", phaseEpoch: videoEpoch, seq: 0, x: 0.4, y: 0.6,
    }, phone as unknown as WebSocket);

    now = 1_030;
    registry.releaseSocket(phone as unknown as WebSocket, now);
    engine.socketClosed(phone as unknown as WebSocket);
    expect(movementFinalized).toEqual([
      expect.objectContaining({ status: "abandoned", sampleCount: 1, endedAt: now }),
    ]);
  });

  it("skips video and question phases and safely restarts mid-video and mid-freeze", () => {
    let now = 1_000;
    const checkpoints: PhaseCheckpoint[] = [];
    const { engine, registry } = setup({
      now: () => now,
      checkpoints,
      interactiveIdleTimeoutMs: 1_000,
    });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
    connectDisplay(engine, display as unknown as WebSocket);

    now = 1_100;
    engine.tick(now);
    const firstVideoEpoch = engine.currentPhaseEpoch;
    expect(engine.adminRestart(now + 1)).toEqual({ ok: true });
    expect(engine.currentPhaseId).toBe("intro");
    expect(engine.currentPhaseEpoch).toBeGreaterThan(firstVideoEpoch);
    engine.tick(now + 100);
    expect(engine.currentPhaseId).toBe("intro");

    now = 1_110;
    expect(engine.adminSkip(now)).toEqual({ ok: true });
    expect(engine.currentPhaseId).toBe("question");
    const questionEpoch = engine.currentPhaseEpoch;

    now = 1_120;
    expect(engine.adminSkip(now)).toEqual({ ok: true });
    expect(engine.currentPhaseId).toBe("question");
    expect(display.sent.at(-1)).toMatchObject({
      t: "question_resolved",
      phaseEpoch: questionEpoch,
      freezeUntil: 1_140,
    });

    now = 1_130;
    expect(engine.adminRestart(now)).toEqual({ ok: true });
    expect(engine.currentPhaseId).toBe("intro");
    const restartedEpoch = engine.currentPhaseEpoch;
    engine.tick(1_140);
    expect(engine.currentPhaseId).toBe("intro");
    expect(engine.currentPhaseEpoch).toBe(restartedEpoch);
    expect(checkpoints.map((checkpoint) => checkpoint.reason)).toContain("admin-restart");
  });

  it("describes the complete operator flow and safely jumps to any active scene", () => {
    let now = 1_000;
    const checkpoints: PhaseCheckpoint[] = [];
    const { engine, registry } = setup({ now: () => now, checkpoints });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
    connectDisplay(engine, display as unknown as WebSocket);

    expect(engine.adminFlow).toEqual({
      entryPhaseId: "intro",
      scenes: [
        { id: "intro", kind: "video", title: "intro", routes: [{ outcome: "next", target: "question" }] },
        { id: "question", kind: "position-question", title: "Choose", routes: [{ outcome: "next", target: "idle" }] },
      ],
    });
    expect(engine.adminJump("question", now)).toEqual({ ok: false, reason: "wrong-phase" });
    expect(engine.adminStart(now)).toEqual({ ok: true });

    const introEpoch = engine.currentPhaseEpoch;
    now = 1_050;
    expect(engine.adminJump("question", now)).toEqual({ ok: true });
    expect(engine.currentPhaseId).toBe("question");
    expect(engine.currentPhaseEpoch).toBeGreaterThan(introEpoch);
    expect(engine.getSnapshot()).toMatchObject({ id: "question", startedAt: now, deadlineAt: now + 200 });
    expect(checkpoints.at(-1)?.reason).toBe("admin-jump");
    expect(engine.currentPhaseId).toBe("question");

    expect(engine.adminJump("idle", now + 1)).toEqual({ ok: false, reason: "invalid-target" });
    expect(engine.adminJump("missing", now + 1)).toEqual({ ok: false, reason: "invalid-target" });
    expect(engine.currentPhaseId).toBe("question");
  });

  it("includes every branch outcome in the operator flow", () => {
    const { engine } = setup({ now: () => 1_000, testScenario: twoQuadrantScenario });
    expect(engine.adminFlow.scenes.find((scene) => scene.id === "question")?.routes).toEqual([
      { outcome: "min", target: "idle" },
      { outcome: "max", target: "idle" },
      { outcome: "tie", target: "idle" },
      { outcome: "empty", target: "idle" },
    ]);
  });

  it("does not tell the lighting and sound bridges the show ended when the lobby opens or is rescheduled", () => {
    let now = 1_000;
    const cueEvents: Array<{ type: string; phaseId?: string }> = [];
    const { engine, registry } = setup({ now: () => now, interactiveIdleTimeoutMs: 1_000, cueEvents });
    const phone = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
    expect(engine.lifecycleState).toBe("lobby");
    expect(cueEvents.filter((event) => event.type === "reset")).toEqual([]);

    // Front of house moves the start while the audience waits in the lobby.
    const later = now + 600_000;
    expect(engine.setLobbyStartTimes([later], now)).toEqual({ ok: true });
    expect(engine.adjustLobbyStart(60_000, now)).toEqual({ ok: true });
    expect(engine.lifecycleState).toBe("lobby");
    expect(cueEvents.filter((event) => event.type === "reset")).toEqual([]);
    expect(engine.setLobbyStartTimes([], now)).toEqual({ ok: true });

    // Ending a running show still does.
    now = 1_100;
    expect(engine.adminStart(now)).toEqual({ ok: true });
    expect(engine.lifecycleState).toBe("active");
    expect(engine.adminIdle(now + 10)).toEqual({ ok: true });
    expect(cueEvents.filter((event) => event.type === "reset").map((event) => event.phaseId)).toEqual(["idle"]);
  });

  it("shows the result again on a display that reconnects during the freeze", () => {
    let now = 1_000;
    const cueEvents: Array<{ type: string }> = [];
    const { engine, registry } = setup({ now: () => now, interactiveIdleTimeoutMs: 1_000, cueEvents });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now);
    expect(engine.adminSkip(1_110)).toEqual({ ok: true });
    expect(engine.currentPhaseId).toBe("question");
    expect(engine.adminSkip(1_120)).toEqual({ ok: true });
    const original = display.sent.find((message) => message.t === "question_resolved");
    expect(original).toBeDefined();
    const results = cueEvents.filter((event) => event.type === "result").length;

    // The projector drops off Wi-Fi during the result freeze and joins again.
    const replacement = new MockSocket();
    connectDisplay(engine, replacement as unknown as WebSocket);
    expect(replacement.sent.find((message) => message.t === "question_resolved")).toEqual(original);
    expect(cueEvents.filter((event) => event.type === "result")).toHaveLength(results);

    // Once the next phase starts the old result is not replayed.
    expect(engine.adminSkip(1_130)).toEqual({ ok: true });
    const late = new MockSocket();
    connectDisplay(engine, late as unknown as WebSocket);
    expect(late.sent.some((message) => message.t === "question_resolved")).toBe(false);
  });

  it("advances immediately when skipping an already-resolved question", () => {
    let now = 1_000;
    const { engine, registry } = setup({ now: () => now, interactiveIdleTimeoutMs: 1_000 });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
    connectDisplay(engine, display as unknown as WebSocket);

    now = 1_100;
    engine.tick(now);
    expect(engine.adminSkip(1_110)).toEqual({ ok: true });
    expect(engine.currentPhaseId).toBe("question");

    expect(engine.adminSkip(1_120)).toEqual({ ok: true });
    expect(engine.currentPhaseId).toBe("question");
    expect(display.sent.filter((message) => message.t === "question_resolved")).toHaveLength(1);

    expect(engine.adminSkip(1_130)).toEqual({ ok: true });
    expect(engine.currentPhaseId).toBe("idle");
    expect(display.sent.filter((message) => message.t === "question_resolved")).toHaveLength(1);
  });

  it("finalizes once, enqueues before resolution, hides live counts, and holds through freeze", () => {
    let now = 1_000;
    const checkpoints: PhaseCheckpoint[] = [];
    let snapshot: FinalVoteSnapshot | undefined;
    const { engine, registry } = setup({
      now: () => now,
      checkpoints,
      interactiveIdleTimeoutMs: 1_000,
      onVoteSnapshotEnqueued: (value) => {
        snapshot = value;
        expect(engine.currentPhaseId).toBe("question");
      },
    });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now);
    now = finishVideo(engine);
    const questionEpoch = engine.currentPhaseEpoch;

    const status = display.sent.find((message) => message.t === "question_status");
    expect(status).toBeDefined();
    expect(status).not.toHaveProperty("quadrantCounts");
    engine.handleClientMessage({
      t: "input", v: 2, sessionId: "session-1", phaseEpoch: questionEpoch, seq: 1, x: 0.5, y: 0.5,
    }, phone as unknown as WebSocket);
    now = 1_400;
    engine.tick(now);

    const resolved = display.sent.find((message) => message.t === "question_resolved");
    expect(resolved).toMatchObject({
      sessionId: "session-1",
      phaseEpoch: questionEpoch,
      quadrantCounts: { q1: 0, q2: 0, q3: 0, q4: 1 },
      winner: "fixed",
      resolvedTarget: "idle",
      freezeUntil: 1_420,
    });
    expect(snapshot?.votes[0]).toMatchObject({ participantId: "p1", x: 0.5, y: 0.5 });
    expect(engine.currentPhaseId).toBe("question");

    now = 1_410;
    engine.handleClientMessage({
      t: "input", v: 2, sessionId: "session-1", phaseEpoch: questionEpoch, seq: 2, x: 0, y: 0,
    }, phone as unknown as WebSocket);
    expect(snapshot?.votes[0]?.x).toBe(0.5);
    engine.tick(1_419);
    expect(engine.currentPhaseId).toBe("question");
    engine.tick(1_420);
    expect(engine.currentPhaseId).toBe("idle");
  });

  it("includes live quadrant counts only for a question that enables them", () => {
    let now = 1_000;
    const { engine, registry } = setup({
      now: () => now,
      interactiveIdleTimeoutMs: 1_000,
      testScenario: liveCountsScenario,
    });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now);
    now = finishVideo(engine);
    const status = display.sent.find((message) => message.t === "question_status");
    expect(status).toMatchObject({ quadrantCounts: { q1: 0, q2: 0, q3: 0, q4: 0 } });
  });

  it("emits correlated two-quadrant status and resolution messages", () => {
    let now = 1_000;
    const { engine, registry } = setup({
      now: () => now,
      interactiveIdleTimeoutMs: 1_000,
      testScenario: twoQuadrantScenario,
    });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now);
    now = finishVideo(engine);
    const questionEpoch = engine.currentPhaseEpoch;

    engine.handleClientMessage({
      t: "input",
      v: 2,
      sessionId: "session-1",
      phaseEpoch: questionEpoch,
      seq: 1,
      x: 0.5,
      y: 0.2,
    }, phone as unknown as WebSocket);
    now = 1_450;
    engine.tick(now);

    expect(display.sent.filter((message) => message.t === "question_status").at(-1)).toMatchObject({
      t: "question_status",
      v: 2,
      field: {
        type: "two-quadrant",
        axis: "x",
        labels: { minLabel: "Disagree", maxLabel: "Agree" },
      },
      quadrantCounts: { min: 0, max: 1 },
    });
    expect(display.sent.find((message) => message.t === "question_resolved")).toMatchObject({
      t: "question_resolved",
      v: 2,
      field: {
        type: "two-quadrant",
        axis: "x",
        labels: { minLabel: "Disagree", maxLabel: "Agree" },
      },
      quadrantCounts: { min: 0, max: 1 },
      winner: "max",
      resolvedTarget: "idle",
    });
  });

  it("throttles question status broadcasts to four per second", () => {
    let now = 1_000;
    const { engine, registry } = setup({
      now: () => now,
      interactiveIdleTimeoutMs: 1_000,
      testScenario: liveCountsScenario,
    });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now);
    now = finishVideo(engine);
    const questionEpoch = engine.currentPhaseEpoch;
    const initialCount = display.sent.filter((message) => message.t === "question_status").length;

    for (let seq = 1; seq <= 10; seq += 1) {
      now += 10;
      engine.handleClientMessage({
        t: "input", v: 2, sessionId: "session-1", phaseEpoch: questionEpoch, seq, x: 0.5, y: 0.5,
      }, phone as unknown as WebSocket);
    }
    expect(display.sent.filter((message) => message.t === "question_status")).toHaveLength(initialCount);

    now = 1_450;
    engine.tick(now);
    expect(display.sent.filter((message) => message.t === "question_status")).toHaveLength(initialCount + 1);
  });

  it("tallies applause/boo reactions during a rating-enabled video and broadcasts a live rating_status", () => {
    let now = 1_000;
    const { engine, registry } = setup({ now: () => now, testScenario: ratingScenario });
    const phoneA = new MockSocket();
    const phoneB = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phoneA as unknown as WebSocket, now, "p1");
    addParticipant(registry, phoneB as unknown as WebSocket, now, "p2");
    engine.participantJoined(phoneA as unknown as WebSocket, registry.get("lease-p1"));
    engine.participantJoined(phoneB as unknown as WebSocket, registry.get("lease-p2"));
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now); // lobby countdown elapses, entering the rating-enabled "intro" video
    const introEpoch = engine.currentPhaseEpoch;

    // Rating begins the moment the video phase is entered.
    expect(display.sent.find((message) => message.t === "rating_status")).toMatchObject({
      candidateLabel: "OpenApollo", applause: 0, boo: 0,
    });

    for (const kind of ["applause", "applause", "boo"] as const) {
      engine.handleClientMessage({
        t: "reaction", v: 2, sessionId: "session-1", phaseEpoch: introEpoch, kind,
      }, phoneA as unknown as WebSocket);
    }
    // Unlimited taps: a second participant can tap repeatedly too, and votes accumulate.
    engine.handleClientMessage({
      t: "reaction", v: 2, sessionId: "session-1", phaseEpoch: introEpoch, kind: "applause",
    }, phoneB as unknown as WebSocket);

    now = 1_400; // past the broadcast throttle window so the dirty tally flushes
    engine.tick(now);
    expect(display.sent.filter((message) => message.t === "rating_status").at(-1)).toMatchObject({
      t: "rating_status", candidateLabel: "OpenApollo", applause: 3, boo: 1,
    });
  });

  it("ignores stale-epoch reactions and clears the tally once the video phase ends", () => {
    let now = 1_000;
    const { engine, registry } = setup({ now: () => now, testScenario: ratingScenario });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now); // lobby countdown elapses, entering the rating-enabled "intro" video
    const staleEpoch = engine.currentPhaseEpoch - 1;

    engine.handleClientMessage({
      t: "reaction", v: 2, sessionId: "session-1", phaseEpoch: staleEpoch, kind: "applause",
    }, phone as unknown as WebSocket);
    expect(display.sent.filter((message) => message.t === "rating_status")).toHaveLength(1); // only the initial 0/0

    now = finishVideo(engine);
    display.sent.length = 0;
    now += 50;
    engine.tick(now);
    expect(display.sent.some((message) => message.t === "rating_status")).toBe(false);
  });
});


const narrationScenario = scenarioSchema.parse({
  version: "engine-test-narration",
  entryPhaseId: "brief",
  cyclesAllowed: false,
  phases: [
    { kind: "idle", id: "idle" },
    { kind: "narration", id: "brief", text: "Listen carefully", durationMs: 100, next: "idle", allowSkip: true },
  ],
});

it("auto-advances a narration phase once its duration elapses", () => {
  let now = 1000;
  const { engine, registry } = setup({ now: () => now, testScenario: narrationScenario });
  const phone = new MockSocket();
  addParticipant(registry, phone as unknown as WebSocket, now, "p1");
  engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
  engine.adminStart(now);
  expect(engine.currentPhaseId).toBe("brief");
  now = 1050;
  engine.tick(now);
  expect(engine.currentPhaseId).toBe("brief");
  now = 1100;
  engine.tick(now);
  expect(engine.currentPhaseId).toBe("idle");
});

it("lets an operator skip a narration phase before its duration elapses", () => {
  let now = 1000;
  const { engine, registry } = setup({ now: () => now, testScenario: narrationScenario });
  const phone = new MockSocket();
  addParticipant(registry, phone as unknown as WebSocket, now, "p1");
  engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
  engine.adminStart(now);
  expect(engine.currentPhaseId).toBe("brief");
  expect(engine.adminSkip(now)).toEqual({ ok: true });
  expect(engine.currentPhaseId).toBe("idle");
});

it("announces a future synchronized start and moves the video end with it", () => {
  let now = 1000;
  const testScenario = scenarioSchema.parse({ ...scenario, phases: scenario.phases.map((p) => p.id === "intro" ? {
    ...p, phoneAudioMode: "synchronized", phoneAudioSrc: "voice.mp3", syncLeadMs: 3000, syncVideoOffsetMs: 200,
  } : p) });
  const { engine, registry } = setup({ now: () => now, testScenario });
  const phone = new MockSocket();
  addParticipant(registry, phone as unknown as WebSocket, now, "p1");
  engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p1"));
  engine.adminStart(now);
  expect(engine.getSnapshot()).toMatchObject({ id: "intro", startedAt: 4000, deadlineAt: 4300 });
  expect(phone.sent.filter((m) => m.t === "phase").at(-1)).toMatchObject({ serverTime: 1000, phase: { startedAt: 4000, phoneAudioMode: "synchronized" } });
  now = 4299; engine.tick(now);
  expect(engine.currentPhaseId).toBe("intro");
  now = 4300; engine.tick(now);
  expect(engine.currentPhaseId).toBe("question");
  engine.stop();
});

it("accepts timing only from current authenticated devices and invalidates it on cue changes", () => {
  let now = 1000;
  const { engine, registry } = setup({ now: () => now });
  const display = new MockSocket(), phone = new MockSocket(), stranger = new MockSocket();
  addParticipant(registry, phone as unknown as WebSocket, now, "p1"); engine.participantJoined(phone as unknown as WebSocket, registry.values()[0]);
  connectDisplay(engine, display as unknown as WebSocket); engine.adminStart(now);
  const timing = { calibrated: true, offsetMs: 25, roundTripMs: 10, sampleAgeMs: 0, elapsedMs: 50, mode: "display" as const, media: [] };
  const cue = { sessionId: engine.currentSessionId, phaseId: engine.currentPhaseId, phaseEpoch: engine.currentPhaseEpoch };
  const heartbeat = { t: "display_heartbeat" as const, v: 2 as const, ...cue, clientTime: now, timing };
  engine.handleClientMessage(heartbeat, stranger as unknown as WebSocket);
  expect(engine.timingMonitors[0]?.timing).toBeNull();
  engine.handleClientMessage(heartbeat, display as unknown as WebSocket);
  const ping = { t: "ping" as const, v: 2 as const, clientTime: now, timing: { ...cue, routingEpoch: 0, timing: { ...timing, mode: "synchronized" as const } } };
  engine.handleClientMessage(ping, stranger as unknown as WebSocket);
  expect(engine.timingMonitors.find((r) => r.kind === "phone")?.timing).toBeNull();
  engine.handleClientMessage(ping, phone as unknown as WebSocket);
  now += 300;
  expect(engine.timingMonitors[0]).toMatchObject({ timing, reportAgeMs: 300, connected: true });
  expect(engine.timingMonitors.find((r) => r.kind === "phone")?.timing?.mode).toBe("synchronized");
  engine.adminSkip(now);
  engine.handleClientMessage(heartbeat, display as unknown as WebSocket);
  engine.handleClientMessage(ping, phone as unknown as WebSocket);
  expect(engine.timingMonitors.every((r) => r.timing === null)).toBe(true);
  engine.socketClosed(display as unknown as WebSocket);
  expect(engine.timingMonitors[0]?.connected).toBe(false); engine.stop();
});


describe("authored stage monitor connections", () => {
  const join = (engine: PhaseEngine, socket: MockSocket, monitorId: "M1" | "M2" | "M3" | "M4", token = "display-secret") => engine.handleClientMessage({
    t: "display_join", v: 2, clientVersion: "test", installationId: "inst-1", roomId: "room-1", displayToken: token, monitorId,
  }, socket as unknown as WebSocket);
  it("keeps four monitors independent of the main display and restores elapsed time", () => {
    let now = 1000;
    const authored = scenarioSchema.parse({ ...scenario, phases: scenario.phases.map(phase => phase.id === "intro" ? { ...phase, monitorCues: { M1: [{ kind: "text", text: "Question", startMs: 0 }] } } : phase) });
    const { engine } = setup({ now: () => now, testScenario: authored });
    const main = new MockSocket();
    connectDisplay(engine, main as unknown as WebSocket);
    const screens = [new MockSocket(), new MockSocket(), new MockSocket(), new MockSocket()];
    screens.forEach((socket, i) => join(engine, socket, ["M1", "M2", "M3", "M4"][i] as "M1"));
    expect(main.closes).toEqual([]);
    expect(engine.adminStart(now).ok).toBe(true);
    for (const screen of screens) expect(screen.sent.filter(message => message.t === "phase").at(-1)?.phase).toMatchObject({ id: "intro", startedAt: 1000, monitorCues: { M1: [{ text: "Question" }] } });
    now = 1050;
    const replacement = new MockSocket();
    join(engine, replacement, "M2");
    expect(screens[1]!.closes).toHaveLength(1);
    expect(screens[0]!.closes).toHaveLength(0);
    expect(main.closes).toHaveLength(0);
    expect(replacement.sent.at(-1)).toMatchObject({ t: "snapshot", serverTime: 1050, phase: { startedAt: 1000 } });
    engine.tick(1100);
    expect(replacement.sent.filter(message => message.t === "phase").at(-1)?.phase.id).toBe("question");
  });
  it("rejects invalid credentials and mixed display roles", () => {
    const { engine } = setup({ now: () => 0 });
    const socket = new MockSocket();
    join(engine, socket, "M1", "wrong");
    expect(socket.sent).toEqual([]);
    expect(socket.closes[0]?.code).toBe(1008);
    const mixed = new MockSocket();
    engine.handleClientMessage({ t: "display_join", v: 2, clientVersion: "test", installationId: "inst-1", roomId: "room-1", displayToken: "display-secret", monitorId: "M1", groupId: "ki" }, mixed as unknown as WebSocket);
    expect(mixed.closes[0]?.code).toBe(1008);
  });
});

describe("native clients do not supply phone cursors", () => {
  it.each([false, true])("excludes native from display presence and vote cohort (late join: %s)", (late) => {
    let now = 1000;
    let snapshot: FinalVoteSnapshot | undefined;
    const { engine, registry } = setup({ now: () => now, interactiveIdleTimeoutMs: 1000, onVoteSnapshotEnqueued: s => { snapshot = s; } });
    const web = new MockSocket(); const native = new MockSocket(); const display = new MockSocket();
    connectDisplay(engine, display as unknown as WebSocket);
    addParticipant(registry, web as unknown as WebSocket, now, "web");
    engine.participantJoined(web as unknown as WebSocket, registry.get("lease-web"));
    const joinNative = () => {
      expect(registry.admit({ participantLease: "native-lease", clientId: "native", name: "App", client: "native", leaseExpiresAt: now + 10000, socket: native as unknown as WebSocket, now }).ok).toBe(true);
      engine.participantJoined(native as unknown as WebSocket, registry.get("native-lease"));
    };
    if (!late) joinNative();
    now = 1100; engine.tick(now); now = finishVideo(engine);
    if (late) joinNative();
    const epoch = engine.currentPhaseEpoch;
    engine.handleClientMessage({ t: "input", v: 2, sessionId: "session-1", phaseEpoch: epoch, seq: 1, x: .9, y: .9 }, native as unknown as WebSocket);
    engine.handleClientMessage({ t: "input", v: 2, sessionId: "session-1", phaseEpoch: epoch, seq: 1, x: .1, y: .1 }, web as unknown as WebSocket);
    expect(display.sent.filter(m => m.t === "presence").at(-1).count).toBe(1);
    expect(native.sent.some(m => m.t === "snapshot" || m.t === "phase")).toBe(true);
    expect(engine.connectedParticipantCount).toBe(2);
    now = 1400; engine.tick(now);
    expect(snapshot?.votes.map(v => v.participantId)).toEqual(["web"]);
  });
});


describe("vote result cue for lighting", () => {
  it("names the field the audience chose even when the next scene is fixed", () => {
    let now = 1000;
    const cueEvents: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const authored = scenarioSchema.parse({ ...scenario, phases: scenario.phases.map(phase => phase.id === "question" ? { ...phase, next: { type: "fixed", target: "idle" } } : phase) });
    const { engine, registry } = setup({ now: () => now, testScenario: authored, cueEvents });
    engine.startRehearsalAt("question", now);
    const phone = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p0");
    engine.participantJoined(phone as unknown as WebSocket, registry.get("lease-p0"));
    engine.handleClientMessage({ t: "input", v: 2, sessionId: "session-1", phaseEpoch: engine.currentPhaseEpoch, seq: 1, x: 0.9, y: 0.9 }, phone as unknown as WebSocket);
    now = 1200; engine.tick(now);
    const result = cueEvents.find((event) => event.type === "result");
    expect(result?.payload).toMatchObject({ winner: "fixed", leader: "q4" });
  });
});

describe("retained monitor vote results", () => {
  it.each(["winner", "tie", "empty"])("retains %s across scenes and reconnects, and resets on restart", (mode) => {
    let now = 1000;
    const authored = scenarioSchema.parse({ ...scenario, phases: [
      ...scenario.phases.map(phase => phase.id === "question" ? { ...phase, answerColors: { q4: "#e5484d" }, next: { type: "fixed", target: "after" } } : phase),
      { kind: "narration", id: "after", text: "Result", durationMs: 10000, next: "idle", monitorCues: { M1: [{ kind: "vote-result", fallbackText: "Tie or empty" }] } },
    ] });
    const { engine, registry } = setup({ now: () => now, testScenario: authored });
    engine.startRehearsalAt("question", now);
    if (mode !== "empty") {
      for (let i = 0; i < (mode === "tie" ? 2 : 1); i++) {
        const phone = new MockSocket();
        addParticipant(registry, phone as unknown as WebSocket, now, `p${i}`);
        engine.participantJoined(phone as unknown as WebSocket, registry.get(`lease-p${i}`));
        engine.handleClientMessage({ t: "input", v: 2, sessionId: "session-1", phaseEpoch: engine.currentPhaseEpoch, seq: 1, x: i ? 0.1 : 0.9, y: i ? 0.1 : 0.9 }, phone as unknown as WebSocket);
      }
    }
    now = 1200; engine.tick(now);
    now = 1220; engine.tick(now);
    expect(engine.currentPhaseId).toBe("after");
    const expected = mode === "winner" ? { label: "right / down", color: "#e5484d" } : { label: null };
    expect(engine.getSnapshot().monitorVoteResults?.question).toEqual(expected);
    expect(engine.getSnapshot().lastMonitorVotePhaseId).toBe("question");
    const display = new MockSocket();
    connectDisplay(engine, display as unknown as WebSocket);
    expect(display.sent.find(message => message.t === "snapshot")?.phase.monitorVoteResults.question).toEqual(expected);
    engine.adminRestart(now);
    expect(engine.getSnapshot().monitorVoteResults).toEqual({});
    expect(engine.getSnapshot().lastMonitorVotePhaseId).toBeUndefined();
  });
});

it("holds live spotlights through display reconnect without publishing a casting result", () => {
  let now = 1000;
  const votes: FinalVoteSnapshot[] = [];
  const cueEvents: Array<{ type: string }> = [];
  const question = scenario.phases.find(phase => phase.kind === "position-question")!;
  const spotlightScenario = scenarioSchema.parse({
    ...scenario,
    phases: [
      ...scenario.phases.map(phase => phase.id === "question" ? { ...phase, next: { type: "fixed", target: "spotlights" } } : phase),
      { ...question, id: "spotlights", spotlight: { diameterPercent: 24 }, durationMs: 1000, freezeMs: 2000 },
    ],
  });
  const { engine, registry } = setup({
    now: () => now, testScenario: spotlightScenario, interactiveIdleTimeoutMs: 10_000,
    onVoteSnapshotEnqueued: vote => votes.push(vote), cueEvents,
  });
  const phone = new MockSocket() as unknown as WebSocket;
  addParticipant(registry, phone, now, "p1");
  engine.participantJoined(phone, registry.get("lease-p1"));
  engine.startRehearsalAt("question", now);
  expect(engine.adminJump("spotlights", now)).toMatchObject({ ok: true });
  const display = new MockSocket();
  connectDisplay(engine, display as unknown as WebSocket);
  expect(display.sent.find(message => message.t === "snapshot")?.phase).toMatchObject({
    spotlight: { diameterPercent: 24 }, spotlightGrow: true, deadlineAt: 2000,
  });
  const move = (seq: number, x: number) => engine.handleClientMessage({
    t: "input", v: 2, sessionId: engine.currentSessionId, phaseEpoch: engine.currentPhaseEpoch, seq, x, y: 0.35,
  }, phone);
  now = 1999;
  move(1, 0.72);
  now = 2000;
  move(2, 0.9);
  engine.tick(now);
  engine.socketClosed(phone);
  now = 3000;
  const replacement = new MockSocket();
  connectDisplay(engine, replacement as unknown as WebSocket);
  expect(replacement.sent.find(message => message.t === "cursors")?.cursors).toMatchObject([
    { clientId: "p1", x: 0.72, y: 0.35 },
  ]);
  expect([...display.sent, ...replacement.sent].some(message => message.t === "question_resolved")).toBe(false);
  expect(votes).toEqual([]);
  expect(cueEvents.some(event => event.type === "result")).toBe(false);
  now = 3999;
  engine.tick(now);
  expect(engine.currentPhaseId).toBe("spotlights");
  now = 4000;
  engine.tick(now);
  expect(engine.currentPhaseId).toBe("idle");
});
