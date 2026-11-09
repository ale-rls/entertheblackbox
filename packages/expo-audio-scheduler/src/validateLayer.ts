import type { Layer } from './AudioScheduler.types';

/** Rejects layer combinations the native schedulers don't implement. */
export function validateLayer(layer: Layer): void {
  if (layer.repeatEveryMs !== undefined && (!Number.isFinite(layer.repeatEveryMs) || layer.startAt == null || layer.endAt == null || layer.endAt <= layer.startAt || layer.repeatEveryMs < layer.endAt - layer.startAt)) throw new Error('Repeat period must contain a positive anchored window');
  if (layer.loop && layer.startAt != null) throw new Error('Anchored layers play once; loop only applies to free-running layers');
  if (layer.endAt != null && layer.startAt == null) throw new Error('endAt needs startAt');
  if (layer.volume !== undefined && !(layer.volume >= 0 && layer.volume <= 1)) throw new Error('volume must be between 0 and 1');
}
