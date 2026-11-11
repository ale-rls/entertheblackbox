import { createScriptRoom } from "./script-room.js";
import { backgroundMusicSchema, type BackgroundMusic } from "@entertheblackbox/show-content";
import { DEFAULT_DISPLAY_SETTINGS, displaySettingsSchema, type DisplaySettings } from "@entertheblackbox/protocol";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { SurfaceController } from "../surface/surface.js";
import type { VideoWallController, WallClip } from "../wall/wall.js";
import { wallLayoutSchema } from "@entertheblackbox/protocol";
import type { SurfaceEffectRunner } from "../surface/effects.js";
import { SURFACE_EFFECT_KINDS, SURFACE_EFFECT_MAX_PERIOD_MS, SURFACE_EFFECT_MIN_PERIOD_MS } from "@entertheblackbox/shared";
import { InMemoryIpRateLimiter, requestIp } from "../admission/rate-limit.js";
import type { PhaseCheckpoint, PhaseEngine, TransitionResult } from "../engine/phase-engine.js";
import type {
  MovementBatchFlushed,
  MovementRecordingFinalized,
  MovementRecordingStarted,
} from "../movement/index.js";
import type { PublishedShowArtifact, PublishedShowSummary } from "../readiness.js";
import type { FinalVoteSnapshot } from "../votes/index.js";

const surfaceRequestSchema = z.object({
  target: z.union([z.literal("all"), z.array(z.string().min(1)).min(1).max(200)]),
  mode: z.enum(["flash", "release", "identify"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  holdMs: z.number().int().positive().max(60_000).optional(),
}).refine((value) => value.mode !== "flash" || value.color !== undefined, { message: "flash needs a color", path: ["color"] });

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const surfaceEffectRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    effect: z.object({
      kind: z.enum(SURFACE_EFFECT_KINDS),
      color: hexColor,
      color2: hexColor,
      periodMs: z.number().int().min(SURFACE_EFFECT_MIN_PERIOD_MS).max(SURFACE_EFFECT_MAX_PERIOD_MS),
      brightness: z.number().min(0).max(1),
    }),
    order: z.array(z.string().min(1)).max(200),
  }),
  z.object({ action: z.literal("stop") }),
]);

const wallCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("load"), clip: z.string().min(1).max(100) }),
  z.object({ action: z.literal("play"), leadMs: z.number().int().min(200).max(10_000).optional() }),
  z.object({ action: z.literal("cue") }),
  z.object({ action: z.literal("stop") }),
  z.object({ action: z.literal("loop"), loop: z.boolean() }),
]);

export type AdminExport = { json: unknown; csv: string; tasksCsv?: string };
export interface AdminDataSource {
  recentErrors(): Promise<readonly unknown[]>;
  exportSession(sessionId: string): Promise<AdminExport | null>;
  audit(entry: { action: string; at: string; detail: unknown }): void;
  recordError?(entry: { message: string; at: string; path: string }): void;
  recordCheckpoint?(checkpoint: PhaseCheckpoint): void;
  recordVoteSnapshot?(snapshot: FinalVoteSnapshot): void;
  recordMovementStarted?(event: MovementRecordingStarted): void;
  recordMovementBatch?(event: MovementBatchFlushed): void;
  recordMovementFinalized?(event: MovementRecordingFinalized): void;
  deleteMovementRecordings?(sessionId: string, participantId: string): Promise<void>;
}

