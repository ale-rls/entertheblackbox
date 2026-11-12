import { z } from "zod";

export const ACTOR_SCRIPT_MAX_CHARS = 200_000;
export const ACTOR_SCRIPT_MAX_PARAGRAPHS = 2_000;

/** Blank lines separate cue paragraphs; line breaks inside a paragraph are kept. */
export function scriptParagraphs(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

const scriptGroupIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "group id must use letters, numbers, hyphens, or underscores");

/** Shared actor script for the whole show. Readable by anyone who can read the Studio draft. */
export const actorScriptSchema = z.object({
  title: z.string().trim().min(1, "script title must be non-empty").max(160),
  text: z.string().trim().min(1, "script text must be non-empty").max(ACTOR_SCRIPT_MAX_CHARS),
  /** Group id → speaker name as written in the script ("VECTOR"); tablets in that group highlight its lines. */
  speakersByGroup: z.record(scriptGroupIdSchema, z.string().trim().min(1).max(60)).optional(),
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

/** Part of the actor script that a scene shows on the tablets of some groups (all participants when empty). */
export const tabletScriptSchema = z.object({
  fromParagraph: z.number().int().nonnegative(),
  toParagraph: z.number().int().nonnegative(),
  groupIds: z.array(scriptGroupIdSchema).max(100).default([]),
}).strict().refine((range) => range.fromParagraph <= range.toParagraph, { message: "tablet script must end at or after its first paragraph", path: ["toParagraph"] });
export type TabletScript = z.infer<typeof tabletScriptSchema>;

/** What one tablet receives: only the excerpt, and the speaker whose lines it highlights. */
export type TabletScriptExcerpt = { title: string; paragraphs: string[]; speaker?: string };

/** The excerpt a participant in `groupId` sees in a scene, or null when the scene shows them none. */
export function tabletScriptExcerpt(script: ActorScript | undefined, paragraphs: readonly string[], config: TabletScript | undefined, groupId: string | null): TabletScriptExcerpt | null {
  if (!script || !config) return null;
  if (config.groupIds.length && (groupId === null || !config.groupIds.includes(groupId))) return null;
  const excerpt = paragraphs.slice(config.fromParagraph, config.toParagraph + 1);
  if (!excerpt.length) return null;
  const speaker = groupId === null ? undefined : script.speakersByGroup?.[groupId];
  return { title: script.title, paragraphs: excerpt, ...(speaker ? { speaker } : {}) };
}

const SPEAKER_LINE = /^\s*([^\s:\[\]][^:\[\]]{0,59}?)\s*:/;
const DIRECTION_LINE = /^\s*[[(].*[\])]\s*$/;
/**
 * Splits a paragraph into lines and marks the ones `speaker` speaks. A line "NAME: text" starts a
 * speech; following lines continue it until the next speaker or the end of the paragraph. Lines that
 * are only a stage direction ("[Pause.]") are never marked. Names match case-insensitively.
 */
export function scriptLines(paragraph: string, speaker?: string): Array<{ text: string; own: boolean }> {
  const target = speaker?.trim().toLocaleLowerCase();
  let current: string | null = null;
  return paragraph.split("\n").map((text) => {
    const match = SPEAKER_LINE.exec(text);
    if (match && match[1] === match[1]!.toLocaleUpperCase()) current = match[1]!.trim().toLocaleLowerCase();
    const own = !!target && current === target && !DIRECTION_LINE.test(text);
    return { text, own };
  });
}
