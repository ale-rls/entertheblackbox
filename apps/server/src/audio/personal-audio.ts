import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import type { Phase } from "@entertheblackbox/scenario";

export type AudioConfig = { url: string; token: string; publicUrl: string };
export type AudioBackend = { kind: "remote" } | { kind: "local"; config: AudioConfig; label: string };
export type AudioParticipant = { clientId: string; name: string };
export type PlaybackState = "ready" | "connecting" | "playing" | "reconnecting" | "blocked" | "paused";
type Telemetry = { state: PlaybackState; clientAt: number; receivedAt: number; reconnectedAt: number | null; reconnects: number; lastRecoveryMs: number | null };
type Active = { kind: "remote" | "local"; config: AudioConfig; label: string };

/** The delivery roster survives sleeping phones and their disconnected WebSockets. */
export class PersonalAudio {
  private readonly remote: AudioConfig;
  private active: Active;
  private readonly players = new Map<string, AudioParticipant>();
  private readonly uploaded = new Map<string, Promise<string>>();
  private generation = 0;
  private music: { src: string; volume: number } | null = null;

  async setMusic(src: string | null, volume = 0.2): Promise<void> {
    const task = this.work.then(async () => {
      const file = src === null ? null : await this.upload(src);
      await this.call("/music", "POST", { file, volume });
      this.music = src === null ? null : { src, volume };
    });
    this.work = task.catch((error: unknown) => this.failed(error));
    await task;
  }

  get backgroundMusic() { return this.music; }

  private currentAudioSrc: string | undefined;
  private currentAudioByPlayer = new Map<string, string | undefined>();
  private sourceForPlayer: (participantId: string) => string | undefined = () => undefined;
  private phaseStartedAt: number | undefined;
  private readonly participantStartedAt = new Map<string, number | undefined>();
  private readonly phaseOverrides = new Map<string, Phase>();
  private readonly playerRevisions = new Map<string, number>();
  private readonly playedGeneration = new Map<string, number>();
  private work: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastError: string | null = null;
  private readonly deliveryErrors = new Map<string, string>();
  private readonly telemetry = new Map<string, Telemetry>();
  private readonly pendingReleases = new Set<string>();
  private readonly sourceEpochs = new Map<string, string>();
  private restoreMusic = false;
  private reconciling = false;
  private stopped = false;

  constructor(remoteConfig: AudioConfig, private readonly mediaDir: string,
    private readonly report: (error: unknown) => void,
    private readonly request: typeof fetch = fetch,
    private readonly notifyStreamUrl: (clientId: string, streamUrl: string) => void = () => {},
    private readonly now: () => number = Date.now) {
    this.remote = remoteConfig;
    this.active = { kind: "remote", config: remoteConfig, label: "Remote" };
  }

  private get config(): AudioConfig { return this.active.config; }

  private streamUrl(id: string): string {
    return `${this.active.config.publicUrl.replace(/\/$/, "")}/stream/${encodeURIComponent(id)}`;
  }

