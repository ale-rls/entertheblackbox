import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { QrGrantMessage } from "@entertheblackbox/protocol";
import type { ServerClock } from "../lib/serverClock.js";
import { shouldShowGrant } from "../qr/shouldShowGrant.js";
import { placementClassName, qrSizePx, type QrCorner } from "../qr/placement.js";

/**
 * Renders the latest server-pushed QR grant (plan §7/§9). The server
 * chooses `placement`: "large" (centered, idle/lobby) or "corner" (small,
 * during videos/questions when late join is enabled) — `corner` here only
 * picks *which* screen corner, since the protocol leaves that to the
 * display. The QR is generated locally with the `qrcode` package; the
 * kiosk never fetches a QR image over the network.
 *
 * Visibility is re-evaluated on a ~1 Hz poll against corrected server
 * time (plan: "hides at expiresAt on corrected time") rather than a
 * deadline timeout, so a paused/backgrounded tab still catches up
 * correctly once it resumes.
 */

const CHECK_INTERVAL_MS = 1000;

export type { QrCorner };

export function QrBadge({
  grant,
  qrHidden,
  clock,
  corner = "bottom-right",
}: {
  grant: QrGrantMessage | null;
  qrHidden: boolean;
  clock: ServerClock;
  corner?: QrCorner;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(() =>
    shouldShowGrant(grant, clock.now(), qrHidden),
  );

  useEffect(() => {
    const evaluate = () => setVisible(shouldShowGrant(grant, clock.now(), qrHidden));
    evaluate();
    const timer = setInterval(evaluate, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [grant, qrHidden, clock]);

  useEffect(() => {
    if (!visible || grant === null) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    void QRCode.toCanvas(canvas, grant.url, {
      width: qrSizePx(grant.placement),
      margin: 1,
      errorCorrectionLevel: "M",
    }).catch((err: unknown) => {
      // Never crash the kiosk on a rendering hiccup — just skip this frame.
      console.warn("display: failed to render QR code:", err);
    });
  }, [visible, grant]);

  if (!visible || grant === null) return null;

  const placementClass = placementClassName(grant.placement, corner);

  return (
    <div className={`qr-badge ${placementClass}`}>
      <canvas ref={canvasRef} className="qr-badge-canvas" />
    </div>
  );
}
