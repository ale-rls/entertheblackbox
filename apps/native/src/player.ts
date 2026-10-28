import AudioScheduler, { type LayerTiming } from '@entertheblackbox/expo-audio-scheduler';
import type { ClockTiming } from '@entertheblackbox/protocol';
import type { ServerClock } from '@entertheblackbox/shared';
import type { ShowManifest } from '@entertheblackbox/show-content';
import { localAudio } from './content';
import type { Cue } from './cues';

const CUE = 'cue';
const BED = 'bed';
type MediaTiming = ClockTiming['media'][number];

/**
 * Maps show cues onto native scheduler layers. Native code starts, offsets and stops
 * the audio on the server clock, so playback keeps working while JavaScript timers
 * are frozen (Android) or throttled (iOS) behind a locked screen.
 */
export class ShowPlayer {
  private bedUri: string | null = null;
  private musicStarted = false;
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
      this.report(paused ? 'Paused — use Resume at show position' : 'Playing');
    });
    // Foreground housekeeping only: keeps the native clock calibrated and the status line
    // current. Playback never waits on it.
    this.timer = setInterval(() => this.sync(), 500);
  }
  static async configure() {
    await AudioScheduler.configure({ title: 'Enter the Blackbox', artist: 'Show audio' });
  }
  private report(status: string) { if (status !== this.status) { this.status = status; this.changed(status); } }
  private fail(error: unknown) { if (!this.disposed) this.report(`Playback error: ${String(error)}`); }
  startMusic() {
    // Admission/reconnection must not override an explicit participant pause; the native
    // scheduler keeps new layers paused until resume.
    if (this.musicStarted || !this.bedUri || this.disposed) return;
    this.musicStarted = true;
    AudioScheduler.setLayer(BED, { uri: this.bedUri, loop: true, volume: this.manifest.backgroundMusic!.volume })
      .catch(error => this.fail(error));
  }
  setCue(cue: Cue | null) {
    if (this.cue?.key === cue?.key && this.cue?.endsAt === cue?.endsAt) return;
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
    AudioScheduler.clearLayer(CUE).catch(error => this.fail(error));
    this.report(status);
  }
  private applyCue() {
    const cue = this.cue;
    if (!cue || !this.cueUri || this.cueApplied || this.disposed) return;
    // Wait for a measured offset; the snapshot-only estimate can be off by the network delay.
    if (!this.clock.hasSamples) { this.report('Waiting for clock'); return; }
    this.cueApplied = true;
    AudioScheduler.setClock(this.clock.now());
    AudioScheduler.setLayer(CUE, { uri: this.cueUri, startAt: cue.startedAt, endAt: cue.endsAt })
      .catch(error => this.fail(error));
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
  dispose() {
    this.disposed = true; clearInterval(this.timer); this.subscription.remove();
    AudioScheduler.reset().catch(() => {});
  }
}
