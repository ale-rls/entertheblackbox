import { z } from "zod";

export const monitorIdSchema = z.enum(["M1", "M2", "M3", "M4"]);
export const MONITOR_IDS = monitorIdSchema.options;
const timing = {
  startMs: z.number().int().nonnegative().default(0),
  /** Omit to hold until the next cue or phase. Gaps render black. */
  durationMs: z.number().int().positive().optional(),
};
const text = z.string().max(4000);
const source = z.string().min(1).refine((value) => !value.startsWith("/") && !value.includes("..") && !/[?#:\\]/.test(value), "Use a relative media manifest path");
const fit = z.enum(["contain", "cover"]).default("contain");
export const monitorCueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("blank"), ...timing }),
  z.object({ kind: z.literal("placeholder"), text, ...timing }),
  z.object({ kind: z.literal("text"), text, ...timing }),
  z.object({ kind: z.literal("image"), src: source.refine((value) => /\.(png|jpe?g|webp)$/i.test(value), "Choose a PNG, JPEG or WebP image"), text: text.optional(), fit, ...timing }),
  z.object({ kind: z.literal("video"), src: source.refine((value) => /\.(mp4|webm)$/i.test(value), "Choose an MP4 or WebM video"), loop: z.boolean().default(false), fit, ...timing }),
]);
export const monitorCuesSchema = z.record(monitorIdSchema, z.array(monitorCueSchema).max(64).superRefine((cues, ctx) => {
  cues.forEach((cue, index) => {
    if (index > 0 && cue.startMs <= cues[index - 1]!.startMs) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "startMs"], message: "Monitor cues must have increasing, unique start times" });
  });
}));
export type MonitorId = z.infer<typeof monitorIdSchema>;
export type MonitorCue = z.infer<typeof monitorCueSchema>;
export type MonitorCues = z.infer<typeof monitorCuesSchema>;

export function monitorMediaSources(cues: MonitorCues | undefined): string[] {
  return [...new Set(Object.values(cues ?? {}).flatMap((items) => (items ?? []).flatMap((cue) => "src" in cue ? [cue.src] : [])))];
}

/** Stateless selection: reconnects, jumps and repeated phases never restart a cue. */
export function activeMonitorCue(cues: readonly MonitorCue[], elapsedMs: number): MonitorCue | null {
  const cue = [...cues].reverse().find((item) => item.startMs <= elapsedMs);
  return cue && (cue.durationMs === undefined || elapsedMs < cue.startMs + cue.durationMs) ? cue : null;
}
