import { useCallback, useEffect, useRef, useState } from "react";
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
  attractIndexAt,
} from "../idle/attractPlaylist.js";
import { drawTrackedQr } from "../idle/tracking.js";

const CHECK_INTERVAL_MS = 1000;
const QR_RENDER_SIZE_PX = 512;
type AttractVideo = { url: string; markerTrack: MarkerTrack | null };
type VideoSlot = 0 | 1;
const ATTRACT_A_FILENAME = "1.0_25_c_advert.mp4";

const bundledIdleAttractVideos: readonly AttractVideo[] = Object.entries(import.meta.glob<string>(
  "../assets/1.0_25_*.mp4",
  { eager: true, query: "?url", import: "default" },
))
  .sort(([left], [right]) => {
    const leftFilename = left.split("/").at(-1)!;
    const rightFilename = right.split("/").at(-1)!;
    if (leftFilename === ATTRACT_A_FILENAME) return -1;
    if (rightFilename === ATTRACT_A_FILENAME) return 1;
    return leftFilename.localeCompare(rightFilename);
  })
  .map(([path, url]) => {
    const filename = path.split("/").at(-1)!;
    return { url, markerTrack: MARKER_TRACKS_BY_FILENAME[filename] ?? null };
  });

export function IdleAttract({
  grant,
  qrHidden,
  clock,
  videoUrls,
  mediaVisible = true,
}: {
  grant: QrGrantMessage | null;
  qrHidden: boolean;
  clock: ServerClock;
  videoUrls?: readonly string[];
  mediaVisible?: boolean;
}) {
  const videos: readonly AttractVideo[] = videoUrls === undefined
    ? bundledIdleAttractVideos
    : videoUrls.map((url) => ({ url, markerTrack: ORIGINAL_MARKER_TRACK }));
  // The first clip is the designated A/hold clip. Keep it on every even
  // playlist beat and rotate the other clips through the odd beats.
  const [slotVideoIndexes, setSlotVideoIndexes] = useState<[number, number]>(() => [
    attractIndexAt(0, videos.length),
    attractIndexAt(1, videos.length),
  ]);
  const nextSequencePositionRef = useRef(2);
  const [activeSlot, setActiveSlot] = useState<VideoSlot>(0);
  const activeSlotRef = useRef<VideoSlot>(0);
  const slotVideoIndexesRef = useRef(slotVideoIndexes);
  slotVideoIndexesRef.current = slotVideoIndexes;
  const activeVideoIndex = slotVideoIndexes[activeSlot];
  const activeVideo = videos[activeVideoIndex] ?? videos[0];
  const activeVideoUrl = activeVideo?.url;
  const activeMarkerTrack = activeVideo?.markerTrack ?? null;
  const videoRefs = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null]);
  const switching = useRef(false);
  const pendingFrameCallback = useRef<{ video: HTMLVideoElement; id: number } | null>(null);
  const pendingAnimationFrame = useRef<number | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [qrCanvas, setQrCanvas] = useState<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(() =>
    shouldShowGrant(grant, clock.now(), qrHidden),
  );

  useEffect(() => {
    const video = videoRefs.current[activeSlotRef.current];
    if (video === null) return;
    if (!mediaVisible) {
      video.pause();
      return;
    }
    try {
      void video.play()?.catch((error: unknown) => {
        console.warn("display: failed to restart idle attract video:", error);
      });
    } catch (error) {
      console.warn("display: failed to restart idle attract video:", error);
    }
  }, [mediaVisible]);

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
    const video = videoRefs.current[activeSlot];
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
  }, [activeMarkerTrack, activeSlot, activeVideoUrl, qrCanvas, visible]);

  const revealSlot = useCallback((nextSlot: VideoSlot) => {
    if (!switching.current) return;
    const previousSlot = activeSlotRef.current;
    const nextVideoIndex = slotVideoIndexesRef.current[nextSlot];
    switching.current = false;
    activeSlotRef.current = nextSlot;
    setActiveSlot(nextSlot);
    setSlotVideoIndexes((current) => {
      const next: [number, number] = [...current];
      next[previousSlot] = attractIndexAt(nextSequencePositionRef.current, videos.length);
      nextSequencePositionRef.current += 1;
      return next;
    });
  }, [videos.length]);

  const handlePlaying = useCallback((slot: VideoSlot) => {
    if (!switching.current || slot === activeSlotRef.current || pendingFrameCallback.current !== null) return;
    const video = videoRefs.current[slot];
    if (video === null) return;
    if (typeof video.requestVideoFrameCallback === "function") {
      const id = video.requestVideoFrameCallback(() => {
        pendingFrameCallback.current = null;
        revealSlot(slot);
      });
      pendingFrameCallback.current = { video, id };
      return;
    }
    pendingAnimationFrame.current = requestAnimationFrame(() => {
      pendingAnimationFrame.current = null;
      revealSlot(slot);
    });
  }, [revealSlot]);

  const playNextVideo = () => {
    if (videos.length <= 1 || switching.current) return;
    switching.current = true;
    const nextSlot: VideoSlot = activeSlotRef.current === 0 ? 1 : 0;
    const nextVideo = videoRefs.current[nextSlot];
    if (nextVideo === null) return;
    nextVideo.currentTime = 0;
    void nextVideo.play().catch((error: unknown) => {
      switching.current = false;
      console.warn("display: failed to start next idle attract video:", error);
    });
  };

  useEffect(() => () => {
    const callback = pendingFrameCallback.current;
    if (callback !== null) callback.video.cancelVideoFrameCallback(callback.id);
    if (pendingAnimationFrame.current !== null) cancelAnimationFrame(pendingAnimationFrame.current);
  }, []);

  return (
    <div className={`idle idle-attract${mediaVisible ? "" : " idle-attract-hidden"}`}>
      {([0, 1] as const).map((slot) => {
        if (slot === 1 && videos.length <= 1) return null;
        const slotVideo = videos[slotVideoIndexes[slot]] ?? videos[0];
        return <video
          key={slot}
          ref={(video) => { videoRefs.current[slot] = video; }}
          className={`idle-attract-video${slot === activeSlot ? " idle-attract-video-active" : ""}`}
          src={slotVideo?.url}
          autoPlay={slot === activeSlot}
          loop={videos.length <= 1}
          muted
          playsInline
          preload="auto"
          onPlaying={() => handlePlaying(slot)}
          onEnded={slot === activeSlot && videos.length > 1 ? playNextVideo : undefined}
        />;
      })}
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
