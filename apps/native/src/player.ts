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

/**
 * Maps show cues onto native scheduler layers. Native code starts, offsets and stops
 * the audio on the server clock, so playback keeps working while JavaScript timers
 * are frozen (Android) or throttled (iOS) behind a locked screen.
 */
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
  /** Participant's music volume (0–1); null follows the published show default. */
  private musicVolume: number | null = null;
  private cue: Cue | null = null;
  private cueUri: string | null = null;
  private cueApplied = false;
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
    if (this.musicStarted || !this.bedUri || this.disposed) return;
    this.musicStarted = true;
    this.applyMusic();
  }
  /** Sets the participant's background-music volume (null = show default); applies live without restarting the loop. */
  setMusicVolume(volume: number | null) {
    const next = volume === null ? null : Math.min(1, Math.max(0, volume));
    if (next === this.musicVolume) return;
    this.musicVolume = next;
    if (this.musicStarted) this.applyMusic();
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
    this.cue = null; this.cueUri = null; this.cueApplied = false;
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
    if (!cue || !this.cueUri || this.cueApplied || this.disposed) return;
    // Wait for a measured offset; the snapshot-only estimate can be off by the network delay.
    if (!this.clock.hasSamples) { this.report('Waiting for clock'); return; }
    this.cueApplied = true;
    AudioScheduler.setClock(this.clock.now());
    const uri = this.cueUri;
    this.queue(() => AudioScheduler.setLayer(CUE, { uri, startAt: cue.startedAt, endAt: cue.endsAt }));
    this.report(this.enabled ? 'Scheduled' : 'Paused on this device');
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    (enabled ? AudioScheduler.resume() : AudioScheduler.pause()).catch(error => this.fail(error));
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
      positionMs: layer.positionMs ?? null, targetMs: layer.targetMs ?? null, driftMs: layer.driftMs ?? null,
      state: !this.enabled && layer.state !== 'error' ? 'paused' : layer.state }] : [];
    const layers = AudioScheduler.getTiming();
    return { calibrated: this.clock.hasSamples, offsetMs: this.clock.offset,
      roundTripMs: this.clock.roundTripMs, sampleAgeMs: this.clock.sampleAgeMs(),
      elapsedMs: this.cue ? this.clock.now() - this.cue.startedAt : 0, mode: 'synchronized',
      media: [...media('main', layers.find(l => l.id === CUE)), ...media('extra', layers.find(l => l.id === BED))] };
  }
  settled() { return this.audioQueue; }
  dispose() {
    if (this.disposed) return ShowPlayer.disposal;
    this.disposed = true; clearInterval(this.timer); this.subscription.remove();
    ShowPlayer.disposal = this.audioQueue.then(() => AudioScheduler.reset()).catch(() => {});
    return ShowPlayer.disposal;
  }
}
