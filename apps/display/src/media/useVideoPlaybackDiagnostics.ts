import { useCallback, useEffect, useRef } from "react";
import {
  PROTOCOL_VERSION,
  type DisplayPlaybackStatusMessage,
  type DisplayToServerMessage,
} from "@smartphonecracy/protocol";

type PlaybackStatus = DisplayPlaybackStatusMessage["status"];

export type VideoPlaybackDiagnosticsOptions = {
  sessionId: string | null;
  phaseId: string | null;
  phaseEpoch: number;
  mediaId: string | null;
  videoUrl: string | null;
  send: (message: DisplayToServerMessage) => void;
};

function errorDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 500);
  return String(error).slice(0, 500);
}

function mediaErrorDetail(error: MediaError | null): string {
  if (error === null) return "The browser reported an unspecified media error";
  return (error.message || `MediaError code ${error.code}`).slice(0, 500);
}

export function useVideoPlaybackDiagnostics({
  sessionId,
  phaseId,
  phaseEpoch,
  mediaId,
  videoUrl,
  send,
}: VideoPlaybackDiagnosticsOptions) {
  const ref = useRef<HTMLVideoElement>(null);

  const report = useCallback((status: PlaybackStatus, detail?: string) => {
    if (sessionId === null || phaseId === null || mediaId === null) return;
    send({
      t: "display_playback_status",
      v: PROTOCOL_VERSION,
      sessionId,
      phaseId,
      phaseEpoch,
      mediaId,
      status,
      ...(detail === undefined ? {} : { detail }),
    });
  }, [mediaId, phaseEpoch, phaseId, send, sessionId]);

  useEffect(() => {
    if (videoUrl === null || phaseId === null) return;
    const video = ref.current;
    if (video === null) return;
    try {
      const result = video.play();
      void result?.catch((error: unknown) => {
        report("autoplay-blocked", errorDetail(error));
      });
    } catch (error) {
      report("autoplay-blocked", errorDetail(error));
    }
  }, [phaseId, report, videoUrl]);

  return {
    ref,
    onPlaying: () => report("playing"),
    onStalled: () => report("stalled", "The browser stalled while loading video data"),
    onError: () => report("error", mediaErrorDetail(ref.current?.error ?? null)),
  };
}
