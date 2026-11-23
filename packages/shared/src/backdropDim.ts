/**
 * Background dimming around titles and open-curtain votes. A title or a vote
 * over a background loop dims the projector's video layer to the curtain-vote
 * level (display: titleDim.tsx). These rules decide when that dim starts and
 * ends around them, so the picture doesn't jump bright between two of them or
 * right before a curtain closes.
 */

export type BackdropDimPhase = {
  kind: string;
  loopVideoSrc?: string | undefined;
  text?: string | undefined;
  title?: string | undefined;
  audioSrc?: string | undefined;
  extraAudioSrc?: string | undefined;
  curtainLightVote?: boolean | undefined;
  spotlight?: unknown;
};

/** A title (narration with words) over a background loop. */
export function isTitleBackdrop(phase: BackdropDimPhase | null | undefined): boolean {
  return phase?.kind === "narration" && phase.loopVideoSrc !== undefined
    && ((phase.text ?? "").trim() !== "" || (phase.title ?? "").trim() !== "");
}

/**
 * A vote over a background loop that isn't drawn as curtain light, like the open-curtain
 * votes: the loop dims under the answer labels. A curtain-light group's own votes are drawn
 * as curtain light too; the caller rules those out (`drawnAsCurtain`).
 */
export function isVoteBackdrop(phase: BackdropDimPhase | null | undefined, drawnAsCurtain = false): boolean {
  return (phase?.kind === "position-question" || phase?.kind === "video-position-question")
    && phase.loopVideoSrc !== undefined && phase.curtainLightVote !== true && !phase.spotlight && !drawnAsCurtain;
}

/** A scene that keeps the background dimmed throughout: a title or an open-curtain vote. */
export function isDimmedBackdrop(phase: BackdropDimPhase | null | undefined, drawnAsCurtain = false): boolean {
  return isTitleBackdrop(phase) || isVoteBackdrop(phase, drawnAsCurtain);
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
 * - A title or an open-curtain vote is dimmed throughout.
 * - A scene before one dims during its last second, so it starts dimmed.
 * - After a dimmed scene, the dim stays on through a scene that leads into another
 *   dimmed one (nothing to brighten up for), and through a picture-only clip such as a
 *   curtain closing, which only comes back up in its last second.
 */
export function backdropDimPlan(phase: BackdropDimPhase, previousEndedDimmed: boolean, nextIsTitle: boolean): BackdropDimPlan {
  if (isDimmedBackdrop(phase)) return { start: true, end: true };
  const start = previousEndedDimmed && (nextIsTitle || isPictureOnlyClip(phase));
  return { start, end: nextIsTitle };
}
