/**
 * The first clip is the designated A/hold clip. Interleave it with each of the
 * remaining clips so the three-video lobby rhythm is A-B-A-C-A-B-A-C.
 */
export function attractIndexAt(sequencePosition: number, videoCount: number): number {
  if (videoCount <= 1) return 0;
  const position = Math.max(0, Math.floor(sequencePosition));
  if (position % 2 === 0) return 0;
  return 1 + (Math.floor(position / 2) % (videoCount - 1));
}
