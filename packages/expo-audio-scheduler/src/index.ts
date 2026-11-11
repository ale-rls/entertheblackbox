import { NativeModule, requireNativeModule } from 'expo';
import type { AudioSchedulerEvents, Layer, LayerTiming, NowPlaying } from './AudioScheduler.types';
import { validateLayer } from './validateLayer';

export * from './AudioScheduler.types';
export { validateLayer } from './validateLayer';

declare class AudioSchedulerModule extends NativeModule<AudioSchedulerEvents> {
  /** Activates the playback session and lock-screen controls. Call before setting layers. */
  supportsAdmissionPrograms?(): boolean;
  configure(nowPlaying: NowPlaying): Promise<void>;
  /** Current clock time in ms. Native code advances it on a monotonic clock until the next call. */
  setClock(nowMs: number): void;
  /** Adds or replaces a layer. Same id and uri updates timing and volume without restarting playback. */
  setLayer(id: string, layer: Layer): Promise<void>;
  clearLayer(id: string): Promise<void>;
  supportsFadeOut?(): boolean;
  fadeOutLayer?(id: string, durationMs: number): Promise<void>;
  /** Pauses every layer; new layers stay paused until `resume`. */
  pause(): Promise<void>;
  /** Resumes every layer; anchored layers rejoin at the current clock position. */
  resume(): Promise<void>;
  isPaused(): boolean;
  getTiming(): LayerTiming[];
  /** Releases every layer and the playback session. */
  reset(): Promise<void>;
}

const native = requireNativeModule<AudioSchedulerModule>('AudioScheduler');

const AudioScheduler = {
  supportsAdmissionPrograms: () => native.supportsAdmissionPrograms?.() === true,
  configure: (nowPlaying: NowPlaying) => native.configure(nowPlaying),
  setClock: (nowMs: number) => native.setClock(nowMs),
  setLayer(id: string, layer: Layer): Promise<void> {
    validateLayer(layer);
    return native.setLayer(id, layer);
  },
  clearLayer: (id: string) => native.clearLayer(id),
  /** True on builds whose native scheduler can fade a layer out (older installs only hard-stop). */
  supportsFadeOut: () => native.supportsFadeOut?.() === true,
  /**
   * Ramps a playing layer to silence over `durationMs` natively (works with the screen locked),
   * then releases it. The id is free at once for a replacement. Builds without native fade
   * support fall back to `clearLayer`.
   */
  fadeOutLayer: (id: string, durationMs: number) => native.fadeOutLayer ? native.fadeOutLayer(id, durationMs) : native.clearLayer(id),
  pause: () => native.pause(),
  resume: () => native.resume(),
  isPaused: () => native.isPaused(),
  getTiming: () => native.getTiming(),
  reset: () => native.reset(),
  addListener: <E extends keyof AudioSchedulerEvents>(event: E, listener: AudioSchedulerEvents[E]) => native.addListener(event, listener),
};

export default AudioScheduler;

export { ShowScreen } from './show-screen';
