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
