import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import { DEFAULT_INSTALLATION_POLICY } from "@entertheblackbox/shared";
import type { ClientToServerMessage } from "@entertheblackbox/protocol";
import type { MediaManifest, Scenario } from "@entertheblackbox/scenario";
import { AdmissionController } from "../admission/index.js";
import { PersonalAudio } from "../audio/personal-audio.js";
import type { ServerConfig } from "../config.js";
import { CueFeed } from "../cues/feed.js";
import { PhaseEngine } from "../engine/phase-engine.js";
import { GroupManager } from "../groups/group-manager.js";
import { validateScenarioContent } from "../readiness.js";

const sessionIdSchema = z.string().uuid();
const requestSchema = z.object({ phaseId: z.string().min(1), scenario: z.unknown(), mediaManifest: z.unknown() });
const IDLE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 4;

type DisplayJoin = Extract<ClientToServerMessage, { t: "display_join" }>;

/** Owns all mutable state; no production registry, recordings or cue feed are shared. */
export class Rehearsal {
  readonly admission: AdmissionController;
  readonly cues = new CueFeed();
  readonly sockets = new Set<WebSocket>();
  readonly installationId: string;
  readonly audio: PersonalAudio | null;
  private readonly displays = new Map<WebSocket, { message: DisplayJoin; request: IncomingMessage }>();
  private groups!: GroupManager;
  engine!: PhaseEngine;
  scenario!: Scenario;
  manifest!: MediaManifest;
  updatedAt = Date.now();
  revision = 0;

  constructor(readonly id: string, private readonly config: ServerConfig, report: (error: unknown) => void) {
    this.installationId = `rehearsal-${id}`;
    this.audio = config.audio ? new PersonalAudio(config.audio, config.mediaDir, report) : null;
    this.audio?.start();
    this.admission = new AdmissionController({
      installationId: this.installationId, roomId: config.roomId, secret: randomUUID(),
      policy: { ...DEFAULT_INSTALLATION_POLICY, maxParticipants: config.maxParticipants },
      trustProxy: config.trustProxy, allowPublicJoin: true, buildVersion: config.buildVersion,
      onClientMessage: (message, socket, request) => {
        if (message.t === "display_join" && message.displayToken === id && message.installationId === this.installationId && message.roomId === config.roomId) {
          this.displays.set(socket, { message, request });
        }
        this.engine.handleClientMessage(message, socket, request);
      },
      onParticipantJoin: (participant, socket) => {
        this.groups.ensureParticipant(participant.clientId);
        this.engine.participantJoined(socket, participant);
      },
      onSocketClosed: (socket) => {
        this.displays.delete(socket);
        this.sockets.delete(socket);
        this.engine.socketClosed(socket);
      },
      onMessageError: report,
    });
  }

  apply(scenario: Scenario, manifest: MediaManifest, phaseId: string): void {
    const groups = new GroupManager(scenario);
    groups.beginSession(this.admission.registry.values().map((p) => p.clientId));
    const phoneUrl = new URL(this.config.phoneJoinBaseUrl);
    phoneUrl.searchParams.set("rehearsal", this.id);
    const next = new PhaseEngine({
      scenario, registry: this.admission.registry,
      installationId: this.installationId, roomId: this.config.roomId, showId: this.installationId,
      displayToken: this.id, participantLeaseTtlMs: this.admission.participantLeaseTtlMs,
      autoStartOnFirstParticipant: false, targetAudienceSizeOverride: 0,
      policy: { maxSessionDurationMs: IDLE_TTL_MS, interactiveIdleTimeoutMs: IDLE_TTL_MS },
      onCueEvent: (event) => { this.cues.publish(event); },
      onPhase: (phase, startedAt) => this.audio?.transition(phase, (id) => groups.groupFor(id), startedAt),
      onParticipantPhase: (ids, phase, startedAt) => this.audio?.transitionParticipants(ids, phase, startedAt),
      // Leave phones admitted at the end, ready for the next Studio trigger.
      groupSelection: {
        current: (id) => groups.groupFor(id), method: (id) => groups.votingMethodFor(id),
        select: (id, groupId) => groups.assign(id, groupId),
        begin: (phase, ids) => {
          const cohort = ids.filter((id) => !phase.sourceGroupIds || phase.sourceGroupIds.includes(groups.groupFor(id) ?? ""));
          groups.applyBranch(phase, ids);
          return cohort;
        },
      },
      onVoteSnapshotEnqueued: (snapshot) => {
        const phase = scenario.phases.find((p) => p.id === snapshot.questionId);
        if (phase?.kind === "position-question" || phase?.kind === "video-position-question") groups.recordAnswers(phase.id, phase.field, snapshot);
      },
      qr: { phoneJoinBaseUrl: phoneUrl.href, rehearsalId: this.id, issueGrant: (now) => this.admission.issueJoinGrant(now), allowLateJoin: true },
    });
    this.engine?.stop();
    this.groups = groups;
    this.engine = next;
    this.scenario = scenario;
    this.manifest = manifest;
    this.updatedAt = Date.now();
    this.revision += 1;
    // Reset removes finished group timelines from the persistent SSE snapshot.
    this.cues.publish({ type: "reset", timestamp: this.updatedAt, sessionId: next.currentSessionId, phaseId: "idle", phaseEpoch: 0, timelineId: "main", payload: {} });
    next.startRehearsalAt(phaseId);
    for (const participant of this.admission.registry.values()) {
      if (participant.socket?.readyState === 1) next.participantJoined(participant.socket, participant);
    }
    for (const [socket, { message, request }] of this.displays) {
      if (socket.readyState === 1) next.handleClientMessage(message, socket, request);
    }
    this.audio?.prepare(scenario.phases);
    next.start();
  }

