import type { QrGrantMessage } from "@entertheblackbox/protocol";

/**
 * Pure visibility rule for the QR badge (plan §7/§9): the display renders
 * only the latest server-provided grant and hides it once `expiresAt`
 * passes on corrected server time (not the device clock) unless a
 * replacement has already arrived, or immediately when the server sends
 * `qr_hidden`. Kept pure/side-effect-free so it is unit-testable without a
 * timer or socket.
 */
export function shouldShowGrant(
  grant: QrGrantMessage | null,
  nowServerTime: number,
  qrHidden: boolean,
): boolean {
  if (qrHidden) return false;
  if (grant === null) return false;
  return nowServerTime < grant.expiresAt;
}
