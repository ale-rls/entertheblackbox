/**
 * Background dimming around titles. A title over a background loop dims the
 * projector's video layer to the curtain-vote level (display: titleDim.tsx).
 * These rules decide when that dim starts and ends around a title, so the
 * picture doesn't jump bright between titles or right before a curtain closes.
 */

export type BackdropDimPhase = {
  kind: string;
  loopVideoSrc?: string | undefined;
  text?: string | undefined;
  title?: string | undefined;
  audioSrc?: string | undefined;
  extraAudioSrc?: string | undefined;
};

/** A title (narration with words) over a background loop. */
export function isTitleBackdrop(phase: BackdropDimPhase | null | undefined): boolean {
  return phase?.kind === "narration" && phase.loopVideoSrc !== undefined
    && ((phase.text ?? "").trim() !== "" || (phase.title ?? "").trim() !== "");
}

/** A picture-only clip, like a curtain opening or closing: a video scene with no sound and no loop of its own. */
export function isPictureOnlyClip(phase: BackdropDimPhase): boolean {
  return phase.kind === "video" && phase.loopVideoSrc === undefined
    && phase.audioSrc === undefined && phase.extraAudioSrc === undefined;
}

export type BackdropDimPlan = {
  /** Dimmed from the scene's first frame. */
  start: boolean;
  /** Dimmed by the scene's end: the dim eases there during its last second. */
  end: boolean;
};

/**
 * Where the background dim stands at the start and end of a scene.
 *
 * - A title is dimmed throughout.
 * - A scene before a title dims during its last second, so the title starts dimmed.
 * - After a dimmed scene, the dim stays on through a scene that leads into another
 *   title (nothing to brighten up for), and through a picture-only clip such as a
 *   curtain closing, which only comes back up in its last second.
 */
export function backdropDimPlan(phase: BackdropDimPhase, previousEndedDimmed: boolean, nextIsTitle: boolean): BackdropDimPlan {
  if (isTitleBackdrop(phase)) return { start: true, end: true };
  const start = previousEndedDimmed && (nextIsTitle || isPictureOnlyClip(phase));
  return { start, end: nextIsTitle };
}
