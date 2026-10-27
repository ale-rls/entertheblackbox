/**
 * One sound on the shared clock. Times are milliseconds on whatever clock the
 * app passes to `setClock` (for a show: corrected server time).
 */
export type Layer = {
  /** Local file URI. */
  uri: string;
  /** Free-running layers only: loop until cleared. */
  loop?: boolean;
  /** 0..1, default 1. */
  volume?: number;
  /**
   * Clock time at which the start of the file plays. A time in the past starts
   * mid-file at the matching position. Omit for a free-running layer that starts
   * as soon as it is set (and the scheduler is not paused).
   */
  startAt?: number | null;
  /** Clock time at which an anchored layer stops. */
  endAt?: number | null;
  /** Anchored layers are re-seeked when they drift further than this from the clock. Default 250. */
  resyncThresholdMs?: number;
};

export type NowPlaying = { title: string; artist?: string };

export type LayerState = 'waiting' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export type LayerTiming = {
  id: string;
  state: LayerState;
  positionMs: number | null;
  /** Where an anchored layer should be right now; null for free-running layers. */
  targetMs: number | null;
  driftMs: number | null;
  error: string | null;
};

/** `api` is a pause/resume call from JS; the rest come from the OS or the lock screen. */
export type PauseReason = 'api' | 'remote' | 'interruption' | 'route';

export type AudioSchedulerEvents = {
  onPausedChange(event: { paused: boolean; reason: PauseReason }): void;
  onLayerError(event: { id: string; message: string }): void;
};
