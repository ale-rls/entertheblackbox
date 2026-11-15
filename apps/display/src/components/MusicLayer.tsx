import { useEffect, useRef, useState } from "react";
import { musicGainAt, musicPositionAt, type MusicMessage } from "@entertheblackbox/protocol";
import type { ServerClock } from "@entertheblackbox/shared";

/** Re-seek only past this drift, so steady playback is never nudged audibly. */
const SEEK_THRESHOLD_SECONDS = 0.3;

type MusicMedia = {
  /** Blob URL from the synced show media, or null when the file is not part of it. */
  getBlobUrl: (src: string) => Promise<string | null>;
  pin: (src: string | null, owner: string) => void;
};

/**
 * Room music: one track kept across scenes, positioned and faded on the server
 * clock (see the `music` message). Published scene music comes from the synced
 * media; a track Admin picked from the library streams from the server.
 */
export function MusicLayer({ music, clock, soundEnabled, media, onAudioElement }: {
  music: MusicMessage | null;
  clock: ServerClock;
  soundEnabled: boolean;
  media: MusicMedia;
  onAudioElement?: (element: HTMLAudioElement | null) => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const track = music?.track ?? null;
  const [resolved, setResolved] = useState<{ src: string; url: string } | null>(null);
  const pinned = useRef(false);

  useEffect(() => {
    if (track === null) {
      if (pinned.current) media.pin(null, "music");
      pinned.current = false;
      return;
    }
    let cancelled = false;
    media.pin(track.src, "music");
    pinned.current = true;
    void media.getBlobUrl(track.src).then((blobUrl) => {
      if (!cancelled) setResolved({ src: track.src, url: blobUrl ?? track.url });
    });
    return () => { cancelled = true; };
  }, [track?.src, track?.url, media]);

  const url = track !== null && resolved?.src === track.src ? resolved.url : null;

  useEffect(() => {
    onAudioElement?.(url === null ? null : ref.current);
    return () => onAudioElement?.(null);
  }, [url, onAudioElement]);

  useEffect(() => {
    const audio = ref.current;
    if (!audio || music === null || url === null) return;
    let pending = false;
    let retryAt = 0;
    const update = () => {
      if (!clock.ready) return;
      const now = clock.now();
      audio.muted = !soundEnabled;
      audio.volume = Math.min(1, Math.max(0, musicGainAt(music.gain, now)));
      if (audio.readyState < 1) return;
      const target = musicPositionAt(music, now, audio.duration);
      if (target === null) {
        if (!audio.paused) audio.pause();
        return;
      }
      if (!audio.seeking && Math.abs(audio.currentTime - target) > SEEK_THRESHOLD_SECONDS) audio.currentTime = target;
      if (audio.paused && !pending && Date.now() >= retryAt) {
        pending = true;
        void audio.play().catch(() => { retryAt = Date.now() + 2000; }).finally(() => { pending = false; });
      }
    };
    audio.addEventListener("loadedmetadata", update);
    const timer = setInterval(update, 200);
    update();
    return () => { clearInterval(timer); audio.removeEventListener("loadedmetadata", update); };
  }, [music, url, clock, soundEnabled]);

  useEffect(() => () => { ref.current?.pause(); }, [url]);

  if (url === null) return null;
  return <audio ref={ref} className="music-layer" src={url} preload="auto" loop={music?.loop ?? false} aria-hidden="true" />;
}
