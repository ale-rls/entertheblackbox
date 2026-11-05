/** Finite videos hold their last frame; loops wrap on the server clock. */
export function monitorVideoTime(elapsedMs: number, durationSeconds: number, loop: boolean): { time: number; playing: boolean } {
  if (elapsedMs < 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return { time: 0, playing: false };
  const seconds = elapsedMs / 1000;
  return loop ? { time: seconds % durationSeconds, playing: true }
    : { time: Math.min(seconds, Math.max(0, durationSeconds - 0.001)), playing: seconds < durationSeconds };
}
