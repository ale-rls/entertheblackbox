import { z } from "zod";

const musicFileSchema = z.string().min(1)
  .regex(/^(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[^:?#]+\.mp3$/i, "Music must reference a local MP3 from the media library");
const volumeSchema = z.number().min(0).max(1);
const fadeMsSchema = z.number().int().min(0).max(120_000);

/**
 * Room music on the main display, changed when a scene starts and kept across
 * scenes until another cue changes it. Scenes without a cue leave the music as
 * it is. Only shared-timeline scenes apply cues (not group paths).
 */
export const musicCueSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("play"),
    /** MP3 from the shared media library. Restarts from the top, even if the same track is playing. */
    src: musicFileSchema,
    /** 0–1, default 1. */
    volume: volumeSchema.optional(),
    /** Default true: music beds run until a later cue stops them. */
    loop: z.boolean().optional(),
    /** Fade in from silence, default 0. */
    fadeMs: fadeMsSchema.optional(),
  }),
  z.object({
    action: z.literal("volume"),
    volume: volumeSchema,
    /** Default 2000. */
    fadeMs: fadeMsSchema.optional(),
  }),
  z.object({
    action: z.literal("stop"),
    /** Default 2000; 0 cuts immediately. */
    fadeMs: fadeMsSchema.optional(),
  }),
]);
export type MusicCue = z.infer<typeof musicCueSchema>;

export const MUSIC_DEFAULT_FADE_MS = 2_000;

/** The library file a cue plays, if any. */
export function musicCueSources(cue: MusicCue | undefined): string[] {
  return cue?.action === "play" ? [cue.src] : [];
}
