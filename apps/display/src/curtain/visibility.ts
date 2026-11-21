/** How long the curtain takes to fade out when its question hides before the scene ends. */
export const FADE_OUT_MS = 900;
/** How long a finished curtain stays on screen, fading into the next scene. */
export const CURTAIN_LEAVE_MS = 1_200;

export type CurtainVisibilityInput = {
  /** Server time now. */
  now: number;
  /** Server time the question appears; undefined when it is up from the start. */
  visibleFrom?: number | undefined;
  /** Server time the question must be gone by when it hides before its scene ends. */
  visibleUntil?: number | undefined;
  /** Milliseconds since the scene moved on, or null while it is still running. */
  leavingForMs: number | null;
  /** The curtain video has a frame on screen. */
  videoReady: boolean;
};

/**
 * What the curtain shows at one moment.
 *
 * The fabric is up from the first frame of the curtain video, so a vote that
 * follows a scene with the closed curtain never dips to black. The question,
 * labels, lit areas and cursors (the content) appear at once when the question
 * is due. Without a video frame by then, the fabric appears with the content
 * (the built-in fabric stands in). Both fade out together when the question
 * hides early, and when the next scene takes over.
 */
export function curtainVisibility(input: CurtainVisibilityInput): { fabric: number; content: boolean } {
  const from = input.visibleFrom ?? Number.NEGATIVE_INFINITY;
  const until = input.visibleUntil ?? Number.POSITIVE_INFINITY;
  const content = input.now >= from;
  const fadeOut = Number.isFinite(until) ? Math.min(1, Math.max(0, (until - input.now) / FADE_OUT_MS)) : 1;
  const leave = input.leavingForMs === null ? 1 : Math.max(0, 1 - input.leavingForMs / CURTAIN_LEAVE_MS);
  const up = input.videoReady || content ? 1 : 0;
  return { fabric: up * fadeOut * leave, content };
}
