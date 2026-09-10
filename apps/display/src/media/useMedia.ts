import { useEffect, useMemo, useRef, useState } from "react";
import { mediaManifestSchema } from "@smartphonecracy/scenario";
import { MediaStore, type MediaSyncStatus } from "./mediaStore.js";

/**
 * Boot media synchronization for the display (plan §9): fetch and
 * verify the manifest, sync everything into Cache Storage, and expose
 * Blob URLs for the active video. The display is not "ready" until the
 * sync completes; failures surface as a visible retry state.
 */
export function useMedia(manifestUrl = "/media-manifest.json") {
  const [status, setStatus] = useState<MediaSyncStatus>({ state: "idle" });
  const [resolvedMedia, setResolvedMedia] = useState<{
    visualSrc: string;
    audioSrc: string | null;
    extraAudioSrc: string | null;
    visualUrl: string | null;
    audioUrl: string | null;
    extraAudioUrl: string | null;
  } | null>(null);
  const activeSources = useRef<{
    visualSrc: string;
    audioSrc: string | null;
    extraAudioSrc: string | null;
  } | null>(null);
  const store = useMemo(() => new MediaStore({ onStatus: setStatus }), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Manifest fetch shares the same retry loop semantics as media
      // downloads: keep trying, never declare ready without it.
      for (let attempt = 0; !cancelled; attempt += 1) {
        try {
          const response = await fetch(manifestUrl, { cache: "no-cache" });
          if (!response.ok) throw new Error(`manifest http ${response.status}`);
          const manifest = mediaManifestSchema.parse(await response.json());
          await store.sync(manifest);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const delayMs = Math.min(30_000, 1000 * 2 ** attempt);
          setStatus({ state: "retrying", attempt: attempt + 1, delayMs, lastError: message });
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    })();
    return () => {
      cancelled = true;
      store.stop();
    };
  }, [store, manifestUrl]);

  /** Point the media layer at a video (optionally with a soundtrack), or at a cached image + audio pair. */
  const showMedia = async (
    visualSrc: string | null,
    audioSrc: string | null = null,
    extraAudioSrc: string | null = null,
  ) => {
    activeSources.current = visualSrc === null ? null : { visualSrc, audioSrc, extraAudioSrc };
    if (visualSrc === null) {
      store.retainOnly(new Set());
      setResolvedMedia(null);
      return;
    }
    const [visualUrl, resolvedAudioUrl, resolvedExtraAudioUrl] = await Promise.all([
      store.getBlobUrl(visualSrc),
      audioSrc === null ? Promise.resolve(null) : store.getBlobUrl(audioSrc),
      extraAudioSrc === null ? Promise.resolve(null) : store.getBlobUrl(extraAudioSrc),
    ]);
    const active = activeSources.current;
    if (
      active?.visualSrc !== visualSrc
      || active.audioSrc !== audioSrc
      || active.extraAudioSrc !== extraAudioSrc
    ) {
      // Phase changed while the blob materialized: purge everything the
      // current phase doesn't need, including the URL just created.
      store.retainOnly(new Set(active === null ? [] : [
        active.visualSrc,
        ...(active.audioSrc === null ? [] : [active.audioSrc]),
        ...(active.extraAudioSrc === null ? [] : [active.extraAudioSrc]),
      ]));
      return;
    }
    store.retainOnly(new Set([
      visualSrc,
      ...(audioSrc === null ? [] : [audioSrc]),
      ...(extraAudioSrc === null ? [] : [extraAudioSrc]),
    ]));
    // Publish the source identity and all of its URLs atomically. During an
    // asynchronous phase change the previous resolved media may remain here,
    // but consumers can now prove that it belongs to the previous phase rather
    // than briefly attaching its Blob URL to the incoming <video>.
    setResolvedMedia({
      visualSrc,
      audioSrc,
      extraAudioSrc,
      visualUrl,
      audioUrl: resolvedAudioUrl,
      extraAudioUrl: resolvedExtraAudioUrl,
    });
  };

  // A video phase can arrive before boot sync finishes; once the cache
  // is ready, re-resolve the pending src so the video actually appears.
  useEffect(() => {
    if (status.state === "ready" && activeSources.current !== null) {
      void showMedia(
        activeSources.current.visualSrc,
        activeSources.current.audioSrc,
        activeSources.current.extraAudioSrc,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.state]);

  return {
    status,
    visualSrc: resolvedMedia?.visualSrc ?? null,
    audioSrc: resolvedMedia?.audioSrc ?? null,
    extraAudioSrc: resolvedMedia?.extraAudioSrc ?? null,
    videoUrl: resolvedMedia?.visualUrl ?? null,
    audioUrl: resolvedMedia?.audioUrl ?? null,
    extraAudioUrl: resolvedMedia?.extraAudioUrl ?? null,
    showMedia,
    store,
  };
}
