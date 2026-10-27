import type { Layer } from './AudioScheduler.types';

/** Rejects layer combinations the native schedulers don't implement. */
export function validateLayer(layer: Layer): void {
  if (layer.loop && layer.startAt != null) throw new Error('Anchored layers play once; loop only applies to free-running layers');
  if (layer.endAt != null && layer.startAt == null) throw new Error('endAt needs startAt');
  if (layer.volume !== undefined && !(layer.volume >= 0 && layer.volume <= 1)) throw new Error('volume must be between 0 and 1');
}
