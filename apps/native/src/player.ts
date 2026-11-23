import { admissionLayers } from './admission-program';
import type { ServerToClientMessage } from '@entertheblackbox/protocol';
import AudioScheduler, { type LayerTiming } from '@entertheblackbox/expo-audio-scheduler';
import type { ClockTiming } from '@entertheblackbox/protocol';
import type { ServerClock } from '@entertheblackbox/shared';
import type { ShowManifest } from '@entertheblackbox/show-content';
import { localAudio } from './content';
import type { Cue } from './cues';

const CUE = 'cue';
const BED = 'bed';
/**
 * Audio removed while still audible (a skip, the show starting during the admission loop, a
 * handover) fades out over this long instead of cutting. The native scheduler releases layers
 * that have already finished at once, so natural ends are unaffected.
 */
export const SKIP_FADE_MS = 3000;
type MediaTiming = ClockTiming['media'][number];
/** Scene music the server says plays now; null = silent. */
export type SceneMusic = { src: string; volume?: number } | null;
/** Volume of scene music when neither the scene nor the show sets one. */
export const SCENE_MUSIC_VOLUME = 0.7;
const isMusicLayer = (id: string) => id === BED || id.startsWith(`${BED}:`);

/**
 * Maps show cues onto native scheduler layers. Native code starts, offsets and stops
 * the audio on the server clock, so playback keeps working while JavaScript timers
 * are frozen (Android) or throttled (iOS) behind a locked screen.
 */
/** How long to wait before installing a cue again after the native scheduler refused it. */
const CUE_RETRY_MS = 2_000;

