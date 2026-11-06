import { WALL_MAX_COLS, WALL_MAX_ROWS, type WallLayout } from "@entertheblackbox/shared";
import { z } from "zod";

/** Browser-playable media URLs; allow same-origin paths and HTTP(S) only. */
export const waitingVideoUrlSchema = z.string().max(2048).refine((value) => {
  if (value === "") return true;
  if (value.trim() !== value || /[\\\s]/.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}, "Use an HTTP(S) video URL or a same-origin path starting with /.");

/** Public display copy and waiting video settings. */
export const displaySettingsSchema = z.object({
  phoneSurfaceColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color").default("#000000"),
  heading: z.string().max(160),
  countdownTemplate: z.string().min(1).max(160).refine((value) => value.includes("{time}"), "Include {time} for the countdown"),
  networkInstructions: z.string().max(600),
  joinInstructions: z.string().max(600),
  showJoinUrl: z.boolean(),
  waitingVideoUrl: waitingVideoUrlSchema.default(""),
  groupWaitingVideoUrls: z.record(z.string().min(1).max(160), waitingVideoUrlSchema).default({}),
  /** Background video for signage kiosks (e.g. a lobby entrance screen showing the join QR), keyed by a fixed signage spot id such as "lobby". */
  signageVideoUrls: z.record(z.string().min(1).max(160), waitingVideoUrlSchema).default({}),
}).strict();
export type DisplaySettings = z.infer<typeof displaySettingsSchema>;
export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  phoneSurfaceColor: "#000000",
  heading: "Join the show",
  countdownTemplate: "Show starts in {time}",
  networkInstructions: "Verbinde dich mit dem Besucher-WLAN {wifi} oder nutze dein eigenes mobiles Netz.",
  joinInstructions: "Scanne den QR-Code mit deinem Smartphone und folge den Anleitungen auf deinem Display.",
  showJoinUrl: true,
  waitingVideoUrl: "",
  groupWaitingVideoUrls: {},
  signageVideoUrls: {},
};

/** Missing group overrides inherit; an explicit empty override keeps that display black. */
export function resolveWaitingVideoUrl(settings: DisplaySettings, groupId?: string): string {
  return groupId !== undefined && Object.hasOwn(settings.groupWaitingVideoUrls, groupId)
    ? settings.groupWaitingVideoUrls[groupId]!
    : settings.waitingVideoUrl;
}

/** Missing signage overrides inherit the shared default waiting video; an explicit empty override keeps that kiosk black. */
export function resolveSignageVideoUrl(settings: DisplaySettings, signageId: string): string {
  return Object.hasOwn(settings.signageVideoUrls, signageId)
    ? settings.signageVideoUrls[signageId]!
    : settings.waitingVideoUrl;
}

/** Tablet video wall layout (Admin → Wall). Type and slice math live in @entertheblackbox/shared. */
const positiveMm = z.number().positive().max(10_000);
const wallPx = z.number().int().positive().max(16_384);
export const wallLayoutSchema = z.object({
  cols: z.number().int().min(1).max(WALL_MAX_COLS),
  rows: z.number().int().min(1).max(WALL_MAX_ROWS),
  screen: z.object({ widthMm: positiveMm, heightMm: positiveMm, widthPx: wallPx, heightPx: wallPx }).strict(),
  gapMm: z.object({ x: z.number().min(0).max(10_000), y: z.number().min(0).max(10_000) }).strict(),
  source: z.object({ widthPx: wallPx, heightPx: wallPx, fps: z.number().positive().max(240) }).strict(),
  fit: z.enum(["fill", "fit"]),
  slots: z.record(z.string().regex(/^[A-Z][0-9]{1,2}$/), z.string().trim().min(1).max(40)),
}).strict() satisfies z.ZodType<WallLayout>;