export type RegisterAdminOptions = {
  handover?: (participantId: string) => string;
  onPublishing?: (busy: boolean) => void;
  registerRehearsals?: (app: FastifyInstance) => void;
  waitingVideos?: () => Promise<readonly { src: string; url: string; available: boolean }[]>;
  displaySettings?: { read: () => Promise<DisplaySettings>; write: (value: DisplaySettings) => Promise<DisplaySettings> };
  /** Validates a bearer token against the operators auth collection. */
  verifyToken: (token: string) => Promise<boolean>;
  engine: () => PhaseEngine | null;
  /** Native show-mode surface colour (base + instrument). */
  surface?: Pick<SurfaceController, "setBase" | "play">;
  /** Tablet video wall (Admin → Wall). */
  wall?: {
    controller: Pick<VideoWallController, "snapshot" | "setLayout" | "load" | "play" | "cue" | "stop" | "setLoop">;
    clips: () => Promise<WallClip[]>;
    saveLayout: (layout: z.infer<typeof wallLayoutSchema>) => Promise<z.infer<typeof wallLayoutSchema>>;
  };
  /** Programmed instrument effects (chase, breathe, waves). */
  surfaceEffects?: Pick<SurfaceEffectRunner, "start" | "stop" | "state">;
  ready: boolean;
  nativeAudioCoverage?: () => Promise<unknown>;
  audioStatus?: () => Promise<unknown>;
  audioMusic?: {
    sources: readonly string[] | (() => Promise<readonly string[]>);
    set: (src: string | null, volume: number) => Promise<void>;
  };
  audioSoundcheck?: {
    sources: readonly string[];
    play: (src: string, participantId?: string) => Promise<number>;
    stop: (participantId?: string) => Promise<number>;
  };
  /** Live-switch between the boot-time remote personal-audio backend and an ad hoc local one. */
  audioBridgeControl?: {
    switchBackend: (target: { kind: "remote" } | { kind: "local"; url: string; token: string; publicUrl: string; label: string }) =>
      Promise<{ ok: true } | { ok: false; error: string }>;
  };
  groupControl?: {
    catalogue: readonly { id: string; label: string; color?: string | undefined }[];
    memberships: () => readonly { participantId: string; groupId: string | null }[];
    assign: (participantId: string, groupId: string, expectedEpoch?: number) => void;
  };
  startedAt: number;
  data?: AdminDataSource;
  trustProxy?: boolean;
  rateLimitPolicy?: AdminRateLimitPolicy;
  rateLimiters?: AdminRateLimiters;
  now?: () => number;
  phoneJoinUrl?: string;
  showConfig?: {
    /** The showId this running process actually booted with, or null if no scenario is ready. */
    activeShowId: string | null;
    list: () => Promise<PublishedShowSummary[]>;
    /** The operator-saved pending selection, if any -- takes effect on next restart. */
    readPending: () => Promise<string | null>;
    write: (showId: string) => Promise<void>;
    /** Latest immutable production artifact, optionally scoped to a show. */
    latest?: (showId?: string) => Promise<PublishedShowArtifact | null>;
    publish: (record: { showId: string; name: string; scenario: unknown; mediaManifest: unknown; backgroundMusic?: BackgroundMusic }) => Promise<PublishedShowSummary>;
  };
  ghostConfig?: {
    /** The ghost fill target this running process actually booted with (override, or the scenario's own value, or 0). */
    active: number;
    /** The operator-saved pending override, if any -- takes effect on next restart. */
    readPending: () => Promise<number | null>;
    write: (targetAudienceSize: number) => Promise<void>;
  };
  lobbyConfig?: {
    write: (startTimes: readonly number[]) => Promise<void>;
  };
};

const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export type AdminRateLimitPolicy = {
  maxAuthenticatedRequests: number;
  maxAuthenticationFailures: number;
  windowMs: number;
};

export type AdminRateLimiters = {
  authenticated: InMemoryIpRateLimiter;
  authenticationFailures: InMemoryIpRateLimiter;
};

export const DEFAULT_ADMIN_RATE_LIMIT_POLICY: AdminRateLimitPolicy = {
  // One dashboard makes about 120 requests/minute while polling live status,
  // shows, ghost settings, and the lobby schedule every two seconds.
  maxAuthenticatedRequests: 600,
  maxAuthenticationFailures: 30,
  windowMs: 60_000,
};

async function authorized(request: FastifyRequest, verifyToken: (token: string) => Promise<boolean>): Promise<boolean> {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) return false;
  return verifyToken(value.slice(7));
}

