import { z } from "zod";

export const ACTOR_SCRIPT_MAX_CHARS = 200_000;
export const ACTOR_SCRIPT_MAX_PARAGRAPHS = 2_000;

/** Blank lines separate cue paragraphs; line breaks inside a paragraph are kept. */
export function scriptParagraphs(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

/** Shared actor script for the whole show. Readable by anyone who can read the Studio draft. */
export const actorScriptSchema = z.object({
  title: z.string().trim().min(1, "script title must be non-empty").max(160),
  text: z.string().trim().min(1, "script text must be non-empty").max(ACTOR_SCRIPT_MAX_CHARS),
}).strict().superRefine((script, ctx) => {
  if (scriptParagraphs(script.text).length > ACTOR_SCRIPT_MAX_PARAGRAPHS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["text"], message: `script must have at most ${ACTOR_SCRIPT_MAX_PARAGRAPHS} paragraphs` });
  }
});

/** Moves the shared reader to `paragraph` (0-based) `startMs` after the scene starts. */
export const scriptCueSchema = z.object({
  startMs: z.number().int().nonnegative(),
  paragraph: z.number().int().nonnegative(),
}).strict();

export const scriptCuesSchema = z.array(scriptCueSchema).max(64).superRefine((cues, ctx) => {
  cues.forEach((cue, index) => {
    if (index > 0 && cue.startMs <= cues[index - 1]!.startMs) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "startMs"], message: "Script cues must have increasing, unique start times" });
    }
  });
});

export type ActorScript = z.infer<typeof actorScriptSchema>;
export type ScriptCue = z.infer<typeof scriptCueSchema>;

/** Index of the latest cue that has fired `elapsedMs` into the scene, or -1. */
export function firedScriptCueIndex(cues: readonly ScriptCue[] | undefined, elapsedMs: number): number {
  let fired = -1;
  (cues ?? []).forEach((cue, index) => { if (cue.startMs <= elapsedMs) fired = index; });
  return fired;
}
