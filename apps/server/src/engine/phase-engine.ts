import {
  encodeMessage,
  PROTOCOL_VERSION,
  type ClientToServerMessage,
  type PhaseSnapshotMessage,
  type ServerToClientMessage,
} from "@smartphonecracy/protocol";
import type { Scenario, Phase } from "@smartphonecracy/scenario";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import type { ParticipantRecord, ParticipantRegistry } from "../admission/index.js";
import { QrGrantPushLoop, type QrGrantPushLoopOptions } from "../admission/qr.js";
import { CursorPipeline } from "../cursors/index.js";
import {
  VoteEngine,
  type FinalVoteSnapshot,
  type LiveQuestionStatus,
  type VoteParticipantSeed,
  type VoteResolution,
} from "../votes/index.js";
import { VideoPhaseHandler } from "./video.js";

export type EngineLifecycle = "idle" | "lobby" | "active";

export type PhaseEnginePolicy = {
  lobbyCountdownMs: number;
  interactiveIdleTimeoutMs: number;
  maxSessionDurationMs: number;
  displayDisconnectTimeoutMs: number;
  noParticipantGraceMs: number;
};

export const DEFAULT_PHASE_ENGINE_POLICY: PhaseEnginePolicy = {
  lobbyCountdownMs: 10_000,
  interactiveIdleTimeoutMs: 180_000,
  maxSessionDurationMs: 1_800_000,
  displayDisconnectTimeoutMs: 30_000,
  noParticipantGraceMs: 120_000,
};

const QUESTION_STATUS_INTERVAL_MS = 250;

export type PhaseCheckpoint = {
  kind: "transition" | "recovery";
  reason: string;
  sessionId: string;
  phaseId: string;
  phaseEpoch: number;
  startedAt: number;
  deadlineAt: number | null;
};

export type PhaseDeadlineEvent = {
  sessionId: string;
  phaseId: string;
  phaseEpoch: number;
  phase: Phase;
  deadlineAt: number;
};

export type PhaseEngineOptions = {
  scenario: Scenario;
  registry: ParticipantRegistry;
  installationId: string;
  roomId: string;
  displayToken: string;
  policy?: Partial<PhaseEnginePolicy>;
  now?: () => number;
  sessionIdFactory?: () => string;
  onCheckpoint?: (checkpoint: PhaseCheckpoint) => void;
  onPhaseDeadline?: (event: PhaseDeadlineEvent) => void;
  onVoteSnapshotEnqueued?: (snapshot: FinalVoteSnapshot) => void;
  qr?: Omit<QrGrantPushLoopOptions, "send" | "lifecycle" | "hasDisplay" | "now">;
};

export type TransitionResult = { ok: true } | { ok: false; reason: "stale" | "invalid-target" | "wrong-phase" };

function isOpen(socket: WebSocket): boolean {
  return socket.readyState === undefined || socket.readyState === 0 || socket.readyState === 1;
}

type FourVoteResolution = Extract<VoteResolution, { field: { type: "four-quadrant" } }>;
type FourLiveQuestionStatus = Extract<LiveQuestionStatus, { field: { type: "four-quadrant" } }>;

function isFourVoteResolution(resolution: VoteResolution): resolution is FourVoteResolution {
  return resolution.field.type === "four-quadrant";
}

function isFourLiveQuestionStatus(status: LiveQuestionStatus): status is FourLiveQuestionStatus {
  return status.field.type === "four-quadrant";
}

export class PhaseEngine {
  private readonly scenario: Scenario;
  private readonly registry: ParticipantRegistry;
  private readonly installationId: string;
  private readonly roomId: string;
  private readonly displayToken: string;
  private readonly policy: PhaseEnginePolicy;
  private readonly now: () => number;
  private readonly sessionIdFactory: () => string;
  private readonly onCheckpoint: ((checkpoint: PhaseCheckpoint) => void) | undefined;
  private readonly onPhaseDeadline: ((event: PhaseDeadlineEvent) => void) | undefined;
  private readonly votes: VoteEngine;
  private readonly cursors: CursorPipeline;
  private readonly video = new VideoPhaseHandler();
  private readonly qr: QrGrantPushLoop | null;
  private readonly clients = new Set<WebSocket>();
  private readonly participantSockets = new Set<WebSocket>();

