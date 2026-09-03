import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { QrGrantMessage } from "@smartphonecracy/protocol";
import type { ServerClock } from "../lib/serverClock.js";
import { shouldShowGrant } from "../qr/shouldShowGrant.js";
import { ORIGINAL_MARKER_TRACK, type MarkerTrack } from "../idle/markerTrack.js";
import { MARKER_TRACKS_BY_FILENAME } from "../idle/markerTracks.js";
import {
  TRACKED_QR_ERROR_CORRECTION_LEVEL,
  TRACKED_QR_MARGIN_MODULES,
} from "../idle/qrPresentation.js";
import {
  pickInitialAttractIndex,
  pickNextAttractIndex,
  type RandomSource,
} from "../idle/attractPlaylist.js";
import { drawTrackedQr } from "../idle/tracking.js";

const CHECK_INTERVAL_MS = 1000;
const QR_RENDER_SIZE_PX = 512;
type AttractVideo = { url: string; markerTrack: MarkerTrack | null };

const bundledIdleAttractVideos: readonly AttractVideo[] = Object.entries(import.meta.glob<string>(
  "../assets/1.0_25_*.mp4",
  { eager: true, query: "?url", import: "default" },
))
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([path, url]) => {
    const filename = path.split("/").at(-1)!;
    return { url, markerTrack: MARKER_TRACKS_BY_FILENAME[filename] ?? null };
  });

export function IdleAttract({
  grant,
  qrHidden,
  clock,
  videoUrls,
  random = Math.random,
}: {
  grant: QrGrantMessage | null;
  qrHidden: boolean;
  clock: ServerClock;
  videoUrls?: readonly string[];
  random?: RandomSource;
}) {
  const videos: readonly AttractVideo[] = videoUrls === undefined
    ? bundledIdleAttractVideos
    : videoUrls.map((url) => ({ url, markerTrack: ORIGINAL_MARKER_TRACK }));
  const [activeVideoIndex, setActiveVideoIndex] = useState(() =>
    pickInitialAttractIndex(videos.length, random),
  );
  const activeVideo = videos[activeVideoIndex] ?? videos[0];
  const activeVideoUrl = activeVideo?.url;
  const activeMarkerTrack = activeVideo?.markerTrack ?? null;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [qrCanvas, setQrCanvas] = useState<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(() =>
    shouldShowGrant(grant, clock.now(), qrHidden),
  );

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;
    video.currentTime = 0;
    try {
      void video.play()?.catch((error: unknown) => {
        console.warn("display: failed to restart idle attract video:", error);
      });
    } catch (error) {
      console.warn("display: failed to restart idle attract video:", error);
    }
  }, [activeVideoUrl]);

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
      margin: TRACKED_QR_MARGIN_MODULES,
      errorCorrectionLevel: TRACKED_QR_ERROR_CORRECTION_LEVEL,
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
      if (visible && qrCanvas !== null && activeMarkerTrack !== null) {
        drawTrackedQr(context, qrCanvas, mediaTime, activeMarkerTrack);
      }
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
  }, [activeMarkerTrack, activeVideoUrl, qrCanvas, visible]);

  const playNextVideo = () => {
    setActiveVideoIndex((current) =>
      pickNextAttractIndex(current, videos.length, random),
    );
  };

  return (
    <div className="idle idle-attract">
      <video
        key={activeVideoUrl}
        ref={videoRef}
        className="idle-attract-video"
        src={activeVideoUrl}
        autoPlay
        loop={videos.length <= 1}
        muted
        playsInline
        preload="auto"
        onEnded={videos.length > 1 ? playNextVideo : undefined}
      />
      <canvas
        ref={overlayRef}
        className="idle-attract-overlay"
        width={activeMarkerTrack?.width ?? ORIGINAL_MARKER_TRACK.width}
        height={activeMarkerTrack?.height ?? ORIGINAL_MARKER_TRACK.height}
        aria-label="Join QR code"
      />
    </div>
  );
}