export function registerAdminRoutes(app: FastifyInstance, options: RegisterAdminOptions): void {
  const policy = options.rateLimitPolicy ?? DEFAULT_ADMIN_RATE_LIMIT_POLICY;
  const rateLimiters = options.rateLimiters ?? {
    authenticated: new InMemoryIpRateLimiter({
      maxAttempts: policy.maxAuthenticatedRequests,
      windowMs: policy.windowMs,
    }),
    authenticationFailures: new InMemoryIpRateLimiter({
      maxAttempts: policy.maxAuthenticationFailures,
      windowMs: policy.windowMs,
    }),
  };
  const now = options.now ?? (() => Date.now());
  let publishBusy = false;
  const scriptRoom = createScriptRoom();
  scriptRoom.registerReader(app);

  app.register(async (admin) => {
    admin.addHook("onRequest", async (request, reply) => {
      const isAuthorized = await authorized(request, options.verifyToken);
      const rate = (isAuthorized ? rateLimiters.authenticated : rateLimiters.authenticationFailures)
        .consume(requestIp(request.raw, options.trustProxy ?? false), now());
      if (!rate.allowed) {
        if (rate.retryAfterMs !== undefined) {
          reply.header("retry-after", Math.ceil(rate.retryAfterMs / 1_000));
        }
        return reply.code(429).send({
          error: "rate_limited",
          ...(rate.retryAfterMs === undefined ? {} : { retryAfterMs: rate.retryAfterMs }),
        });
      }
      if (!isAuthorized) return reply.code(401).send({ error: "unauthorized" });
    });

    admin.register(async (scriptAdmin) => scriptRoom.registerAdmin(scriptAdmin));
    options.registerRehearsals?.(admin);
    admin.get("/audio/native-coverage", async (_request, reply) => {
      reply.header("cache-control", "no-store");
      if (!options.nativeAudioCoverage) return reply.code(503).send({ error: "show_unavailable" });
      return options.nativeAudioCoverage();
    });

    admin.post<{ Body: unknown }>("/surface", async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (!options.surface) return reply.code(503).send({ error: "surface_unavailable" });
      const parsed = surfaceRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_surface_request", issues: parsed.error.issues });
      const { target, mode } = parsed.data;
      const delivered = mode === "flash"
        ? options.surface.play(target, { mode, color: parsed.data.color!, ...(parsed.data.holdMs === undefined ? {} : { holdMs: parsed.data.holdMs }) })
        : options.surface.play(target, { mode });
      return { ok: true, delivered };
    });
    admin.get("/wall", async (_request, reply) => {
      reply.header("cache-control", "no-store");
      if (!options.wall) return reply.code(503).send({ error: "wall_unavailable" });
      const clips = await options.wall.clips().catch(() => null);
      return { ...options.wall.controller.snapshot(), clips, clipsError: clips === null ? "Media library unavailable" : undefined };
    });
    admin.put<{ Body: unknown }>("/wall/layout", async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (!options.wall) return reply.code(503).send({ error: "wall_unavailable" });
      const parsed = wallLayoutSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_wall_layout", issues: parsed.error.issues });
      const layout = await options.wall.saveLayout(parsed.data);
      const delivered = options.wall.controller.setLayout(layout);
      options.data?.audit({ action: "set-wall-layout", at: new Date().toISOString(), detail: { key: "video-wall" } });
      return { ok: true, layout, delivered };
    });
    admin.post<{ Body: unknown }>("/wall", async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (!options.wall) return reply.code(503).send({ error: "wall_unavailable" });
      const parsed = wallCommandSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_wall_command", issues: parsed.error.issues });
      const wall = options.wall.controller;
      const command = parsed.data;
      if (command.action === "load") {
        const result = await wall.load(command.clip);
        return result.ok ? result : reply.code(404).send(result);
      }
      if (command.action === "play") {
        const result = wall.play(command.leadMs);
        return result.ok ? result : reply.code(409).send(result);
      }
      const delivered = command.action === "cue" ? wall.cue() : command.action === "stop" ? wall.stop() : wall.setLoop(command.loop);
      return { ok: true, delivered };
    });
    admin.get("/surface/effect", async (_request, reply) => {
      reply.header("cache-control", "no-store");
      if (!options.surfaceEffects) return reply.code(503).send({ error: "surface_unavailable" });
      return { running: options.surfaceEffects.state, serverNow: Date.now() };
    });
    admin.post<{ Body: unknown }>("/surface/effect", async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (!options.surfaceEffects) return reply.code(503).send({ error: "surface_unavailable" });
      const parsed = surfaceEffectRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_surface_effect", issues: parsed.error.issues });
      const delivered = parsed.data.action === "start"
        ? options.surfaceEffects.start(parsed.data.effect, parsed.data.order)
        : options.surfaceEffects.stop();
      return { ok: true, delivered, running: options.surfaceEffects.state, serverNow: Date.now() };
    });
    admin.get("/settings/waiting-videos", async (_request, reply) => {
      reply.header("cache-control", "no-store");
      if (!options.waitingVideos) return reply.code(503).send({ error: "media_library_unavailable" });
      return { videos: await options.waitingVideos() };
    });
    admin.get("/settings/display", async (_request, reply) => {
      reply.header("cache-control", "no-store");
      return { groups: options.groupControl?.catalogue ?? [], configured: Boolean(options.displaySettings), display: await options.displaySettings?.read() ?? DEFAULT_DISPLAY_SETTINGS };
    });
    admin.put<{ Body: unknown }>("/settings/display", async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (!options.displaySettings) return reply.code(503).send({ error: "persistence_unavailable" });
      const parsed = displaySettingsSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_display_settings", issues: parsed.error.issues });
      const display = await options.displaySettings.write(parsed.data);
      options.surface?.setBase(display.phoneSurfaceColor);
      options.data?.audit({ action: "set-display-settings", at: new Date().toISOString(), detail: { key: "display" } });
      return { configured: true, display };
    });

    admin.post<{ Body: unknown }>('/handover', async (request, reply) => {
      const parsed = z.object({ participantId: z.string(), sessionId: z.string(), phaseEpoch: z.number().int() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid handover' });
      const engine = options.engine();
      if (!engine || !options.handover) return reply.code(503).send({ error: 'Handover unavailable' });
      if (parsed.data.sessionId !== engine.currentSessionId || parsed.data.phaseEpoch !== engine.currentPhaseEpoch) return reply.code(409).send({ error: 'Show state changed' });
      try { const replacementId = options.handover(parsed.data.participantId); options.data?.audit({ action: 'participant-handover', at: new Date().toISOString(), detail: { ...parsed.data, replacementId } }); return { replacementId }; }
      catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : 'Handover failed' }); }
    });
    admin.post<{ Body: unknown }>('/admission-program', async (request, reply) => {
      const parsed = z.object({ participantId: z.string(), generation: z.string(), groupId: z.string().optional() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid admission command' });
      const engine = options.engine();
      if (!engine) return reply.code(503).send({ error: 'Show unavailable' });
      try { engine.admissionCommand(parsed.data.participantId, parsed.data.generation, parsed.data.groupId); }
      catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : 'Admission failed' }); }
      options.data?.audit({ action: 'admission-program', at: new Date().toISOString(), detail: parsed.data });
      return engine.admissionStatus;
    });
    admin.post<{ Body: unknown }>('/tasks', async (request, reply) => {
      const parsed = z.object({ action: z.enum(['open', 'close', 'cancel', 'go', 'assign-role', 'withdraw-role']), sessionId: z.string(), phaseId: z.string(), phaseEpoch: z.number().int(), roleId: z.string().optional(), participantId: z.string().optional(), templateId: z.string().optional(), instanceId: z.string().optional(), participantIds: z.array(z.string()).min(1).optional() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid task command' });
      const engine = options.engine();
      if (!engine) return reply.code(503).send({ error: 'Show unavailable' });
      try { engine.taskCommand(parsed.data); }
      catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : 'Task command failed' }); }
      options.data?.audit({ action: 'participant-task', at: new Date().toISOString(), detail: parsed.data });
      return engine.taskStatus;
    });

    admin.get("/status", async (_request, reply) => {
      reply.header("cache-control", "no-store");
      const engine = options.engine();
      const memberships = new Map(options.groupControl?.memberships().map((row) => [row.participantId, row.groupId]) ?? []);
      const catalogueById = new Map((options.groupControl?.catalogue ?? []).map((group) => [group.id, group]));
      const flowScenes = new Map((engine?.adminFlow.scenes ?? []).map((scene) => [scene.id, scene]));
      return {
        audio: await options.audioStatus?.() ?? { configured: false, players: [] },
        admission: engine?.admissionStatus ?? null,
        tasks: engine?.taskStatus ?? null,
        healthy: true,
        ready: options.ready,
        phoneJoinUrl: options.phoneJoinUrl ?? null,
        serverTime: Date.now(),
        phaseTiming: engine ? { startedAt: engine.getSnapshot().startedAt, deadlineAt: engine.getSnapshot().deadlineAt } : null,
        uptimeMs: Date.now() - options.startedAt,
        timingMonitors: engine?.timingMonitors ?? [],
        displayConnected: engine?.isDisplayConnected ?? false,
        displayHeartbeatAgeMs: engine?.displayHeartbeatAgeMs ?? null,
        displayPlaybackIssue: engine?.currentDisplayPlaybackIssue ?? null,
        connectedParticipants: engine?.connectedParticipantCount ?? 0,
        participants: (engine?.participantPresence ?? []).map((participant) => ({
          ...participant,
          groupId: engine?.participantState?.(participant.clientId) === "unassigned" ? null : memberships.get(participant.clientId) ?? null,
          state: engine?.participantState?.(participant.clientId) ?? "active",
        })),
        groups: options.groupControl?.catalogue ?? [],
        groupDestinations: engine?.groupDestinations ?? [],
        pendingGroupAssignments: engine?.pendingGroupAssignments ?? [],
        pendingDisconnectedGroupAssignments: engine?.pendingDisconnectedGroupAssignments ?? [],
        sessionId: engine?.currentSessionId ?? null,
        lifecycle: engine?.lifecycleState ?? null,
        phaseId: engine?.currentPhaseId ?? null,
        phaseEpoch: engine?.currentPhaseEpoch ?? null,
        // Authoritative per-group progress while a group-branch phase runs --
        // the top-level phaseId/phaseEpoch above stay pinned to that shared
        // scene the whole time, so this is the only source of "who is where."
        groupPathsStarted: engine?.groupPathsStarted ?? false,
        groupPaths: (engine?.groupPaths ?? []).map((path) => ({
          ...path,
          label: catalogueById.get(path.groupId)?.label ?? path.groupId,
          color: catalogueById.get(path.groupId)?.color ?? null,
          phaseTitle: flowScenes.get(path.phaseId)?.title ?? path.phaseId,
        })),
      };
    });
    admin.post<{ Body: { src?: unknown; volume?: unknown } }>("/audio/music", async (request, reply) => {
      const music = options.audioMusic;
      if (!music) return reply.code(503).send({ error: "audio_unavailable" });
      const { src, volume = 0.2 } = request.body ?? {};
      if ((src !== null && typeof src !== "string")
        || typeof volume !== "number" || !Number.isFinite(volume) || volume < 0 || volume > 1) {
        return reply.code(400).send({ error: "invalid_music_request" });
      }
      try {
        const sources = src === null ? [] : typeof music.sources === "function" ? await music.sources() : music.sources;
        if (src !== null && !sources.includes(src as string)) return reply.code(400).send({ error: "invalid_music_request" });
        await music.set(src as string | null, volume);
        return { ok: true };
      } catch (error) {
        return reply.code(502).send({ error: error instanceof Error ? error.message : "music_failed" });
      }
    });
    admin.post<{ Body: { action?: unknown; src?: unknown; participantId?: unknown } }>("/audio/soundcheck", async (request, reply) => {
      const soundcheck = options.audioSoundcheck;
      if (!soundcheck) return reply.code(503).send({ error: "audio_unavailable" });
      if (options.engine()?.lifecycleState === "active") return reply.code(409).send({ error: "show_active" });
      const { action, src, participantId } = request.body ?? {};
      if (participantId !== undefined && (typeof participantId !== "string" || !participantId)) return reply.code(400).send({ error: "invalid_request" });
      try {
        if (action === "stop") return { ok: true, affected: await soundcheck.stop(participantId as string | undefined) };
        if (action !== "play" || typeof src !== "string" || !soundcheck.sources.includes(src)) return reply.code(400).send({ error: "invalid_audio_source" });
        return { ok: true, affected: await soundcheck.play(src, participantId as string | undefined) };
      } catch (error) {
        return reply.code(409).send({ error: error instanceof Error ? error.message : "soundcheck_failed" });
      }
    });
    admin.post<{ Body: { mode?: unknown; url?: unknown; token?: unknown; publicUrl?: unknown; label?: unknown } }>("/audio/bridge", async (request, reply) => {
      const control = options.audioBridgeControl;
      if (!control) return reply.code(503).send({ error: "audio_unavailable" });
      const { mode, url, token, publicUrl, label } = request.body ?? {};
      if (mode === "remote") {
        const result = await control.switchBackend({ kind: "remote" });
        if (!result.ok) return reply.code(502).send({ error: result.error });
        options.data?.audit({ action: "switch-audio-backend", at: new Date().toISOString(), detail: { mode: "remote" } });
        return { ok: true, backend: "remote" };
      }
      if (mode !== "local" || typeof url !== "string" || !url || typeof token !== "string" || !token
        || typeof publicUrl !== "string" || !publicUrl || typeof label !== "string" || !label) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const result = await control.switchBackend({ kind: "local", url, token, publicUrl, label });
      if (!result.ok) return reply.code(502).send({ error: result.error });
      options.data?.audit({ action: "switch-audio-backend", at: new Date().toISOString(), detail: { mode: "local", label } });
      return { ok: true, backend: "local", label };
    });
    admin.post<{ Body: { participantId?: unknown; groupId?: unknown; expectedEpoch?: unknown; sessionId?: unknown } }>("/groups/assign", async (request, reply) => {
      if (!options.groupControl) return reply.code(503).send({ error: "groups_unavailable" });
      const { participantId, groupId, expectedEpoch, sessionId } = request.body ?? {};
      if ((expectedEpoch !== undefined && (!Number.isSafeInteger(expectedEpoch) || (expectedEpoch as number) < 0)) || (sessionId !== undefined && typeof sessionId !== "string")) return reply.code(400).send({ error: "invalid_request" });
      if (sessionId !== undefined && sessionId !== options.engine()?.currentSessionId) return reply.code(409).send({ error: "stale" });
      if (typeof participantId !== "string" || !participantId || typeof groupId !== "string" || !groupId) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const participant = options.engine()?.participantPresence.find((row) => row.clientId === participantId);
      if (!participant) return reply.code(404).send({ error: "participant_not_found" });
      try { options.groupControl.assign(participantId, groupId, expectedEpoch as number | undefined); }
      catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : "assignment_failed" }); }
      options.data?.audit({ action: "assign-participant-group", at: new Date().toISOString(), detail: { participantId, groupId } });
      return { ok: true, participantId, groupId };
    });
    admin.get("/flow", async (_request, reply) => {
      const engine = options.engine();
      if (engine === null) return reply.code(503).send({ error: "engine_unavailable" });
      return engine.adminFlow;
    });
    admin.get("/lobby", async () => {
      const engine = options.engine();
      return {
        startTimes: engine?.lobbyStartTimes ?? [],
        nextStartAt: engine?.nextLobbyStartAt ?? null,
        lifecycle: engine?.lifecycleState ?? null,
      };
    });
    admin.post<{ Body: { startTimes?: unknown } }>("/lobby", async (request, reply) => {
      const engine = options.engine();
      if (engine === null) return reply.code(503).send({ error: "engine_unavailable" });
      const { startTimes } = request.body ?? {};
      if (
        !Array.isArray(startTimes) || startTimes.length > 50 ||
        !startTimes.every((time) => typeof time === "number" && Number.isSafeInteger(time) && time > now())
      ) {
        return reply.code(400).send({ error: "invalid_start_times" });
      }
      const normalized = [...new Set(startTimes)].sort((a, b) => a - b);
      await options.lobbyConfig?.write(normalized);
      const result = engine.setLobbyStartTimes(normalized, now());
      options.data?.audit({ action: "set-lobby-start-times", at: new Date().toISOString(), detail: { startTimes: normalized } });
      return { ...result, startTimes: engine.lobbyStartTimes, nextStartAt: engine.nextLobbyStartAt };
    });
    admin.post<{ Body: { deltaMs?: unknown } }>("/lobby/adjust", async (request, reply) => {
      const engine = options.engine();
      if (engine === null) return reply.code(503).send({ error: "engine_unavailable" });
      const { deltaMs } = request.body ?? {};
      if (typeof deltaMs !== "number" || ![-60_000, -10_000, 10_000, 60_000].includes(deltaMs)) {
        return reply.code(400).send({ error: "invalid_adjustment" });
      }
      const next = engine.nextLobbyStartAt;
      if (next === null) return reply.code(409).send({ ok: false, reason: "wrong-phase" });
      const adjusted = Math.max(now() + 1_000, next + deltaMs);
      const updated = [adjusted, ...engine.lobbyStartTimes.slice(1)].sort((a, b) => a - b);
      await options.lobbyConfig?.write(updated);
      engine.setLobbyStartTimes(updated, now());
      options.data?.audit({ action: "adjust-lobby-start", at: new Date().toISOString(), detail: { deltaMs, nextStartAt: engine.nextLobbyStartAt } });
      return { ok: true, startTimes: engine.lobbyStartTimes, nextStartAt: engine.nextLobbyStartAt };
    });
    admin.get("/errors", async () => ({ errors: await options.data?.recentErrors() ?? [] }));
    admin.get("/shows", async (_request, reply) => {
      if (!options.showConfig) return reply.code(503).send({ error: "show_config_unavailable" });
      return {
        active: options.showConfig.activeShowId,
        pending: await options.showConfig.readPending(),
        shows: await options.showConfig.list(),
      };
    });
    admin.get<{ Querystring: { showId?: string } }>("/shows/latest", async (request, reply) => {
      if (!options.showConfig?.latest) return reply.code(503).send({ error: "show_config_unavailable" });
      const requested = request.query.showId?.trim() || undefined;
      const showId = requested ?? options.showConfig.activeShowId ?? undefined;
      const artifact = await options.showConfig.latest(showId);
      if (!artifact) return reply.code(404).send({ error: "published_show_not_found" });
      return artifact;
    });
    admin.post<{ Body: { showId?: unknown } }>("/shows", async (request, reply) => {
      if (!options.showConfig) return reply.code(503).send({ error: "show_config_unavailable" });
      const { showId } = request.body ?? {};
      if (typeof showId !== "string" || showId === "") {
        return reply.code(400).send({ error: "invalid_show_id" });
      }
      const shows = await options.showConfig.list();
      if (!shows.some((show) => show.showId === showId)) {
        return reply.code(400).send({ error: "unknown_show_id" });
      }
      await options.showConfig.write(showId);
      options.data?.audit({ action: "set-active-show", at: new Date().toISOString(), detail: { showId } });
      return { ok: true, pending: showId };
    });
    admin.get("/ghosts", async (_request, reply) => {
      if (!options.ghostConfig) return reply.code(503).send({ error: "ghost_config_unavailable" });
      return {
        active: options.ghostConfig.active,
        pending: await options.ghostConfig.readPending(),
      };
    });
    admin.post<{ Body: { targetAudienceSize?: unknown } }>("/ghosts", async (request, reply) => {
      if (!options.ghostConfig) return reply.code(503).send({ error: "ghost_config_unavailable" });
      const { targetAudienceSize } = request.body ?? {};
      if (typeof targetAudienceSize !== "number" || !Number.isInteger(targetAudienceSize) || targetAudienceSize < 0) {
        return reply.code(400).send({ error: "invalid_target_audience_size" });
      }
      await options.ghostConfig.write(targetAudienceSize);
      options.data?.audit({ action: "set-target-audience-size", at: new Date().toISOString(), detail: { targetAudienceSize } });
      return { ok: true, pending: targetAudienceSize };
    });
    admin.post("/native-shows/publish", async (_request, reply) => reply.code(410).send({ error: "use_unified_publish", message: "Use Publish show in Studio. It includes native devices and every display." }));
    admin.post<{ Body: { showId?: unknown; name?: unknown; scenario?: unknown; mediaManifest?: unknown; baseRecordId?: unknown; force?: unknown; backgroundMusic?: unknown } }>("/publish", async (request, reply) => {
      if (!options.showConfig) return reply.code(503).send({ error: "show_config_unavailable" });
      const { showId, name, scenario, mediaManifest, baseRecordId, force, backgroundMusic } = request.body ?? {};
      if (
        typeof showId !== "string" || !INSTALLATION_ID_PATTERN.test(showId)
        || typeof name !== "string" || name.trim() === ""
        || typeof scenario !== "object" || scenario === null
        || typeof mediaManifest !== "object" || mediaManifest === null
        || (baseRecordId !== undefined && (typeof baseRecordId !== "string" || baseRecordId === ""))
        || (force !== undefined && typeof force !== "boolean")
      ) {
        return reply.code(400).send({ error: "invalid_publish_request" });
      }
      const music = backgroundMusicSchema.optional().safeParse(backgroundMusic);
      if (!music.success) return reply.code(400).send({ error: "invalid_publish_request" });
      if (publishBusy) return reply.code(409).send({ error: "publish_in_progress" });
      publishBusy = true;
      options.onPublishing?.(true);
      try {
        // force lets an operator explicitly overwrite production despite a
        // stale baseline (Studio surfaces what it would overwrite first --
        // see the stale_production_baseline branch below and App.tsx's
        // "Publish anyway" flow). It never bypasses operator auth.
        if (typeof baseRecordId === "string" && force !== true) {
          if (!options.showConfig.latest) return reply.code(503).send({ error: "show_config_unavailable" });
          const latest = await options.showConfig.latest(showId);
          if (!latest || latest.recordId !== baseRecordId) {
            return reply.code(409).send({
              error: "stale_production_baseline",
              latest: latest === null ? null : {
                recordId: latest.recordId,
                version: latest.version,
                publishedAt: latest.publishedAt,
              },
            });
          }
        }
        const published = await options.showConfig.publish({ showId, name, scenario, mediaManifest, ...(music.data ? { backgroundMusic: music.data } : {}) });
        try { await options.showConfig.write(showId); }
        catch { return reply.code(503).send({ error: "activation_failed", message: "Show saved, but automatic selection failed. Select it in Admin → Active show or retry publication." }); }
        try { options.data?.audit({ action: "publish-show", at: new Date().toISOString(), detail: { showId, name, ...(force === true ? { forced: true } : {}) } }); }
        catch (error) { request.log.error({ error }, "publication audit failed after successful save"); }
        return { ok: true, show: published, deferred: options.engine()?.lifecycleState === "active" };
      } catch (error) {
        request.log.error({ error }, "show publication failed");
        return reply.code(422).send({ error: "publish_failed", message: error instanceof Error ? error.message : "Could not prepare show content." });
      } finally { publishBusy = false; options.onPublishing?.(false); }
    });
    admin.get<{ Params: { sessionId: string }; Querystring: { format?: string } }>("/sessions/:sessionId/export", async (request, reply) => {
      const result = await options.data?.exportSession(request.params.sessionId);
      if (!result) return reply.code(404).send({ error: "session_not_found" });
      if (request.query.format === 'tasks-csv') return reply.type('text/csv; charset=utf-8').send(result.tasksCsv ?? '');
      if (request.query.format === "csv") return reply.type("text/csv; charset=utf-8").send(result.csv);
      return result.json;
    });
    admin.post<{ Body: { phaseId?: unknown; groupId?: unknown; expectedPhaseId?: unknown; expectedEpoch?: unknown; sessionId?: unknown } }>("/jump", async (request, reply) => {
      const { phaseId, groupId, expectedPhaseId, expectedEpoch, sessionId } = request.body ?? {};
      if ((expectedEpoch !== undefined && !Number.isSafeInteger(expectedEpoch)) || (sessionId !== undefined && typeof sessionId !== "string")) return reply.code(400).send({ error: "invalid_request" });
      const current = options.engine();
      const epoch = typeof groupId === "string" ? current?.groupPaths.find((path) => path.groupId === groupId)?.phaseEpoch : current?.currentPhaseEpoch;
      if ((expectedEpoch !== undefined && expectedEpoch !== epoch) || (sessionId !== undefined && sessionId !== current?.currentSessionId)) return reply.code(409).send({ error: "stale" });
      if (typeof phaseId !== "string" || phaseId === "") {
        return reply.code(400).send({ error: "invalid_phase_id" });
      }
      if (groupId !== undefined && (typeof groupId !== "string" || groupId === "")) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      if (expectedPhaseId !== undefined && (typeof expectedPhaseId !== "string" || expectedPhaseId === "")) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const engine = options.engine();
      const result: TransitionResult = engine === null
        ? { ok: false, reason: "wrong-phase" }
        : typeof groupId === "string"
          ? engine.adminJumpGroup(groupId, phaseId, undefined, expectedPhaseId)
          : engine.adminJump(phaseId, undefined, expectedPhaseId);
      options.data?.audit({ action: "jump", at: new Date().toISOString(), detail: { phaseId, groupId, ...result } });
      return result.ok ? result : reply.code(409).send(result);
    });
    admin.post<{ Body: { groupId?: unknown; expectedPhaseId?: unknown } }>("/skip", async (request, reply) => {
      const { groupId, expectedPhaseId } = request.body ?? {};
      if (groupId !== undefined && (typeof groupId !== "string" || groupId === "")) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      if (expectedPhaseId !== undefined && (typeof expectedPhaseId !== "string" || expectedPhaseId === "")) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const engine = options.engine();
      const result: TransitionResult = engine === null
        ? { ok: false, reason: "wrong-phase" }
        : typeof groupId === "string"
          ? engine.adminSkipGroup(groupId, undefined, expectedPhaseId)
          : engine.adminSkip(undefined, expectedPhaseId);
      options.data?.audit({ action: "skip", at: new Date().toISOString(), detail: { groupId, ...result } });
      return result.ok ? result : reply.code(409).send(result);
    });
    admin.post<{ Body: { expectedPhaseId?: unknown; groupId?: unknown; expectedEpoch?: unknown; skipDisconnected?: unknown } }>("/groups/start-paths", async (request, reply) => {
      const { expectedPhaseId, groupId, expectedEpoch, skipDisconnected } = request.body ?? {};
      if (skipDisconnected !== undefined && typeof skipDisconnected !== "boolean") return reply.code(400).send({ error: "invalid_request" });
      if (expectedEpoch !== undefined && (typeof expectedEpoch !== "number" || !Number.isInteger(expectedEpoch) || expectedEpoch < 0)) return reply.code(400).send({ error: "invalid_request" });
      if (groupId !== undefined && (typeof groupId !== "string" || !groupId)) return reply.code(400).send({ error: "invalid_request" });
      if (expectedPhaseId !== undefined && (typeof expectedPhaseId !== "string" || expectedPhaseId === "")) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const engine = options.engine();
      const result: TransitionResult = engine === null
        ? { ok: false, reason: "wrong-phase" }
        : engine.adminStartGroupPaths(undefined, expectedPhaseId, groupId as string | undefined, expectedEpoch as number | undefined, skipDisconnected === true);
      options.data?.audit({ action: "start-group-paths", at: new Date().toISOString(), detail: { groupId, expectedPhaseId, expectedEpoch, skipDisconnected: skipDisconnected === true, ...result } });
      return result.ok ? result : reply.code(409).send(result);
    });
    admin.post<{ Body: { expectedPhaseId?: unknown; groupId?: unknown; expectedEpoch?: unknown } }>("/groups/reunion", async (request, reply) => {
      const { expectedPhaseId, groupId, expectedEpoch } = request.body ?? {};
      if (expectedEpoch !== undefined && (typeof expectedEpoch !== "number" || !Number.isInteger(expectedEpoch) || expectedEpoch < 0)) return reply.code(400).send({ error: "invalid_request" });
      if (groupId !== undefined && (typeof groupId !== "string" || !groupId)) return reply.code(400).send({ error: "invalid_request" });
      if (expectedPhaseId !== undefined && (typeof expectedPhaseId !== "string" || expectedPhaseId === "")) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const engine = options.engine();
      const result: TransitionResult = engine === null
        ? { ok: false, reason: "wrong-phase" }
        : engine.adminForceReunion(undefined, expectedPhaseId, groupId as string | undefined, expectedEpoch as number | undefined);
      options.data?.audit({ action: "force-reunion", at: new Date().toISOString(), detail: { groupId, expectedPhaseId, expectedEpoch, ...result } });
      return result.ok ? result : reply.code(409).send(result);
    });
    for (const action of ["start", "idle", "restart"] as const) {
      admin.post(`/${action}`, async (_request, reply) => {
        const engine = options.engine();
        const result: TransitionResult = engine === null
          ? { ok: false, reason: "wrong-phase" }
          : action === "start" ? engine.adminStart()
            : action === "idle" ? engine.adminIdle()
              : engine.adminRestart();
        options.data?.audit({ action, at: new Date().toISOString(), detail: result });
        return result.ok ? result : reply.code(409).send(result);
      });
    }
  }, { prefix: "/api/admin" });
}