  private lifecycle: EngineLifecycle = "idle";
  private phaseId = "idle";
  private sessionId = "idle";
  private phaseEpoch = 0;
  private phaseStartedAt: number;
  private deadlineAt: number | null = null;
  private sessionStartedAt: number | null = null;
  private lastInputAt: number | null = null;
  private noParticipantSince: number | null = null;
  private displayDisconnectedAt: number | null = null;
  private displayHeartbeatAt: number | null = null;
  private deadlineNotified = false;
  private displaySocket: WebSocket | undefined;
  private readonly participantIds = new Map<WebSocket, string>();
  private questionFreezeUntil: number | null = null;
  private questionResolutionTarget: string | null = null;
  private questionStatusDirty = false;
  private lastQuestionStatusAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: PhaseEngineOptions) {
    this.scenario = options.scenario;
    this.registry = options.registry;
    this.installationId = options.installationId;
    this.roomId = options.roomId;
    this.displayToken = options.displayToken;
    this.policy = { ...DEFAULT_PHASE_ENGINE_POLICY, ...options.policy };
    this.now = options.now ?? (() => Date.now());
    this.sessionIdFactory = options.sessionIdFactory ?? (() => `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    this.onCheckpoint = options.onCheckpoint;
    this.onPhaseDeadline = options.onPhaseDeadline;
    this.votes = options.onVoteSnapshotEnqueued === undefined
      ? new VoteEngine()
      : new VoteEngine({ onSnapshotEnqueued: options.onVoteSnapshotEnqueued });
    this.cursors = new CursorPipeline({
      sendCursors: (message) => this.sendToDisplay(message),
      sendPresence: (message) => this.broadcast(message),
    });
    this.qr = options.qr === undefined ? null : new QrGrantPushLoop({
      ...options.qr,
      send: (message) => this.sendToDisplay(message),
      lifecycle: () => this.lifecycle,
      hasDisplay: () => this.displaySocket !== undefined,
      now: this.now,
    });
    this.phaseStartedAt = this.now();
    this.requirePhase("idle");
  }

  get lifecycleState(): EngineLifecycle {
    return this.lifecycle;
  }

  get currentPhaseId(): string {
    return this.phaseId;
  }

  get currentSessionId(): string {
    return this.sessionId;
  }

  get currentPhaseEpoch(): number {
    return this.phaseEpoch;
  }

  get isDisplayConnected(): boolean {
    return this.displaySocket !== undefined;
  }

  get displayHeartbeatAgeMs(): number | null {
    return this.displaySocket === undefined || this.displayHeartbeatAt === null
      ? null
      : Math.max(0, this.now() - this.displayHeartbeatAt);
  }

  adminStart(now = this.now()): TransitionResult {
    if (this.lifecycle === "active" || this.displaySocket === undefined || this.registry.connectedCount < 1) {
      return { ok: false, reason: "wrong-phase" };
    }
    this.startSession(now);
    return { ok: true };
  }

  adminIdle(now = this.now()): TransitionResult {
    this.abortToIdle("admin-idle", now);
    return { ok: true };
  }

  adminSkip(now = this.now()): TransitionResult {
    if (this.lifecycle !== "active") return { ok: false, reason: "wrong-phase" };
    const phase = this.currentPhase();
    if (phase.kind === "video") return this.advanceTo(phase.next, now, "admin-skip");
    if (phase.kind === "position-question") {
      this.resolveQuestionAtDeadline(now, phase);
      return { ok: true };
    }
    return { ok: false, reason: "wrong-phase" };
  }

  adminRestart(now = this.now()): TransitionResult {
    if (this.lifecycle !== "active") return { ok: false, reason: "wrong-phase" };
    this.sessionId = this.sessionIdFactory();
    this.sessionStartedAt = now;
    this.enterPhase(this.scenario.entryPhaseId, now, "admin-restart");
    return { ok: true };
  }

  get connectedParticipantCount(): number {
    return this.registry.connectedCount;
  }

  getSnapshot(now = this.now()): PhaseSnapshotMessage {
    const phase = this.currentPhase();
    return {
      ...phase,
      scenarioVersion: this.scenario.version,
      startedAt: this.phaseStartedAt,
      deadlineAt: this.deadlineAt,
    };
  }

  getSnapshotMessage(now = this.now()): Extract<ServerToClientMessage, { t: "snapshot" }> {
    return {
      t: "snapshot",
      v: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      phaseEpoch: this.phaseEpoch,
      phase: this.getSnapshot(now),
      serverTime: now,
    };
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), 250);
    this.cursors.start();
    this.qr?.start();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.cursors.stop();
    this.qr?.stop();
  }

  tick(now = this.now()): void {
    if (this.lifecycle === "idle") return;

    if (this.displaySocket === undefined) {
      this.displayDisconnectedAt ??= now;
      if (now - this.displayDisconnectedAt >= this.policy.displayDisconnectTimeoutMs) {
        this.abortToIdle("display-timeout", now);
        return;
      }
    } else {
      this.displayDisconnectedAt = null;
    }

    if (this.registry.connectedCount === 0) {
      this.noParticipantSince ??= now;
      if (now - this.noParticipantSince >= this.policy.noParticipantGraceMs) {
        this.abortToIdle("no-participants", now);
        return;
      }
    } else {
      this.noParticipantSince = null;
    }

    if (this.lifecycle === "lobby") {
      if (this.deadlineAt !== null && now >= this.deadlineAt) {
        if (this.displaySocket !== undefined && this.registry.connectedCount > 0) {
          this.startSession(now);
        } else {
          this.abortToIdle("lobby-precondition-lost", now);
        }
      }
      if (this.lifecycle === "lobby" && this.interactiveIdleTimedOut(now)) {
        this.abortToIdle("interactive-idle-timeout", now);
        return;
      }
      if (this.lifecycle === "lobby") return;
    }

    if (this.sessionStartedAt !== null && now - this.sessionStartedAt >= this.policy.maxSessionDurationMs) {
      this.abortToIdle("max-session-duration", now);
      return;
    }

    const phase = this.currentPhase();

    if (phase.kind === "video") {
      const fallback = this.video.consumeFallback(now);
      if (fallback !== null && this.matches(fallback.sessionId, fallback.phaseId, fallback.phaseEpoch)) {
        this.onPhaseDeadline?.({
          sessionId: this.sessionId,
          phaseId: this.phaseId,
          phaseEpoch: this.phaseEpoch,
          phase,
          deadlineAt: this.deadlineAt!,
        });
        this.advanceTo(phase.next, now, "video-fallback");
      }
      return;
    }

    if (phase.kind === "position-question") this.broadcastQuestionStatus(now);

    if (phase.kind === "position-question" && this.questionFreezeUntil !== null) {
      if (now < this.questionFreezeUntil) return;
      const target = this.questionResolutionTarget;
      this.questionFreezeUntil = null;
      this.questionResolutionTarget = null;
      if (target !== null) this.advanceTo(target, now, "question-freeze-complete");
      return;
    }

    if (this.interactiveIdleTimedOut(now)) {
      this.abortToIdle("interactive-idle-timeout", now);
      return;
    }

    if (this.deadlineAt !== null && now >= this.deadlineAt && !this.deadlineNotified) {
      this.deadlineNotified = true;
      if (phase.kind === "position-question") this.resolveQuestionAtDeadline(now, phase);
      this.onPhaseDeadline?.({
        sessionId: this.sessionId,
        phaseId: this.phaseId,
        phaseEpoch: this.phaseEpoch,
        phase,
        deadlineAt: this.deadlineAt,
      });
    }
  }

  participantJoined(socket: WebSocket, _participant?: ParticipantRecord): void {
    this.clients.add(socket);
    this.participantSockets.add(socket);
    if (_participant !== undefined) {
      this.participantIds.set(socket, _participant.clientId);
      this.cursors.join(_participant.clientId, _participant.color);
      this.votes.addParticipant({
        participantId: _participant.clientId,
        connected: true,
        lastHeartbeatAt: _participant.lastSeenAt,
      }, this.now());
    }
    this.send(socket, this.getSnapshotMessage());
    this.queueQuestionStatus();
    if (this.lifecycle === "idle" && this.displaySocket !== undefined && this.registry.connectedCount >= 1) {
      this.startLobby(this.now());
    }
  }

  socketClosed(socket: WebSocket): void {
    this.clients.delete(socket);
    this.participantSockets.delete(socket);
    const participantId = this.participantIds.get(socket);
    if (participantId !== undefined) {
      this.participantIds.delete(socket);
      if (![...this.participantIds.values()].includes(participantId)) {
        this.votes.setConnected(participantId, false, this.now());
        this.cursors.leave(participantId);
      }
      this.queueQuestionStatus();
    }
    if (this.displaySocket === socket) {
      this.displaySocket = undefined;
      this.displayDisconnectedAt = this.now();
      this.displayHeartbeatAt = null;
    }
    if (this.lifecycle === "lobby" && this.registry.connectedCount === 0) {
      this.abortToIdle("lobby-empty", this.now());
    }
  }

  handleClientMessage(message: ClientToServerMessage, socket: WebSocket, _request?: IncomingMessage): void {
    switch (message.t) {
      case "display_join":
        if (
          message.installationId !== this.installationId ||
          message.roomId !== this.roomId ||
          message.displayToken !== this.displayToken
        ) {
          this.close(socket, 1008, "invalid display credentials");
          return;
        }
        this.connectDisplay(socket);
        return;
      case "display_heartbeat":
        if (socket === this.displaySocket && this.matches(message.sessionId, message.phaseId, message.phaseEpoch)) {
          this.displayDisconnectedAt = null;
          this.displayHeartbeatAt = this.now();
        }
        return;
      case "qr_grant_request":
        if (socket === this.displaySocket) this.qr?.push();
        return;
      case "ping": {
        const participantId = this.participantIds.get(socket);
        if (participantId !== undefined) {
          this.votes.recordHeartbeat(participantId, this.now());
          this.queueQuestionStatus();
        }
        return;
      }
      case "video_ended":
        if (socket === this.displaySocket) {
          this.completeVideo(message.sessionId, message.phaseId, message.phaseEpoch);
        }
        return;
      case "input":
        if (
          this.participantSockets.has(socket) &&
          this.lifecycle === "active" &&
          this.matches(message.sessionId, this.phaseId, message.phaseEpoch)
        ) {
          const participantId = this.participantIds.get(socket);
          if (participantId !== undefined) {
            if (this.cursors.recordInput(participantId, message.seq, message.x, message.y)) {
              // Video movement updates only the projected cursor. Votes and
              // question activity remain scoped to position-question phases.
              if (this.currentPhase().kind === "position-question") {
                this.recordInput(this.now(), participantId, message.x, message.y);
              }
            }
          }
        }
        return;
      default:
        return;
    }
  }

  recordInput(now = this.now(), participantId?: string, x?: number, y?: number): boolean {
    if (this.lifecycle !== "active" || this.currentPhase().kind !== "position-question") return false;
    if (participantId !== undefined && x !== undefined && y !== undefined) {
      if (!this.votes.recordInput(participantId, x, y, now)) return false;
      this.queueQuestionStatus(now);
    }
    this.lastInputAt = now;
    return true;
  }

  setDisplayConnected(connected: boolean, now = this.now()): void {
    if (connected) {
      this.displayDisconnectedAt = null;
      return;
    }
    this.displayDisconnectedAt ??= now;
  }

  completeVideo(sessionId: string, phaseId: string, phaseEpoch: number, now = this.now()): TransitionResult {
    const phase = this.currentPhase();
    if (phase.kind !== "video") return { ok: false, reason: "wrong-phase" };
    if (!this.matches(sessionId, phaseId, phaseEpoch)) return { ok: false, reason: "stale" };
    if (!this.video.complete({ sessionId, phaseId, phaseEpoch })) return { ok: false, reason: "stale" };
    return this.advanceTo(phase.next, now, "video-complete");
  }

  resolveQuestion(
    sessionId: string,
    phaseId: string,
    phaseEpoch: number,
    target: string,
    now = this.now(),
  ): TransitionResult {
    const phase = this.currentPhase();
    if (phase.kind !== "position-question") return { ok: false, reason: "wrong-phase" };
    if (!this.matches(sessionId, phaseId, phaseEpoch)) return { ok: false, reason: "stale" };
    const resolution = this.votes.finalize(now);
    if (!resolution || resolution.resolvedTarget !== target) return { ok: false, reason: "invalid-target" };
    this.emitQuestionResolved(resolution, phase, now);
    this.questionResolutionTarget = target;
    this.questionFreezeUntil = now + phase.freezeMs;
    if (phase.freezeMs === 0) {
      this.questionFreezeUntil = null;
      this.questionResolutionTarget = null;
      return this.advanceTo(target, now, "question-resolved");
    }
    return { ok: true };
  }

  recoverAfterCrash(now = this.now()): void {
    if (this.lifecycle === "idle") return;
    this.emitCheckpoint("recovery", "crash-recovery");
    this.abortToIdle("crash-recovery", now);
  }

  private connectDisplay(socket: WebSocket): void {
    if (this.displaySocket !== undefined && this.displaySocket !== socket) {
      this.send(this.displaySocket, {
        t: "display_notice",
        v: PROTOCOL_VERSION,
        code: "display_replaced",
        level: "warning",
        message: "This display connection was replaced.",
      });
      this.close(this.displaySocket, 4002, "display replaced");
    }
    this.displaySocket = socket;
    this.displayHeartbeatAt = this.now();
    this.clients.add(socket);
    this.displayDisconnectedAt = null;
    this.send(socket, this.getSnapshotMessage());
    this.send(socket, { t: "presence", v: PROTOCOL_VERSION, count: this.registry.connectedCount });
    if (this.lifecycle === "idle" && this.registry.connectedCount >= 1) {
      this.startLobby(this.now());
    } else {
      this.qr?.push();
    }
  }

  private startLobby(now: number): void {
    if (this.lifecycle !== "idle" || this.displaySocket === undefined || this.registry.connectedCount < 1) return;
    this.lifecycle = "lobby";
    this.sessionId = "lobby";
    this.phaseId = "idle";
    this.phaseStartedAt = now;
    this.deadlineAt = now + this.policy.lobbyCountdownMs;
    this.phaseEpoch += 1;
    this.sessionStartedAt = null;
    this.lastInputAt = now;
    this.noParticipantSince = null;
    this.deadlineNotified = false;
    this.transition("lobby-start");
  }

  private startSession(now: number): void {
    this.lifecycle = "active";
    this.sessionId = this.sessionIdFactory();
    this.sessionStartedAt = now;
    this.lastInputAt = null;
    this.noParticipantSince = null;
    this.enterPhase(this.scenario.entryPhaseId, now, "session-start");
  }

  private advanceTo(target: string, now: number, reason: string): TransitionResult {
    if (!this.scenario.phases.some((phase) => phase.id === target)) return { ok: false, reason: "invalid-target" };
    this.enterPhase(target, now, reason);
    return { ok: true };
  }

  private enterPhase(target: string, now: number, reason: string): void {
    const phase = this.requirePhase(target);
    this.votes.clearQuestion();
    this.questionStatusDirty = false;
    this.lastQuestionStatusAt = null;
    this.questionFreezeUntil = null;
    this.questionResolutionTarget = null;
    this.phaseId = target;
    this.phaseStartedAt = now;
    this.video.cancel();
    this.deadlineAt = phase.kind === "video"
      ? this.video.begin({ sessionId: this.sessionId, phaseId: target, phaseEpoch: this.phaseEpoch + 1 }, phase.expectedDurationMs, now)
      : phase.kind === "position-question"
        ? now + phase.durationMs
        : null;
    this.phaseEpoch += 1;
    this.deadlineNotified = false;
    if (phase.kind === "idle") {
      this.lifecycle = "idle";
      this.sessionId = "idle";
      this.sessionStartedAt = null;
      this.lastInputAt = null;
    } else {
      this.lifecycle = "active";
      this.lastInputAt = phase.kind === "position-question" ? now : null;
    }
    this.transition(reason);
    if (phase.kind === "position-question") {
      const participants: VoteParticipantSeed[] = this.registry.values().map((participant) => ({
        participantId: participant.clientId,
        connected: participant.socket !== undefined,
        lastHeartbeatAt: participant.lastSeenAt,
      }));
      this.votes.beginQuestion({
        sessionId: this.sessionId,
        question: phase,
        phaseEpoch: this.phaseEpoch,
        phaseStartedAt: this.phaseStartedAt,
        phaseDeadline: this.deadlineAt!,
        participants,
      });
      this.questionStatusDirty = true;
      this.broadcastQuestionStatus(now, true);
    }
  }

  private abortToIdle(reason: string, now: number): void {
    this.enterPhase("idle", now, reason);
    this.noParticipantSince = null;
    this.displayDisconnectedAt = this.displaySocket === undefined ? now : null;
  }

  private transition(reason: string): void {
    this.emitCheckpoint("transition", reason);
    this.broadcast({
      t: "phase",
      v: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      phaseEpoch: this.phaseEpoch,
      phase: this.getSnapshot(),
      serverTime: this.now(),
    });
    this.qr?.push();
  }

  private emitCheckpoint(kind: "transition" | "recovery", reason: string): void {
    this.onCheckpoint?.({
      kind,
      reason,
      sessionId: this.sessionId,
      phaseId: this.phaseId,
      phaseEpoch: this.phaseEpoch,
      startedAt: this.phaseStartedAt,
      deadlineAt: this.deadlineAt,
    });
  }

  private currentPhase(): Phase {
    return this.requirePhase(this.phaseId);
  }

  private interactiveIdleTimedOut(now: number): boolean {
    const interactive = this.lifecycle === "lobby" || this.currentPhase().kind === "position-question";
    return interactive && this.lastInputAt !== null && now - this.lastInputAt >= this.policy.interactiveIdleTimeoutMs;
  }

  private resolveQuestionAtDeadline(now: number, phase: Extract<Phase, { kind: "position-question" }>): void {
    const resolution = this.votes.finalize(now);
    if (!resolution) return;
    this.emitQuestionResolved(resolution, phase, now);
    this.questionResolutionTarget = resolution.resolvedTarget;
    this.questionFreezeUntil = now + phase.freezeMs;
    if (phase.freezeMs === 0) {
      const target = this.questionResolutionTarget;
      this.questionResolutionTarget = null;
      this.questionFreezeUntil = null;
      if (target !== null) this.advanceTo(target, now, "question-resolved");
    }
  }

  private emitQuestionResolved(
    resolution: VoteResolution,
    phase: Extract<Phase, { kind: "position-question" }>,
    now: number,
  ): void {
    const base: {
      t: "question_resolved";
      v: typeof PROTOCOL_VERSION;
      sessionId: string;
      phaseEpoch: number;
      resolvedTarget: string;
      freezeUntil: number;
    } = {
      t: "question_resolved",
      v: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      phaseEpoch: this.phaseEpoch,
      resolvedTarget: resolution.resolvedTarget,
      freezeUntil: now + phase.freezeMs,
    };
    if (isFourVoteResolution(resolution)) {
      this.sendToDisplay({
        ...base,
        field: resolution.field,
        quadrantCounts: resolution.quadrantCounts,
        winner: resolution.winner,
      });
      return;
    }
    this.sendToDisplay({
      ...base,
      field: resolution.field,
      quadrantCounts: resolution.quadrantCounts,
      winner: resolution.winner,
    });
  }

  private queueQuestionStatus(now = this.now()): void {
    this.questionStatusDirty = true;
    this.broadcastQuestionStatus(now);
  }

  private broadcastQuestionStatus(now = this.now(), force = false): void {
    const phase = this.currentPhase();
    if (phase.kind !== "position-question") return;
    if (!force && !this.questionStatusDirty) return;
    if (
      !force &&
      this.lastQuestionStatusAt !== null &&
      now - this.lastQuestionStatusAt < QUESTION_STATUS_INTERVAL_MS
    ) return;
    const status = this.votes.liveStatus(now);
    if (!status) return;
    const base: {
      t: "question_status";
      v: typeof PROTOCOL_VERSION;
      sessionId: string;
      phaseEpoch: number;
      connectedCount: number;
      positionedCount: number;
    } = {
      t: "question_status",
      v: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      phaseEpoch: this.phaseEpoch,
      connectedCount: status.connectedCount,
      positionedCount: status.positionedCount,
    };
    if (isFourLiveQuestionStatus(status)) {
      this.sendToDisplay({
        ...base,
        field: status.field,
        ...(phase.showLiveCounts ? { quadrantCounts: status.quadrantCounts } : {}),
      });
    } else {
      this.sendToDisplay({
        ...base,
        field: status.field,
        ...(phase.showLiveCounts ? { quadrantCounts: status.quadrantCounts } : {}),
      });
    }
    this.questionStatusDirty = false;
    this.lastQuestionStatusAt = now;
  }

  private requirePhase(id: string): Phase {
    const phase = this.scenario.phases.find((candidate) => candidate.id === id);
    if (!phase) throw new Error(`unknown phase "${id}"`);
    return phase;
  }

  private matches(sessionId: string, phaseId: string, phaseEpoch: number): boolean {
    return sessionId === this.sessionId && phaseId === this.phaseId && phaseEpoch === this.phaseEpoch;
  }

  private broadcast(message: ServerToClientMessage): void {
    for (const socket of this.clients) this.send(socket, message);
  }

  private sendToDisplay(message: ServerToClientMessage): void {
    if (this.displaySocket !== undefined) this.send(this.displaySocket, message);
  }

  private send(socket: WebSocket, message: ServerToClientMessage): void {
    if (isOpen(socket)) socket.send(encodeMessage(message));
  }

  private close(socket: WebSocket, code: number, reason: string): void {
    if (isOpen(socket)) socket.close(code, reason);
  }
}