export class ShowPlayer {
  private static disposal: Promise<void> = Promise.resolve();
  private admissionKey = '';
  private admissionIds: string[] = [];
  private audioQueue: Promise<void> = Promise.resolve();
  private queue(work: () => Promise<void>) { this.audioQueue = this.audioQueue.then(async () => { if (!this.disposed) await work(); }).catch(error => this.fail(error)); }
  setAdmission(state: Extract<ServerToClientMessage, { t: 'admission_state' }> | null) {
    const key = state?.active && state.program ? `${state.generation}:${state.revision}:${state.anchor}:${state.program.groupId}` : '';
    if (key === this.admissionKey) return;
    this.admissionKey = key;
    this.queue(async () => {
      for (const id of this.admissionIds) await AudioScheduler.fadeOutLayer(id, SKIP_FADE_MS);
      this.admissionIds = [];
      if (!state?.active || !state.program || state.anchor === null || state.scenarioVersion !== this.manifest.scenarioVersion) return;
      AudioScheduler.setClock(this.clock.now());
      const layers = admissionLayers(state.program, state.anchor).map(layer => {
        const file = this.manifest.files.find(f => f.src === layer.src);
        if (!file || !localAudio(file.sha256).exists) throw new Error(`Missing admission audio: ${layer.src}`);
        return { ...layer, uri: localAudio(file.sha256).uri };
      });
      for (const { id, src: _, ...layer } of layers) { this.admissionIds.push(id); await AudioScheduler.setLayer(id, layer); }
    });
  }
  private bedUri: string | null = null;
  private musicStarted = false;
  /** Set once the server sends scene music: the show-wide bed then stays off. */
  private sceneMusicMode = false;
  private sceneMusic: SceneMusic = null;
  /** Layer id of the scene music now installed (one per track, so a change can crossfade). */
  private sceneLayer: string | null = null;
  /** Participant's music volume (0–1); null follows the published show default. */
  private musicVolume: number | null = null;
  private cue: Cue | null = null;
  private cueUri: string | null = null;
  private cueApplied = false;
  private installedCue: Cue | null = null;
  /** After a failed install, the earliest time housekeeping tries the same cue again. */
  private cueRetryAt = 0;
  private enabled = true;
  private disposed = false;
  private status = 'Ready';
  private timer: ReturnType<typeof setInterval>;
  private subscription: { remove(): void };
  constructor(private manifest: ShowManifest, private clock: ServerClock, private changed: (status: string) => void) {
    const bed = manifest.backgroundMusic;
    if (bed) {
      const file = manifest.files.find(f => f.src === bed.src);
      if (!file || !localAudio(file.sha256).exists) throw new Error(`Missing downloaded background music: ${bed.src}`);
      this.bedUri = localAudio(file.sha256).uri;
    }
    this.subscription = AudioScheduler.addListener('onPausedChange', ({ paused, reason }) => {
      // Lock-screen controls, calls and unplugged headphones act natively; mirror them here.
      if (this.disposed || reason === 'api') return;
      this.enabled = !paused;
      this.report(paused ? 'Paused — use Resume at show position' : 'Waiting for playback status');
    });
    // Foreground housekeeping only: keeps the native clock calibrated and the status line
    // current. Playback never waits on it.
    this.timer = setInterval(() => this.sync(), 500);
  }
  static async configure() {
    await ShowPlayer.disposal;
    await AudioScheduler.configure({ title: 'Enter the Blackbox', artist: 'Show audio' });
  }
  private report(status: string) { if (status !== this.status) { this.status = status; this.changed(status); } }
  private fail(error: unknown) { if (!this.disposed) this.report(`Playback error: ${String(error)}`); }
  startMusic() {
    // Admission/reconnection must not override an explicit participant pause; the native
    // scheduler keeps new layers paused until resume.
    // Start even without a show-wide bed: scene music usually arrives after the join, and it only
    // plays once music has been started.
    if (this.musicStarted || this.disposed) return;
    this.musicStarted = true;
    if (this.sceneMusicMode) this.applySceneMusic(); else this.applyMusic();
  }
  /**
   * Follows the show's scene music: a new track fades the old one out and starts looping, null
   * fades the music out. The first call retires the show-wide bed for this show.
   */
  setSceneMusic(music: SceneMusic) {
    const first = !this.sceneMusicMode;
    if (!first && this.sceneMusic?.src === music?.src && this.sceneMusic?.volume === music?.volume) return;
    this.sceneMusicMode = true;
    this.sceneMusic = music;
    if (first && this.musicStarted && this.bedUri) this.queue(() => AudioScheduler.fadeOutLayer(BED, SKIP_FADE_MS));
    if (this.musicStarted) this.applySceneMusic();
  }
  private applySceneMusic() {
    if (this.disposed) return;
    const music = this.sceneMusic;
    const id = music ? `${BED}:${music.src}` : null;
    if (this.sceneLayer && this.sceneLayer !== id) { const old = this.sceneLayer; this.queue(() => AudioScheduler.fadeOutLayer(old, SKIP_FADE_MS)); }
    this.sceneLayer = null;
    if (!music || !id) return;
    const file = this.manifest.files.find(f => f.src === music.src);
    if (!file || !localAudio(file.sha256).exists) { this.report(`Missing downloaded music: ${music.src}`); return; }
    this.sceneLayer = id;
    const uri = localAudio(file.sha256).uri;
    const volume = this.musicVolume ?? music.volume ?? this.manifest.backgroundMusic?.volume ?? SCENE_MUSIC_VOLUME;
    this.queue(() => AudioScheduler.setLayer(id, { uri, loop: true, volume }));
  }
  /** Sets the participant's background-music volume (null = show default); applies live without restarting the loop. */
  setMusicVolume(volume: number | null) {
    const next = volume === null ? null : Math.min(1, Math.max(0, volume));
    if (next === this.musicVolume) return;
    this.musicVolume = next;
    if (this.musicStarted) { if (this.sceneMusicMode) this.applySceneMusic(); else this.applyMusic(); }
  }
  private applyMusic() {
    if (!this.bedUri || this.disposed) return;
    const volume = this.musicVolume ?? this.manifest.backgroundMusic!.volume;
    AudioScheduler.setLayer(BED, { uri: this.bedUri, loop: true, volume }).catch(error => this.fail(error));
  }
  setCue(cue: Cue | null) {
    if (this.cue?.key === cue?.key && this.cue?.endsAt === cue?.endsAt) return;
    // A different cue replaces the layer: let the outgoing one fade. The same cue with a new end
    // is only retimed by the scheduler, without restarting or fading.
    if (this.cueApplied && this.cue?.key !== cue?.key) this.queue(() => AudioScheduler.fadeOutLayer(CUE, SKIP_FADE_MS));
    this.cue = null; this.cueUri = null; this.cueApplied = false; this.installedCue = null; this.cueRetryAt = 0;
    if (!cue) { this.clearCue('Waiting for the next cue'); return; }
    if (cue.scenarioVersion !== this.manifest.scenarioVersion) {
      this.clearCue('Show changed — leave and download the matching show'); return;
    }
    const file = this.manifest.files.find(f => f.src === cue.src);
    if (!file || !localAudio(file.sha256).exists) { this.clearCue(`Missing downloaded audio: ${cue.src}`); return; }
    this.cue = cue; this.cueUri = localAudio(file.sha256).uri;
    this.applyCue();
  }
  private clearCue(status: string) {
    this.queue(() => AudioScheduler.fadeOutLayer(CUE, SKIP_FADE_MS));
    this.report(status);
  }
  private applyCue() {
    const cue = this.cue;
    if (!cue || !this.cueUri || this.cueApplied || this.disposed || Date.now() < this.cueRetryAt) return;
    // Wait for a measured offset; the snapshot-only estimate can be off by the network delay.
    if (!this.clock.hasSamples) { this.report('Waiting for clock'); return; }
    this.cueApplied = true;
    AudioScheduler.setClock(this.clock.now());
    const uri = this.cueUri;
    this.queue(async () => {
      try {
        await AudioScheduler.setLayer(CUE, { uri, startAt: cue.startedAt, endAt: cue.endsAt });
        if (this.cue === cue) this.installedCue = cue;
      } catch (error) {
        // Preserve install recovery without publishing an outgoing layer as the new cue.
        if (this.cue === cue) { this.installedCue = null; this.cueApplied = false; this.cueRetryAt = Date.now() + CUE_RETRY_MS; }
        throw error;
      }
    });
    this.report(this.enabled ? 'Scheduled' : 'Paused on this device');
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    (enabled ? AudioScheduler.resume() : AudioScheduler.pause()).catch(error => this.fail(error));
    // Resume is the participant's "try again": retry a cue whose install failed right away.
    if (enabled && !this.cueApplied) { this.cueRetryAt = 0; this.applyCue(); }
    if (!enabled) this.report('Paused on this device');
  }
  private sync() {
    if (this.disposed) return;
    if (this.clock.hasSamples) AudioScheduler.setClock(this.clock.now());
    this.applyCue();
    const cue = this.cueApplied ? AudioScheduler.getTiming().find(layer => layer.id === CUE) : undefined;
    if (!cue || !this.enabled) return;
    const status = { waiting: 'Waiting for cue time', loading: 'Loading', playing: 'Playing', paused: null,
      ended: 'Cue ended', error: `Playback error: ${cue.error ?? 'unknown'}` }[cue.state];
    if (status) this.report(status);
  }
  isPaused(): boolean { return !this.enabled; }
  timing(): ClockTiming {
    // iOS records omit nil fields; the ping schema requires explicit nulls.
    const media = (role: MediaTiming['role'], layer: LayerTiming | undefined): MediaTiming[] => layer ? [{ role,
      ...(role === 'main' && this.installedCue ? { src: this.installedCue.src, endsAt: this.installedCue.endsAt, durationMs: layer.durationMs ?? null } : {}),
      positionMs: layer.positionMs ?? null, targetMs: layer.targetMs ?? null, driftMs: layer.driftMs ?? null,
      state: !this.enabled && layer.state !== 'error' ? 'paused' : layer.state }] : [];
    const layers = AudioScheduler.getTiming();
    return { calibrated: this.clock.hasSamples, offsetMs: this.clock.offset,
      roundTripMs: this.clock.roundTripMs, sampleAgeMs: this.clock.sampleAgeMs(),
      elapsedMs: this.cue ? this.clock.now() - this.cue.startedAt : 0, mode: 'synchronized',
      media: [...media('main', this.installedCue ? layers.find(l => l.id === CUE) : undefined), ...media('extra', layers.find(l => isMusicLayer(l.id)))] };
  }
  settled() { return this.audioQueue; }
  dispose() {
    if (this.disposed) return ShowPlayer.disposal;
    this.disposed = true; clearInterval(this.timer); this.subscription.remove();
    ShowPlayer.disposal = this.audioQueue.then(() => AudioScheduler.reset()).catch(() => {});
    return ShowPlayer.disposal;
  }
}
