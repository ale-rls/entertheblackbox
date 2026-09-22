import { runtimeApi } from "@entertheblackbox/protocol";
import { useEffect, useRef, useState } from "react";
import type { ServerClock } from "@entertheblackbox/shared";
import { SynchronizedAudio, type AudioCue, type SyncStatus } from "./lib/synchronized-audio";

const messages: Record<SyncStatus, string> = {
  disabled: "Enable synchronized audio and keep this page open.",
  loading: "Preparing synchronized soundtrack…",
  ready: "Synchronized audio enabled. Keep this page open.",
  waiting: "Waiting for the synchronized scene…",
  playing: "Synchronized scene audio is playing.",
  error: "Soundtrack unavailable. Check your connection and retry.",
};
export function SynchronizedPhoneAudio({ clock, cue }: { clock: ServerClock; cue: AudioCue | null }) {
  const player = useRef<SynchronizedAudio>();
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<SyncStatus>("disabled");
  useEffect(() => {
    const audio = new SynchronizedAudio(clock, setStatus);
    player.current = audio;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch(runtimeApi("/api/synchronized-audio"), { cache: "no-store" });
        if (!response.ok) throw new Error("catalogue unavailable");
        const sources: unknown = await response.json();
        if (!Array.isArray(sources) || sources.some((s) => typeof s !== "string")) throw new Error("invalid catalogue");
        if (cancelled) return;
        setAvailable(sources.length > 0);
        for (const src of sources as string[]) {
          if (cancelled) return;
          await audio.preload(src).catch(() => { /* Active scene reports failures and allows retry. */ });
        }
      } catch { if (!cancelled) retry = setTimeout(() => void load(), 5000); }
    };
    void load();
    return () => { cancelled = true; clearTimeout(retry); audio.dispose(); player.current = undefined; };
  }, [clock]);
  useEffect(() => { player.current?.setCue(cue); }, [cue?.key, cue?.src, cue?.startedAt, cue?.endsAt, clock]);
  if (!available && !cue) return null;
  return <section className="phone-audio" aria-label="Synchronized audio" onPointerDown={(event) => event.stopPropagation()}>
    <p role="status">{messages[status]}</p>
    {(status === "disabled" || status === "error") && <button type="button" onClick={() => void player.current?.enable()}>Enable synchronized audio</button>}
  </section>;
}
