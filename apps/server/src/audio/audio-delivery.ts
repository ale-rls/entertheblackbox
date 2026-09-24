import type { Phase } from '@entertheblackbox/scenario';
import { PersonalAudio, type AudioConfig, type AudioParticipant, type AudioBackend, type PlaybackState } from './personal-audio.js';

export type AudioTransport = 'icecast' | 'janus';
export type JanusConfig = AudioConfig & { iceServers: RTCIceServerConfig[] };
type RTCIceServerConfig = { urls: string | string[]; username?: string | undefined; credential?: string | undefined };

/** One authoritative show, independent delivery rosters and transports. */
export class AudioDelivery {
  readonly icecast: PersonalAudio | null;
  readonly janus: PersonalAudio | null;
  private generation = 0;
  private registrations = new Map<string, Promise<unknown>>();
  private selected = new Map<string, AudioTransport>();

  constructor(config: { audio?: AudioConfig; janusAudio?: JanusConfig; mediaDir: string }, report: (error: unknown) => void,
    notify: (id: string, url: string) => void = () => {}, request: typeof fetch = fetch) {
    this.icecast = config.audio ? new PersonalAudio(config.audio, config.mediaDir, report, request, notify) : null;
    this.janus = config.janusAudio ? new PersonalAudio(config.janusAudio, config.mediaDir, report, request) : null;
    this.janusConfig = config.janusAudio;
  }
  private janusConfig: JanusConfig | undefined;
  private get all() { return [this.icecast, this.janus].filter((x): x is PersonalAudio => x !== null); }
  get configured() { return this.all.length > 0; }
  get backgroundMusic() { return this.all[0]?.backgroundMusic ?? null; }
  start() { this.all.forEach(x => x.start()); }
  prepare(phases: readonly Phase[]) { this.all.forEach(x => x.prepare(phases)); }
  transition(phase: Phase, groups: (id: string) => string | null, startedAt?: number) {
    this.all.forEach(x => x.transition(phase, groups, startedAt));
  }
  transitionParticipants(ids: readonly string[], phase: Phase, startedAt?: number) {
    this.all.forEach(x => x.transitionParticipants(ids, phase, startedAt));
  }
  async register(participant: AudioParticipant, transport: AudioTransport, recover = false) {
    const backend = this[transport];
    if (!backend) throw new Error('Audio transport is not configured');
    const id = participant.clientId;
    const generation = this.generation;
    const task = (this.registrations.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (generation !== this.generation) throw new Error("Audio session ended");
      const previous = this.selected.get(id);
      if (previous && previous !== transport) await this[previous]?.unregister(id);
      if (generation !== this.generation) throw new Error("Audio session ended");
      this.selected.set(id, transport);
      const streamUrl = await backend.register(participant);
      // A failed WebRTC transport rejoins the current scene, never old buffered speech.
      if (recover && transport === 'janus') await backend.refreshParticipant(id);
      if (generation !== this.generation) throw new Error("Audio session ended");
      if (transport === 'icecast') return { streamUrl };
      const credentials = await backend.call(`/players/${encodeURIComponent(id)}/listen`);
      if (generation !== this.generation) throw new Error("Audio session ended");
      if (!Number.isSafeInteger(credentials.mountpoint) || typeof credentials.pin !== 'string') throw new Error('Invalid Janus registration');
      return { janus: { server: `${this.janusConfig!.publicUrl.replace(/\/$/, '')}/janus`,
        mountpoint: credentials.mountpoint, pin: credentials.pin, iceServers: this.janusConfig!.iceServers } };
    });
    this.registrations.set(id, task);
    try { return await task; }
    finally { if (this.registrations.get(id) === task) this.registrations.delete(id); }
  }
  recordEvent(id: string, state: PlaybackState, at: number, transport: AudioTransport) {
    if (this.selected.get(id) === transport) this[transport]?.recordEvent(id, state, at);
  }
  async setMusic(src: string | null, volume: number) { await Promise.all(this.all.map(x => x.setMusic(src, volume))); }
  async soundcheck(src: string, id?: string) {
    const targets = id ? [this[this.selected.get(id) ?? 'icecast']].filter((x): x is PersonalAudio => x !== null) : this.all;
    return (await Promise.all(targets.map(x => x.soundcheck(src, id)))).reduce((a, b) => a + b, 0);
  }
  async stopSoundcheck(id?: string) {
    const targets = id ? [this[this.selected.get(id) ?? 'icecast']].filter((x): x is PersonalAudio => x !== null) : this.all;
    return (await Promise.all(targets.map(x => x.stopSoundcheck(id)))).reduce((a, b) => a + b, 0);
  }
  setBackend(target: AudioBackend) {
    return this.icecast?.setBackend(target) ?? Promise.resolve({ ok: false as const, error: 'Icecast is not configured' });
  }
  async status() {
    const entries = await Promise.all((['icecast', 'janus'] as const).flatMap(transport =>
      this[transport] ? [this[transport]!.status().then(status => ({ transport, status: status as Record<string, any> }))] : []));
    if (!entries.length) return { configured: false, players: [] };
    const capacities = entries.map(x => x.status.capacity).filter(Boolean);
    const pollAges = entries.map(x => x.status.poll_age_s);
    return { ...entries[0]!.status,
      backendLabel: entries.map(x => x.transport === 'janus' ? 'Janus' : `Icecast (${x.status.backendLabel ?? 'Remote'})`).join(' + '),
      poll_age_s: pollAges.every(x => typeof x === 'number') ? Math.max(...pollAges) : null,
      ...(capacities.length ? { capacity: { total: capacities.reduce((n, x) => n + x.total, 0), assigned: capacities.reduce((n, x) => n + x.assigned, 0), available: capacities.reduce((n, x) => n + x.available, 0) } } : {}),
      error: entries.map(x => x.status.error ? `${x.transport}: ${x.status.error}` : '').filter(Boolean).join('; ') || null,
      deliveryFailures: Object.assign({}, ...entries.map(x => x.status.deliveryFailures)),
      players: entries.flatMap(({ transport, status }) => (status.players ?? []).map((p: object) => ({ ...p, transport }))),
      transports: Object.fromEntries(entries.map(x => [x.transport, x.status])),
    };
  }
  endSession() { ++this.generation; this.selected.clear(); this.all.forEach(x => x.endSession()); }
  async stop() { ++this.generation; await Promise.all(this.all.map(x => x.stop())); }
}
