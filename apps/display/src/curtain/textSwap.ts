/**
 * A question change on a curtain that stays: the old text fades out
 * exponentially (down to 1% at the end) and the new text appears at once.
 */
export const TEXT_OUT_MS = 900;
const TEXT_OUT_RATE = Math.log(100) / TEXT_OUT_MS;

/** What the curtain shows (question text, labels, lit areas) and when a change to it started. */
export type TextSwap<Content> = { shown: Content; startedAt: number | null };

/**
 * Advance the question swap by one frame. While the old content fades out it
 * stays the content on screen, text and lit areas alike, so light never moves
 * in areas the visible labels don't describe. On a curtain that isn't visible
 * yet (fading in from black) there is nothing to fade out: the new content is
 * shown at once.
 */
export function stepTextSwap<Content>(
  swap: TextSwap<Content>,
  target: Content,
  fabricVisible: boolean,
  now: number,
): { swap: TextSwap<Content>; textOpacity: number; redraw: boolean } {
  if (target === swap.shown) return { swap: swap.startedAt === null ? swap : { shown: swap.shown, startedAt: null }, textOpacity: 1, redraw: false };
  if (!fabricVisible) return { swap: { shown: target, startedAt: null }, textOpacity: 1, redraw: true };
  const startedAt = swap.startedAt ?? now;
  const t = now - startedAt;
  if (t < TEXT_OUT_MS) return { swap: { shown: swap.shown, startedAt }, textOpacity: Math.exp(-TEXT_OUT_RATE * t), redraw: false };
  return { swap: { shown: target, startedAt: null }, textOpacity: 1, redraw: true };
}
