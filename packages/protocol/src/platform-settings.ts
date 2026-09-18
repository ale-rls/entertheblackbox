import { z } from "zod";

/** Public display copy only. Other platform settings get separate namespaces. */
export const displaySettingsSchema = z.object({
  heading: z.string().max(160),
  countdownTemplate: z.string().min(1).max(160).refine((value) => value.includes("{time}"), "Include {time} for the countdown"),
  networkInstructions: z.string().max(600),
  joinInstructions: z.string().max(600),
  showJoinUrl: z.boolean(),
}).strict();
export type DisplaySettings = z.infer<typeof displaySettingsSchema>;
export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  heading: "Join the show",
  countdownTemplate: "Show starts in {time}",
  networkInstructions: "Verbinde dich mit dem Besucher-WLAN {wifi} oder nutze dein eigenes mobiles Netz.",
  joinInstructions: "Scanne den QR-Code mit deinem Smartphone und folge den Anleitungen auf deinem Display.",
  showJoinUrl: true,
};
