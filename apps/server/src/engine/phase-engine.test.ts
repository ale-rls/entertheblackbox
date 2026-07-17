import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { scenarioSchema } from "@smartphonecracy/scenario";
import type { WebSocket } from "ws";
import { ParticipantRegistry } from "../admission/index.js";
import { PhaseEngine, type PhaseCheckpoint } from "./phase-engine.js";
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
  checkpoints?: PhaseCheckpoint[];
  lobbyCountdownMs?: number;
  interactiveIdleTimeoutMs?: number;
  maxSessionDurationMs?: number;
  testScenario?: typeof scenario;
  onVoteSnapshotEnqueued?: (snapshot: FinalVoteSnapshot) => void;
  sessionEnds?: Array<{ reason: string; endedAt: number }>;
  qr?: boolean;
} ) {
  const registry = new ParticipantRegistry(2, 50);
  const checkpoints = options.checkpoints ?? [];
  const engine = new PhaseEngine({
    scenario: options.testScenario ?? scenario,
    registry,
    installationId: "inst-1",
    roomId: "room-1",
    displayToken: "display-secret",
    now: options.now,
    sessionIdFactory: () => "session-1",
    policy: {
      lobbyCountdownMs: options.lobbyCountdownMs ?? 100,
      interactiveIdleTimeoutMs: options.interactiveIdleTimeoutMs ?? 100,
      maxSessionDurationMs: options.maxSessionDurationMs ?? 10_000,
      displayDisconnectTimeoutMs: 100,
      noParticipantGraceMs: 100,
    },
    onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
    ...(options.sessionEnds === undefined
      ? {}
      : { onSessionEnded: (event: { reason: string; endedAt: number }) => options.sessionEnds!.push(event) }),
    ...(options.onVoteSnapshotEnqueued === undefined
      ? {}
      : { onVoteSnapshotEnqueued: options.onVoteSnapshotEnqueued }),
    ...(options.qr
      ? {
          qr: {
            phoneJoinBaseUrl: "https://phone.example/join",
            issueGrant: (issuedAt: number) => ({
              token: `grant-${issuedAt}`,
              claims: { installationId: "inst-1", roomId: "room-1", expiresAt: issuedAt + 120_000 },
            }),
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

const twoQuadrantScenario = scenarioSchema.parse({
  ...scenario,
  version: "engine-test-two-quadrant",
  phases: scenario.phases.map((phase) => phase.kind === "position-question"
    ? {
        ...phase,
        field: {
          type: "two-quadrant",
          axis: "x",
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

describe("PhaseEngine lifecycle", () => {
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
    expect(joinUrl.searchParams.get("installation")).toBe("inst-1");
    expect(joinUrl.searchParams.get("room")).toBe("room-1");

    engine.handleClientMessage({ t: "qr_grant_request", v: 2 }, display as unknown as WebSocket);
    expect(display.sent.filter((message) => message.t === "qr_grant")).toHaveLength(2);

    const stranger = new MockSocket();
    engine.handleClientMessage({ t: "qr_grant_request", v: 2 }, stranger as unknown as WebSocket);
    expect(stranger.sent).toEqual([]);
  });

  it("keeps phones in idle until a healthy display joins, then runs the lobby", () => {
    let now = 1_000;
    const { engine, registry } = setup({ now: () => now });
    const phone = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    expect(engine.lifecycleState).toBe("idle");

    const display = new MockSocket();
    connectDisplay(engine, display as unknown as WebSocket);
    expect(engine.lifecycleState).toBe("lobby");
    expect(engine.currentPhaseId).toBe("idle");
    now = 1_100;
    engine.tick(now);
    expect(engine.lifecycleState).toBe("active");
    expect(engine.currentSessionId).toBe("session-1");
    expect(engine.currentPhaseId).toBe("intro");
  });

  it("rejects stale video events and transitions only on the current epoch", () => {
    let now = 1_000;
    const { engine, registry } = setup({ now: () => now });
    const phone = new MockSocket();
    const display = new MockSocket();
    addParticipant(registry, phone as unknown as WebSocket, now, "p1");
    engine.participantJoined(phone as unknown as WebSocket);
    connectDisplay(engine, display as unknown as WebSocket);
    now = 1_100;
    engine.tick(now);
    const epoch = engine.currentPhaseEpoch;
    expect(engine.completeVideo("session-1", "intro", epoch - 1, now)).toEqual({ ok: false, reason: "stale" });
    expect(engine.completeVideo("session-1", "intro", epoch, now)).toEqual({ ok: true });
    expect(engine.currentPhaseId).toBe("question");
  });

  it("accepts video_ended only from the authenticated display and cannot double-advance", () => {
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
    expect(engine.currentPhaseId).toBe("intro");
    engine.handleClientMessage(event, display as unknown as WebSocket);
    expect(engine.currentPhaseId).toBe("question");
    engine.handleClientMessage(event, display as unknown as WebSocket);
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

    engine.completeVideo("session-1", "intro", engine.currentPhaseEpoch, now);

    expect(engine.currentPhaseId).toBe("question");
    expect(engine.currentDisplayPlaybackIssue).toBeNull();
  });

  it("advances video at expected duration plus five seconds when no event arrives", () => {
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
    const epoch = engine.currentPhaseEpoch;
    expect(engine.getSnapshot().deadlineAt).toBe(6_200);

    engine.tick(6_199);
    expect(engine.currentPhaseId).toBe("intro");
    engine.tick(6_200);
    expect(engine.currentPhaseId).toBe("question");
    expect(checkpoints.at(-1)?.reason).toBe("video-fallback");
    expect(engine.completeVideo("session-1", "intro", epoch, 6_201)).toEqual({ ok: false, reason: "wrong-phase" });
    engine.tick(6_202);
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
    expect(engine.completeVideo("session-1", "intro", engine.currentPhaseEpoch, now)).toEqual({ ok: true });
    engine.tick(now + 1_000);

    expect(engine.lifecycleState).toBe("active");
    expect(engine.currentPhaseId).toBe("question");
    expect(checkpoints.at(-1)?.reason).toBe("video-complete");
  });

  it("enforces interactive idle during the lobby", () => {
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

    expect(engine.lifecycleState).toBe("idle");
    expect(checkpoints.at(-1)?.reason).toBe("interactive-idle-timeout");
  });

  it("cancels the lobby when the last participant disconnects", () => {
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

    expect(engine.lifecycleState).toBe("idle");
    expect(engine.currentSessionId).toBe("idle");
    expect(checkpoints.at(-1)?.reason).toBe("lobby-empty");
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
    engine.completeVideo("session-1", "intro", engine.currentPhaseEpoch, now);
    engine.recordInput(1_350);
    now = 1_300;
    engine.tick(now);
    engine.tick(1_400);
    expect(checkpoints.map((checkpoint) => checkpoint.reason)).toEqual([
      "lobby-start",
      "session-start",
      "video-complete",
      "question-freeze-complete",
    ]);
  });

  it("aborts to idle on interactive inactivity, max duration, no participants, and display loss", () => {
    const cases = [
      { label: "interactive-idle-timeout", trigger: (engine: PhaseEngine, now: number) => engine.tick(now + 100) },
      { label: "max-session-duration", trigger: (engine: PhaseEngine, now: number) => engine.tick(now + 100) },
      { label: "no-participants", trigger: (engine: PhaseEngine, now: number) => engine.tick(now + 100) },
      { label: "display-timeout", trigger: (engine: PhaseEngine, now: number) => engine.tick(now + 100) },
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
      engine.completeVideo("session-1", "intro", engine.currentPhaseEpoch, now);
      if (testCase.label === "no-participants") {
        registry.releaseSocket(phone as unknown as WebSocket, now);
        engine.socketClosed(phone as unknown as WebSocket);
      }
      if (testCase.label === "display-timeout") engine.socketClosed(display as unknown as WebSocket);
      if (testCase.label === "no-participants") {
        engine.tick(now + 1);
        engine.tick(now + 101);
      } else {
        testCase.trigger(engine, now);
      }
      expect(engine.lifecycleState, testCase.label).toBe("idle");
      expect(checkpoints.at(-1)?.reason, testCase.label).toBe(testCase.label);
    }
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

    expect(engine.adminStart(now)).toEqual({ ok: false, reason: "wrong-phase" });
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
    const sessionEnds: Array<{ reason: string; endedAt: number }> = [];
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
    expect(sessionEnds).toEqual([{ reason: "admin-idle", endedAt: 1_125 }]);

    engine.adminIdle(1_150);
    expect(sessionEnds).toHaveLength(1);
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
    expect(engine.completeVideo("session-1", "intro", firstVideoEpoch, now + 2)).toEqual({
      ok: false,
      reason: "stale",
    });

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
    engine.completeVideo("session-1", "intro", engine.currentPhaseEpoch, now);
    const questionEpoch = engine.currentPhaseEpoch;

    const status = display.sent.find((message) => message.t === "question_status");
    expect(status).toBeDefined();
    expect(status).not.toHaveProperty("quadrantCounts");
    engine.handleClientMessage({
      t: "input", v: 2, sessionId: "session-1", phaseEpoch: questionEpoch, seq: 1, x: 0.5, y: 0.5,
    }, phone as unknown as WebSocket);
    now = 1_300;
    engine.tick(now);

    const resolved = display.sent.find((message) => message.t === "question_resolved");
    expect(resolved).toMatchObject({
      sessionId: "session-1",
      phaseEpoch: questionEpoch,
      quadrantCounts: { q1: 0, q2: 0, q3: 0, q4: 1 },
      winner: "fixed",
      resolvedTarget: "idle",
      freezeUntil: 1_320,
    });
    expect(snapshot?.votes[0]).toMatchObject({ participantId: "p1", x: 0.5, y: 0.5 });
    expect(engine.currentPhaseId).toBe("question");

    now = 1_310;
    engine.handleClientMessage({
      t: "input", v: 2, sessionId: "session-1", phaseEpoch: questionEpoch, seq: 2, x: 0, y: 0,
    }, phone as unknown as WebSocket);
    expect(snapshot?.votes[0]?.x).toBe(0.5);
    engine.tick(1_319);
    expect(engine.currentPhaseId).toBe("question");
    engine.tick(1_320);
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
    engine.completeVideo("session-1", "intro", engine.currentPhaseEpoch, now);
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
    engine.completeVideo("session-1", "intro", engine.currentPhaseEpoch, now);
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
    now = 1_350;
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
    engine.completeVideo("session-1", "intro", engine.currentPhaseEpoch, now);
    const questionEpoch = engine.currentPhaseEpoch;
    const initialCount = display.sent.filter((message) => message.t === "question_status").length;

    for (let seq = 1; seq <= 10; seq += 1) {
      now += 10;
      engine.handleClientMessage({
        t: "input", v: 2, sessionId: "session-1", phaseEpoch: questionEpoch, seq, x: 0.5, y: 0.5,
      }, phone as unknown as WebSocket);
    }
    expect(display.sent.filter((message) => message.t === "question_status")).toHaveLength(initialCount);

    now = 1_350;
    engine.tick(now);
    expect(display.sent.filter((message) => message.t === "question_status")).toHaveLength(initialCount + 1);
  });
});
