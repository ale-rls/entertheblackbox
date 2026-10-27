import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import type { ClockTiming } from '@entertheblackbox/protocol';
import type { ServerClock } from '@entertheblackbox/shared';
import type { ShowManifest } from '@entertheblackbox/show-content';
import { localAudio } from './content';
import { targetPosition, type Cue } from './cues';

export class ShowPlayer {
  private player: AudioPlayer;
  private cue: Cue | null = null;
  private timer: ReturnType<typeof setInterval>;
  private seeking = false;
  private generation = 0;
  private enabled = true;
  private started = false;
  private disposed = false;
  private status = 'Ready';
  constructor(private manifest: ShowManifest, private clock: ServerClock, private changed: (status: string) => void) {
    this.player = createAudioPlayer(null, { updateInterval: 250, keepAudioSessionActive: true });
    this.timer = setInterval(() => { void this.tick(); }, 250);
  }
  static async configure() {
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true,
      interruptionMode: 'doNotMix', allowsRecording: false });
  }
  private report(status: string) { if (status !== this.status) { this.status = status; this.changed(status); } }
  setCue(cue: Cue | null) {
    if (this.cue?.key === cue?.key && this.cue?.endsAt === cue?.endsAt) return;
    ++this.generation; this.player.pause(); this.cue = null; this.started = false;
    if (!cue) { this.report('Waiting for the next cue'); return; }
    if (cue.scenarioVersion !== this.manifest.scenarioVersion) {
      this.report('Show changed — leave and download the matching show'); return;
    }
    const file = this.manifest.files.find(f => f.src === cue.src);
    if (!file || !localAudio(file.sha256).exists) { this.report(`Missing downloaded audio: ${cue.src}`); return; }
    this.cue = cue;
    this.player.replace({ uri: localAudio(file.sha256).uri });
    this.player.setActiveForLockScreen(true, { title: 'Enter the Blackbox', artist: cue.src },
      { showSeekBackward: false, showSeekForward: false });
    this.report('Loading');
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) this.started = false;
    if (!enabled) { this.player.pause(); this.report('Paused on this device'); }
  }
  private async tick() {
    const cue = this.cue;
    if (this.disposed || !cue || !this.enabled || this.seeking || !this.clock.hasSamples) return;
    const target = targetPosition(cue, this.clock.now());
    if (target === null) { this.player.pause(); this.report(this.clock.now() < cue.startedAt ? 'Waiting for cue time' : 'Cue ended'); return; }
    if (!this.player.isLoaded) return;
    if (this.player.duration > 0 && target >= this.player.duration) { this.player.pause(); this.report('Cue ended'); return; }
    // Honor native lock-screen pauses and interruptions. Resume is an explicit user action.
    if (this.started && !this.player.playing) { this.report('Paused — use Resume at show position'); return; }
    const generation = this.generation;
    try {
      if (Math.abs(this.player.currentTime - target) > 0.25) {
        this.seeking = true;
        await this.player.seekTo(target);
        if (this.disposed || generation !== this.generation || !this.enabled) return;
      }
      if (!this.started) { this.player.play(); this.started = true; }
      this.report('Playing');
    } catch (error) { this.report(`Playback error: ${String(error)}`); }
    finally { this.seeking = false; }
  }
  timing(): ClockTiming {
    const target = this.cue ? targetPosition(this.cue, this.clock.now()) : null;
    const position = this.player.isLoaded ? this.player.currentTime * 1000 : null;
    return { calibrated: this.clock.hasSamples, offsetMs: this.clock.offset,
      roundTripMs: this.clock.roundTripMs, sampleAgeMs: this.clock.sampleAgeMs(),
      elapsedMs: this.cue ? this.clock.now() - this.cue.startedAt : 0, mode: 'synchronized',
      media: [{ role: 'main', positionMs: position, targetMs: target === null ? null : target * 1000,
        driftMs: position === null || target === null ? null : position - target * 1000,
        state: this.status.startsWith('Playback error') || this.status.startsWith('Missing') || this.status.startsWith('Show changed') ? 'error'
          : this.player.playing ? 'playing' : !this.enabled ? 'paused' : this.status === 'Loading' ? 'loading' : 'waiting' }] };
  }
  dispose() { this.disposed = true; ++this.generation; clearInterval(this.timer); this.player.setActiveForLockScreen(false); this.player.remove(); }
}
