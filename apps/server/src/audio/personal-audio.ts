import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import type { Phase } from "@entertheblackbox/scenario";

export type AudioConfig = { url: string; token: string; publicUrl: string };
export type AudioParticipant = { clientId: string; name: string };

/** The delivery roster survives sleeping phones and their disconnected WebSockets. */
export class PersonalAudio {
  private readonly players = new Map<string, AudioParticipant>();
  private readonly uploaded = new Map<string, Promise<string>>();
  private generation = 0;
  private currentAudioSrc: string | undefined;
  private currentAudioByPlayer = new Map<string, string | undefined>();
  private sourceForPlayer: (participantId: string) => string | undefined = () => undefined;
  private readonly phaseOverrides = new Map<string, Phase>();
  private readonly playerRevisions = new Map<string, number>();
  private readonly playedGeneration = new Map<string, number>();
  private work: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastError: string | null = null;
  private stopped = false;

  constructor(readonly config: AudioConfig, private readonly mediaDir: string,
    private readonly report: (error: unknown) => void,
    private readonly request: typeof fetch = fetch) {}

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
      await this.call(`/players/${encodeURIComponent(id)}/active`, "PUT", { active: true });
      const generation = this.generation;
      const src = this.currentAudioByPlayer.has(id)
        ? this.currentAudioByPlayer.get(id)
        : this.sourceForPlayer(id) ?? this.currentAudioSrc;
      if (!src || this.playedGeneration.get(id) === generation) return;
      const file = await this.upload(src);
      if (!this.players.has(id) || this.stopped || generation !== this.generation) return;
      await this.call(`/players/${encodeURIComponent(id)}/reset`, "POST");
      await this.call(`/players/${encodeURIComponent(id)}/play`, "POST", { file, mode: "interrupt" });
      this.playedGeneration.set(id, generation);
    });
    this.work = registered.catch((error: unknown) => this.failed(error));
    await registered;
    return `${this.config.publicUrl.replace(/\/$/, "")}/stream/${encodeURIComponent(participant.clientId)}`;
  }

  private async reconcile(): Promise<void> {
    for (const player of this.players.values()) {
      if (this.stopped) return;
      await this.call(`/players/${encodeURIComponent(player.clientId)}/active`, "PUT", { active: true });
    }
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
      const sources = phase.kind === "idle" ? []
        : phase.kind === "group-branch"
          ? phase.branches.flatMap((branch) => branch.phoneAudioSrc ? [branch.phoneAudioSrc] : [])
          : [...(phase.phoneAudioSrc ? [phase.phoneAudioSrc] : []), ...Object.values(phase.phoneAudioByGroup ?? {})];
      for (const src of sources) void this.upload(src).catch((error: unknown) => this.failed(error));
    }
  }

  transition(phase: Phase, groupFor: (participantId: string) => string | null = () => null): void {
    this.phaseOverrides.clear();
    const generation = ++this.generation;
    this.currentAudioSrc = phase.kind === "idle" || phase.kind === "group-branch" ? undefined : phase.phoneAudioSrc;
    this.sourceForPlayer = (id) => {
      const groupId = groupFor(id);
      const localPhase = this.phaseOverrides.get(id) ?? phase;
      return localPhase.kind === "idle" ? undefined
        : localPhase.kind === "group-branch"
          ? localPhase.branches.find((branch) => branch.groupId === groupId)?.phoneAudioSrc
          : (groupId === null ? undefined : localPhase.phoneAudioByGroup?.[groupId]) ?? localPhase.phoneAudioSrc;
    };
    this.currentAudioByPlayer = new Map([...this.players.keys()].map((id) => [id, this.sourceForPlayer(id)]));
    this.work = this.work.then(async () => {
      if (generation !== this.generation || this.stopped) return;
      await Promise.all([...this.players.keys()].map(async (id) => {
        const src = this.currentAudioByPlayer.get(id);
        const file = src ? await this.upload(src) : undefined;
        if (generation !== this.generation || this.stopped) return;
        // Reset on every transition, including silent scenes and manual skips.
        await this.call(`/players/${encodeURIComponent(id)}/reset`, "POST");
        if (file && generation === this.generation && this.players.has(id)) {
          await this.call(`/players/${encodeURIComponent(id)}/play`, "POST", { file, mode: "interrupt" });
          this.playedGeneration.set(id, generation);
        }
      }));
      this.lastError = null;
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
      if (file) {
        await this.call(`/players/${encodeURIComponent(id)}/play`, "POST", { file, mode: "interrupt" });
        this.playedGeneration.set(id, generation);
      }
      this.lastError = null;
    });
    this.work = refreshed.catch((error: unknown) => this.failed(error));
    await refreshed;
  }

  /** A local path advances without resetting any other group's stream. */
  transitionParticipants(ids: readonly string[], phase: Phase): void {
    for (const id of ids) {
      this.phaseOverrides.set(id, phase);
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
      return { configured: true, error: this.lastError, ...status,
        players: (status.players ?? []).filter((p: { player_id: string }) => this.players.has(p.player_id))
          .map((p: { player_id: string }) => ({ ...p, name: this.players.get(p.player_id)?.name })) };
    } catch (error) {
      this.failed(error);
      return { configured: true, error: this.lastError, players: [] };
    }
  }

  endSession(): void {
    ++this.generation;
    this.currentAudioSrc = undefined;
    this.currentAudioByPlayer.clear();
    this.phaseOverrides.clear();
    this.playerRevisions.clear();
    this.sourceForPlayer = () => undefined;
    const ids = [...this.players.keys()];
    this.players.clear();
    this.playedGeneration.clear();
    this.work = this.work.then(async () => {
      for (const id of ids) await this.call(`/players/${encodeURIComponent(id)}`, "DELETE");
    }).catch((error: unknown) => this.failed(error));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    this.endSession();
    await this.work;
  }
}
