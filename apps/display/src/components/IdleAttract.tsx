import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { QrGrantMessage } from "@smartphonecracy/protocol";
import type { ServerClock } from "../lib/serverClock.js";
import { shouldShowGrant } from "../qr/shouldShowGrant.js";
import {
  MARKER_TRACK_HEIGHT,
  MARKER_TRACK_WIDTH,
} from "../idle/markerTrack.js";
import { drawTrackedQr } from "../idle/tracking.js";
import idleAttractUrl from "../assets/idle-attract.mp4";

const CHECK_INTERVAL_MS = 1000;
const QR_RENDER_SIZE_PX = 512;

export function IdleAttract({
  grant,
  qrHidden,
  clock,
}: {
  grant: QrGrantMessage | null;
  qrHidden: boolean;
  clock: ServerClock;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [qrCanvas, setQrCanvas] = useState<HTMLCanvasElement | null>(null);
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
    let cancelled = false;
    setQrCanvas(null);
    if (!visible || grant === null) return () => { cancelled = true; };

    const canvas = document.createElement("canvas");
    void QRCode.toCanvas(canvas, grant.url, {
      width: QR_RENDER_SIZE_PX,
      // Match the proven admission QR settings. The prop's existing white
      // frame supplies additional quiet-zone contrast while keeping modules
      // as large as possible at projection distance.
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then(() => {
        if (!cancelled) setQrCanvas(canvas);
      })
      .catch((error: unknown) => {
        console.warn("display: failed to render tracked QR code:", error);
      });
    return () => { cancelled = true; };
  }, [grant, visible]);

  useEffect(() => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (video === null || overlay === null) return;
    const context = overlay.getContext("2d");
    if (context === null) return;

    let stopped = false;
    let videoFrameId: number | null = null;
    let animationFrameId: number | null = null;

    const draw = (mediaTime: number) => {
      context.clearRect(0, 0, overlay.width, overlay.height);
      if (visible && qrCanvas !== null) drawTrackedQr(context, qrCanvas, mediaTime);
    };

    if (typeof video.requestVideoFrameCallback === "function") {
      const onVideoFrame: VideoFrameRequestCallback = (_now, metadata) => {
        if (stopped) return;
        draw(metadata.mediaTime);
        videoFrameId = video.requestVideoFrameCallback(onVideoFrame);
      };
      draw(video.currentTime);
      videoFrameId = video.requestVideoFrameCallback(onVideoFrame);
    } else {
      const onAnimationFrame = () => {
        if (stopped) return;
        draw(video.currentTime);
        animationFrameId = requestAnimationFrame(onAnimationFrame);
      };
      onAnimationFrame();
    }

    return () => {
      stopped = true;
      if (videoFrameId !== null) video.cancelVideoFrameCallback(videoFrameId);
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      context.clearRect(0, 0, overlay.width, overlay.height);
    };
  }, [qrCanvas, visible]);

  return (
    <div className="idle idle-attract">
      <video
        ref={videoRef}
        className="idle-attract-video"
        src={idleAttractUrl}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
      />
      <canvas
        ref={overlayRef}
        className="idle-attract-overlay"
        width={MARKER_TRACK_WIDTH}
        height={MARKER_TRACK_HEIGHT}
        aria-label="Join QR code"
      />
    </div>
  );
}
