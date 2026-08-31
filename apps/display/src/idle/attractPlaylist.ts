export type RandomSource = () => number;

function randomBucket(size: number, random: RandomSource): number {
  if (size <= 1) return 0;
  const value = random();
  const normalized = Number.isFinite(value)
    ? Math.min(Math.max(value, 0), 1 - Number.EPSILON)
    : 0;
  return Math.floor(normalized * size);
}

export function pickInitialAttractIndex(videoCount: number, random: RandomSource = Math.random): number {
  return randomBucket(videoCount, random);
}

/** Uniformly choose any playlist entry except the one currently playing. */
export function pickNextAttractIndex(
  currentIndex: number,
  videoCount: number,
  random: RandomSource = Math.random,
): number {
  if (videoCount <= 1) return 0;
  const current = Math.min(Math.max(currentIndex, 0), videoCount - 1);
  const candidate = randomBucket(videoCount - 1, random);
  return candidate >= current ? candidate + 1 : candidate;
}