  connect(socket: WebSocket, request: IncomingMessage): void {
    this.sockets.add(socket);
    this.admission.handleConnection(socket, request);
  }

  status() {
    return { id: this.id, revision: this.revision, installationId: this.installationId, roomId: this.config.roomId,
      phaseId: this.engine.currentPhaseId, participants: this.admission.registry.connectedCount,
      displays: [...this.displays.keys()].filter((socket) => socket.readyState === 1).length,
      groups: this.scenario.groups ?? [], expiresAt: this.updatedAt + IDLE_TTL_MS };
  }

  async close(): Promise<void> {
    this.engine.stop();
    this.cues.close();
    for (const socket of this.sockets) socket.close(1000, "Preview ended");
    await this.audio?.stop();
  }
}

export class Rehearsals {
  private readonly sessions = new Map<string, Rehearsal>();
  private readonly applying = new Set<string>();
  constructor(private readonly config: ServerConfig, private readonly report: (error: unknown) => void) {}

  get(id: string): Rehearsal | undefined { return this.sessions.get(id); }

  /** Called only within the existing authenticated, rate-limited admin plugin. */
  registerAdmin(app: FastifyInstance): void {
    app.put<{ Params: { id: string }; Body: unknown }>("/rehearsals/:id", { bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
      const id = sessionIdSchema.safeParse(request.params.id);
      const body = requestSchema.safeParse(request.body);
      if (!id.success || !body.success) return reply.code(400).send({ error: "invalid_preview_request" });
      if (this.applying.has(id.data)) return reply.code(409).send({ error: "preview_busy" });
      if (!this.sessions.has(id.data) && this.sessions.size + this.applying.size >= MAX_SESSIONS) return reply.code(409).send({ error: "preview_capacity", message: "End another device preview before opening one more." });
      this.applying.add(id.data);
      try {
        const content = await validateScenarioContent(body.data.scenario, body.data.mediaManifest, [], this.config.mediaDir, `rehearsal-${id.data}`);
        if (!content.ready) return reply.code(400).send({ error: "invalid_preview", errors: content.errors });
        if (!content.scenario.phases.some((p) => p.id === body.data.phaseId)) return reply.code(400).send({ error: "invalid_preview_phase" });
        const session = this.sessions.get(id.data) ?? new Rehearsal(id.data, this.config, this.report);
        session.apply(content.scenario, content.mediaManifest, body.data.phaseId);
        this.sessions.set(id.data, session);
        reply.header("cache-control", "no-store");
        return session.status();
      } finally { this.applying.delete(id.data); }
    });
    app.delete<{ Params: { id: string } }>("/rehearsals/:id", async (request, reply) => {
      if (this.applying.has(request.params.id)) return reply.code(409).send({ error: "preview_busy" });
      await this.remove(request.params.id);
      return { ok: true };
    });
  }

  registerPublic(app: FastifyInstance): void {
    app.register(async (preview) => {
      preview.addHook("onRequest", async (request, reply) => {
        reply.header("cache-control", "no-store");
        if (!this.get((request.params as { id: string }).id)) return reply.code(404).send({ error: "preview_ended" });
      });
      const session = (params: unknown) => this.sessions.get((params as { id: string }).id)!;
      preview.get("/status", async (request) => session(request.params).status());
      preview.get("/join-config", async (request) => {
        const current = session(request.params);
        return { installationId: current.installationId, roomId: this.config.roomId, audioEnabled: current.audio !== null };
      });
      preview.get("/media-manifest.json", async (request) => session(request.params).manifest);
      preview.get("/synchronized-audio", async (request) => [...new Set(session(request.params).scenario.phases.flatMap((p) => p.kind === "video" && p.phoneAudioMode === "synchronized" && p.phoneAudioSrc ? [p.phoneAudioSrc] : []))]);
      preview.get("/cues", async (request, reply) => {
        const current = session(request.params);
        if (request.headers.authorization !== `Bearer ${current.id}`) return reply.code(401).send({ error: "unauthorized" });
        current.cues.connect(reply);
      });
      preview.post("/audio/register", async (request, reply) => {
        const current = session(request.params);
        const body = z.object({ participantLease: z.string() }).safeParse(request.body);
        const participant = body.success ? current.admission.registry.get(body.data.participantLease) : undefined;
        if (!participant) return reply.code(401).send({ error: "invalid_participant_lease" });
        if (!current.audio) return reply.code(503).send({ error: "audio_not_configured" });
        try { return { streamUrl: await current.audio.register(participant) }; }
        catch { return reply.code(503).send({ error: "audio_unavailable" }); }
      });
      preview.post("/audio/event", async (request, reply) => {
        const current = session(request.params);
        const body = z.object({ participantLease: z.string(), state: z.enum(["ready", "connecting", "playing", "reconnecting", "blocked", "paused"]), at: z.number().finite() }).safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: "invalid_request" });
        const participant = current.admission.registry.get(body.data.participantLease);
        if (!participant) return reply.code(401).send({ error: "invalid_participant_lease" });
        current.audio?.recordEvent(participant.clientId, body.data.state, body.data.at);
        return { ok: true };
      });
    }, { prefix: "/api/rehearsals/:id" });
    const cleanup = setInterval(() => {
      for (const [id, session] of this.sessions) if (!this.applying.has(id) && Date.now() - session.updatedAt >= IDLE_TTL_MS) void this.remove(id);
    }, 60_000);
    cleanup.unref();
    app.addHook("preClose", async () => {
      clearInterval(cleanup);
      await Promise.all([...this.sessions.keys()].map((id) => this.remove(id)));
    });
  }

  private async remove(id: string): Promise<void> {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    await session?.close();
  }
}