  /**
   * Live-switches which bridge (Icecast/Liquidsoap stack) is active, e.g. an
   * admin's ad hoc local rig instead of the boot-time remote deployment.
   * Health-checks the target first and never mutates state on failure -- a
   * bad switch must not strand the show without audio. On success, every
   * known player is re-registered and replayed against the new backend and
   * notified of its new stream URL; a player whose push fails keeps its old
   * URL until the existing reconcile-loop recovery heals it (see reconcile()
   * / refreshParticipant()), at which point it is notified too.
   */
  async setBackend(target: AudioBackend): Promise<{ ok: true } | { ok: false; error: string }> {
    const config = target.kind === "remote" ? this.remote : target.config;
    const label = target.kind === "remote" ? "Remote" : target.label;
    try {
      const response = await this.request(`${config.url.replace(/\/$/, "")}/health`, {
        headers: { Authorization: `Bearer ${target.kind === "remote" ? this.remote.token : target.config.token}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return { ok: false, error: `Audio bridge health check failed: HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    this.active = { kind: target.kind, config, label };
    this.uploaded.clear();
    this.deliveryErrors.clear();
    this.playedGeneration.clear();
    const ids = [...this.players.keys()];
    const switched = this.work.then(() => Promise.all(ids.map((id) => this.pushToBackend(id).catch((error: unknown) => {
      this.deliveryErrors.set(id, error instanceof Error ? error.message : String(error));
      this.failed(error);
    }))).then(() => undefined));
    this.work = switched.catch((error: unknown) => this.failed(error));
    await switched;
    try {
      await this.setMusic(this.music?.src ?? null, this.music?.volume ?? 0.2);
    } catch (error) {
      return { ok: false, error: `Backend switched, but background music failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    return { ok: true };
  }

  private async pushToBackend(id: string): Promise<void> {
    if (!this.players.has(id) || this.stopped) return;
    this.observeSourceEpoch(id, await this.call(`/players/${encodeURIComponent(id)}/active`, "PUT", { active: true }));
    const generation = this.generation;
    const revision = this.playerRevisions.get(id);
    const src = this.currentAudioByPlayer.has(id)
      ? this.currentAudioByPlayer.get(id)
      : this.sourceForPlayer(id) ?? this.currentAudioSrc;
    if (src) {
      const file = await this.upload(src);
      if (!this.players.has(id) || this.stopped || generation !== this.generation || revision !== this.playerRevisions.get(id)) return;
      await this.call(`/players/${encodeURIComponent(id)}/reset`, "POST");
      if (!this.players.has(id) || this.stopped || generation !== this.generation || revision !== this.playerRevisions.get(id)) return;
      await this.call(`/players/${encodeURIComponent(id)}/play`, "POST", this.playBody(id, file));
      this.playedGeneration.set(id, generation);
    }
    this.deliveryErrors.delete(id);
    this.notifyStreamUrl(id, this.streamUrl(id));
  }

  private playBody(id: string, file: string): { file: string; mode: "interrupt"; offsetSeconds?: number } {
    const startedAt = this.participantStartedAt.has(id) ? this.participantStartedAt.get(id) : this.phaseStartedAt;
    return { file, mode: "interrupt", ...(startedAt === undefined ? {} : { offsetSeconds: Math.max(0, this.now() - startedAt) / 1000 }) };
  }

  async call(path: string, method = "GET", body?: unknown): Promise<any> {
    const response = await this.request(`${this.config.url.replace(/\/$/, "")}${path}`, {
      method, headers: { Authorization: `Bearer ${this.config.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Audio bridge ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  }

  private failed(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    this.report(error);
  }

  start(): void {
    this.timer = setInterval(() => {
      void this.reconcile().catch((error: unknown) => this.failed(error));
    }, 5_000);
    this.timer.unref();
  }

  async register(participant: AudioParticipant): Promise<string> {
    if (this.stopped) throw new Error("Audio is shutting down");
    this.players.set(participant.clientId, participant);
    const id = participant.clientId;
    const registered = this.work.then(async () => {
      if (!this.players.has(id) || this.stopped) return;
      await this.releasePending(id);
      this.observeSourceEpoch(id, await this.call(`/players/${encodeURIComponent(id)}/active`, "PUT", { active: true }));
      const generation = this.generation;
      const revision = this.playerRevisions.get(id);
      const src = this.currentAudioByPlayer.has(id)
        ? this.currentAudioByPlayer.get(id)
        : this.sourceForPlayer(id) ?? this.currentAudioSrc;
      if (!src || this.playedGeneration.get(id) === generation) return;
      const file = await this.upload(src);
      if (!this.players.has(id) || this.stopped || generation !== this.generation || revision !== this.playerRevisions.get(id)) return;
      await this.call(`/players/${encodeURIComponent(id)}/reset`, "POST");
      if (!this.players.has(id) || this.stopped || generation !== this.generation || revision !== this.playerRevisions.get(id)) return;
      await this.call(`/players/${encodeURIComponent(id)}/play`, "POST", this.playBody(id, file));
      this.playedGeneration.set(id, generation);
      this.deliveryErrors.delete(id);
    });
    this.work = registered.catch((error: unknown) => {
      this.deliveryErrors.set(id, error instanceof Error ? error.message : String(error));
      this.failed(error);
    });
    await registered;
    return this.streamUrl(participant.clientId);
  }

  /** Client-reported playback-state transition, aggregated for `status()`. */
  recordEvent(id: string, state: PlaybackState, clientAt: number): void {
    if (!this.players.has(id)) return;
    const previous = this.telemetry.get(id);
    if (previous && clientAt < previous.clientAt) return; // Out-of-order delivery.
    const reconnects = (previous?.reconnects ?? 0) + (state === "reconnecting" && previous?.state !== "reconnecting" ? 1 : 0);
    const reconnectedAt = state === "reconnecting" && previous?.state !== "reconnecting"
      ? clientAt : previous?.reconnectedAt ?? null;
    const recovered = state === "playing" && reconnectedAt !== null;
    const lastRecoveryMs = recovered ? Math.max(0, clientAt - reconnectedAt!) : previous?.lastRecoveryMs ?? null;
    this.telemetry.set(id, { state, clientAt, receivedAt: Date.now(), reconnectedAt: recovered ? null : reconnectedAt, reconnects, lastRecoveryMs });
  }

  private async reconcile(): Promise<void> {
    if (this.reconciling || this.stopped) return;
    this.reconciling = true;
    try {
      const cleanup = this.work.then(() => this.releaseAllPending());
      this.work = cleanup.catch((error: unknown) => this.failed(error));
      await cleanup;
      await Promise.all([...this.players.values()].map(async (player) => {
        const generation = this.generation;
        const id = player.clientId;
        try {
          // Heartbeats allocate remote slots too. Serialize them with release
          // so a delayed /active can never recreate an already-released slot.
          const active = this.work.then(async () => {
            if (this.stopped || generation !== this.generation || !this.players.has(id)) return;
            await this.releasePending(id);
            const response = await this.call(`/players/${encodeURIComponent(id)}/active`, "PUT", { active: true });
            if (generation === this.generation && this.players.has(id)) this.observeSourceEpoch(id, response);
          });
          this.work = active.catch((error: unknown) => this.failed(error));
          await active;
          if (!this.stopped && generation === this.generation && this.players.has(id) && this.deliveryErrors.has(id)) {
            await this.refreshParticipant(id);
          }
        } catch (error) { this.failed(error); }
      }));
      if (this.restoreMusic && !this.stopped) {
        await this.setMusic(this.music?.src ?? null, this.music?.volume ?? 0.2);
        this.restoreMusic = false;
      }
    } finally { this.reconciling = false; }
  }

  // Janus's independent bridge reports source recreation. Icecast responses
  // omit this field and retain their existing behavior.
  private observeSourceEpoch(id: string, response: { sourceEpoch?: unknown }): void {
    if (typeof response.sourceEpoch !== "string") return;
    const previous = this.sourceEpochs.get(id);
    this.sourceEpochs.set(id, response.sourceEpoch);
    // The mixer may have restarted while there were no participants to poll.
    if (previous === undefined && this.music) this.restoreMusic = true;
    if (previous !== undefined && previous !== response.sourceEpoch) {
      this.playedGeneration.delete(id);
      this.uploaded.clear();
      this.deliveryErrors.set(id, "Audio source restarted; restoring current cue");
      this.restoreMusic = true;
    }
  }

  private async releasePending(id: string): Promise<void> {
    if (!this.pendingReleases.has(id)) return;
    await this.call(`/players/${encodeURIComponent(id)}`, "DELETE");
    this.pendingReleases.delete(id);
  }

  private async releaseAllPending(): Promise<void> {
    const results = await Promise.allSettled([...this.pendingReleases].map(id => this.releasePending(id)));
    for (const result of results) if (result.status === "rejected") this.failed(result.reason);
  }

  async unregister(id: string): Promise<void> {
    this.players.delete(id);
    this.playedGeneration.delete(id);
    this.deliveryErrors.delete(id);
    this.telemetry.delete(id);
    this.sourceEpochs.delete(id);
    this.pendingReleases.add(id);
    const task = this.work.then(() => this.releasePending(id));
    this.work = task.catch((error: unknown) => this.failed(error));
    await task;
  }

  private upload(src: string): Promise<string> {
    const existing = this.uploaded.get(src);
    if (existing) return existing;
    const task = (async () => {
      // Resolve symlinks as well as '..': a scenario cannot upload arbitrary files.
      const root = await realpath(this.mediaDir);
      const path = await realpath(resolve(root, src));
      const rel = relative(root, path);
      if (rel.startsWith("..") || isAbsolute(rel) || !/\.mp3$/i.test(path)) throw new Error("Phone audio must be an MP3 inside the media directory");
      const bytes = await readFile(path);
      const file = `${createHash("sha256").update(bytes).digest("hex")}.mp3`;
      const response = await this.request(`${this.config.url.replace(/\/$/, "")}/audio/${file}`, {
        method: "PUT", headers: { Authorization: `Bearer ${this.config.token}`, "Content-Type": "audio/mpeg" },
        body: bytes, signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Audio upload failed: HTTP ${response.status}`);
      return file;
    })();
    this.uploaded.set(src, task);
    void task.catch(() => this.uploaded.delete(src));
    return task;
  }

  prepare(phases: readonly Phase[]): void {
    for (const phase of phases) {
      const sources = phase.kind === "idle" || (phase.kind === "video" && phase.phoneAudioMode === "synchronized") ? []
        : phase.kind === "group-branch"
          ? phase.branches.flatMap((branch) => branch.phoneAudioSrc ? [branch.phoneAudioSrc] : [])
          : [...(phase.phoneAudioSrc ? [phase.phoneAudioSrc] : []), ...Object.values(phase.phoneAudioByGroup ?? {})];
      for (const src of sources) void this.upload(src).catch((error: unknown) => this.failed(error));
    }
  }

  transition(phase: Phase, groupFor: (participantId: string) => string | null = () => null, startedAt?: number): void {
    this.phaseStartedAt = startedAt;
    this.participantStartedAt.clear();
    this.phaseOverrides.clear();
    this.deliveryErrors.clear();
    const generation = ++this.generation;
    this.currentAudioSrc = phase.kind === "idle" || phase.kind === "group-branch" || (phase.kind === "video" && phase.phoneAudioMode === "synchronized") ? undefined : phase.phoneAudioSrc;
    this.sourceForPlayer = (id) => {
      const groupId = groupFor(id);
      const localPhase = this.phaseOverrides.get(id) ?? phase;
      return localPhase.kind === "idle" || (localPhase.kind === "video" && localPhase.phoneAudioMode === "synchronized") ? undefined
        : localPhase.kind === "group-branch"
          ? localPhase.branches.find((branch) => branch.groupId === groupId)?.phoneAudioSrc
          : (groupId === null ? undefined : localPhase.phoneAudioByGroup?.[groupId]) ?? localPhase.phoneAudioSrc;
    };
    this.currentAudioByPlayer = new Map([...this.players.keys()].map((id) => [id, this.sourceForPlayer(id)]));
    this.work = this.work.then(async () => {
      if (generation !== this.generation || this.stopped) return;
      await Promise.all([...this.players.keys()].map(async (id) => {
        try {
          const revision = this.playerRevisions.get(id);
          const src = this.currentAudioByPlayer.get(id);
          const file = src ? await this.upload(src) : undefined;
          if (generation !== this.generation || this.stopped || revision !== this.playerRevisions.get(id)) return;
          // Reset on every transition, including silent scenes and manual skips.
          await this.call(`/players/${encodeURIComponent(id)}/reset`, "POST");
          if (generation !== this.generation || this.stopped || revision !== this.playerRevisions.get(id) || !this.players.has(id)) return;
          if (file) {
            await this.call(`/players/${encodeURIComponent(id)}/play`, "POST", this.playBody(id, file));
            this.playedGeneration.set(id, generation);
          }
          this.deliveryErrors.delete(id);
        } catch (error) {
          if (generation === this.generation) this.deliveryErrors.set(id, error instanceof Error ? error.message : String(error));
          this.failed(error);
        }
      }));
      if (!this.deliveryErrors.size) this.lastError = null;
    }).catch((error: unknown) => this.failed(error));
  }

  /** Immediately retarget one connected phone after a live group reassignment. */
  async refreshParticipant(id: string): Promise<void> {
    if (!this.players.has(id) || this.stopped) return;
    const generation = this.generation;
    const revision = (this.playerRevisions.get(id) ?? 0) + 1;
    this.playerRevisions.set(id, revision);
    const src = this.sourceForPlayer(id);
    this.currentAudioByPlayer.set(id, src);
    const refreshed = this.work.then(async () => {
      if (!this.players.has(id) || this.stopped || generation !== this.generation || revision !== this.playerRevisions.get(id)) return;
      const file = src ? await this.upload(src) : undefined;
      if (!this.players.has(id) || this.stopped || generation !== this.generation || revision !== this.playerRevisions.get(id)) return;
      await this.call(`/players/${encodeURIComponent(id)}/reset`, "POST");
      if (!this.players.has(id) || this.stopped || generation !== this.generation || revision !== this.playerRevisions.get(id)) return;
      if (file) {
        await this.call(`/players/${encodeURIComponent(id)}/play`, "POST", this.playBody(id, file));
        this.playedGeneration.set(id, generation);
      }
      this.deliveryErrors.delete(id);
      this.notifyStreamUrl(id, this.streamUrl(id));
      if (!this.deliveryErrors.size) this.lastError = null;
    });
    this.work = refreshed.catch((error: unknown) => {
      if (generation === this.generation && revision === this.playerRevisions.get(id)) {
        this.deliveryErrors.set(id, error instanceof Error ? error.message : String(error));
      }
      this.failed(error);
    });
    await refreshed;
  }

  /** A local path advances without resetting any other group's stream. */
  transitionParticipants(ids: readonly string[], phase: Phase, startedAt?: number): void {
    for (const id of ids) {
      this.phaseOverrides.set(id, phase);
      this.participantStartedAt.set(id, startedAt);
      void this.refreshParticipant(id).catch(() => { /* refreshParticipant reports errors via work. */ });
    }
  }

  /** Play an authored MP3 immediately for rehearsal without changing show state. */
  async soundcheck(src: string, participantId?: string): Promise<number> {
    const ids = participantId === undefined ? [...this.players.keys()] : [participantId];
    if (ids.some((id) => !this.players.has(id))) throw new Error("Audio participant is not registered");
    const file = await this.upload(src);
    await Promise.all(ids.map(async (id) => {
      await this.call(`/players/${encodeURIComponent(id)}/reset`, "POST");
      await this.call(`/players/${encodeURIComponent(id)}/play`, "POST", { file, mode: "interrupt" });
    }));
    this.lastError = null;
    return ids.length;
  }

  /** Stop rehearsal playback for one phone or the whole registered roster. */
  async stopSoundcheck(participantId?: string): Promise<number> {
    const ids = participantId === undefined ? [...this.players.keys()] : [participantId];
    if (ids.some((id) => !this.players.has(id))) throw new Error("Audio participant is not registered");
    await Promise.all(ids.map((id) => this.call(`/players/${encodeURIComponent(id)}/reset`, "POST")));
    this.lastError = null;
    return ids.length;
  }

  async status(): Promise<unknown> {
    try {
      const status = await this.call("/status");
      return { ...status, configured: true, error: this.lastError,
        backend: this.active.kind, backendLabel: this.active.label,
        deliveryFailures: Object.fromEntries(this.deliveryErrors),
        players: (status.players ?? []).filter((p: { player_id: string }) => this.players.has(p.player_id))
          .map((p: { player_id: string }) => ({ ...p, name: this.players.get(p.player_id)?.name,
            ...(this.telemetry.get(p.player_id) ? {
              playbackState: this.telemetry.get(p.player_id)!.state,
              phoneReportAgeMs: Math.max(0, Date.now() - this.telemetry.get(p.player_id)!.receivedAt),
              reconnects: this.telemetry.get(p.player_id)!.reconnects,
              lastRecoveryMs: this.telemetry.get(p.player_id)!.lastRecoveryMs,
            } : {}) })) };
    } catch (error) {
      this.failed(error);
      return { configured: true, error: this.lastError, backend: this.active.kind, backendLabel: this.active.label,
        deliveryFailures: Object.fromEntries(this.deliveryErrors), players: [] };
    }
  }

  endSession(): void {
    ++this.generation;
    this.currentAudioSrc = undefined;
    this.currentAudioByPlayer.clear();
    this.phaseOverrides.clear();
    this.phaseStartedAt = undefined;
    this.participantStartedAt.clear();
    this.playerRevisions.clear();
    this.sourceForPlayer = () => undefined;
    const ids = [...this.players.keys()];
    this.players.clear();
    this.playedGeneration.clear();
    this.deliveryErrors.clear();
    this.telemetry.clear();
    this.sourceEpochs.clear();
    for (const id of ids) this.pendingReleases.add(id);
    this.work = this.work.then(() => this.releaseAllPending()).catch((error: unknown) => this.failed(error));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    this.endSession();
    await this.work;
  }
}
