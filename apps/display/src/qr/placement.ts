import type { QrGrantMessage } from "@entertheblackbox/protocol";

export type QrCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** Pixel width of the rendered QR canvas for each server-chosen placement. */
export const LARGE_SIZE_PX = 320;
export const CORNER_SIZE_PX = 112;

/**
 * Pure placement selection (plan §7/§9): the server picks "large" (idle/
 * lobby, centered) vs "corner" (small, during videos/questions); `corner`
 * only decides *which* screen corner for the "corner" case, since the
 * protocol leaves that choice to the display.
 */
export function placementClassName(
  placement: QrGrantMessage["placement"],
  corner: QrCorner,
): string {
  return placement === "large" ? "qr-badge-large" : `qr-badge-corner qr-badge-${corner}`;
}

export function qrSizePx(placement: QrGrantMessage["placement"]): number {
  return placement === "large" ? LARGE_SIZE_PX : CORNER_SIZE_PX;
}
