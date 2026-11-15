import { useEffect, useState } from "react";

export type MusicSnapshot = {
  track: string | null;
  loop: boolean;
  volume: number;
  targetVolume: number;
  fadingOut: boolean;
  source: "scene" | "admin" | null;
  phaseId: string | null;
  displayConnected: boolean;
  tracks: { src: string; bytes: number }[] | null;
  tracksError?: string;
};

const POLL_MS = 1_000;
const percent = (value: number) => `${Math.round(value * 100)}%`;

/** One-line description of what the room is hearing. */
export function musicStatusText(music: MusicSnapshot): string {
  if (!music.track) return "No music";
  const origin = music.source === "admin" ? "started in Admin" : music.phaseId ? `cue from ${music.phaseId}` : "scene cue";
  return `${music.track} · ${percent(music.volume)}${music.fadingOut ? " · fading out" : ""} · ${origin}`;
}

/**
 * Admin → Show → Music: room music on the main display. Scene cues drive it
 * during the show; this is the manual override when something goes wrong.
 * The next scene with a music cue takes over again.
 */
export function MusicPanel({ token }: { token: string }) {
  const [music, setMusic] = useState<MusicSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [loop, setLoop] = useState(true);
  const [volume, setVolume] = useState(100);

  const refresh = async () => {
    const response = await fetch("/api/admin/music", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(response.status === 401 ? "Operator sign-in expired." : `Music unavailable (${response.status}).`);
    setMusic(await response.json() as MusicSnapshot);
  };
  useEffect(() => {
    let stopped = false;
    const poll = () => { void refresh().then(() => { if (!stopped) setError(""); }).catch((reason: unknown) => { if (!stopped) setError(reason instanceof Error ? reason.message : "Music unavailable."); }); };
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [token]);

  const send = async (command: Record<string, unknown>) => {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/music", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error === "unknown_track" ? "That track is not in the media library." : body.error === "no_music_playing" ? "No music is playing." : `Music command failed (${response.status}).`);
      setError("");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Music command failed.");
    } finally {
      setBusy(false);
    }
  };

  const playing = Boolean(music?.track);
  return <section className="admin-music" aria-labelledby="admin-music-heading">
    <h3 id="admin-music-heading">Music</h3>
    <p aria-live="polite">{music ? musicStatusText(music) : "Loading…"}{music && !music.displayConnected ? " · main display offline" : ""}</p>
    {error && <p role="alert">{error}</p>}
    <div className="admin-music-row">
      <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={busy || !playing} onClick={() => void send({ action: "stop", fadeMs: 3_000 })}>Fade out</button>
      <button className="sc-tool-button" data-sc-tool-variant="danger" type="button" disabled={busy || !playing} onClick={() => void send({ action: "stop", fadeMs: 0 })}>Stop now</button>
    </div>
    <label className="sc-tool-label">Volume {volume}%
      <input type="range" min={0} max={100} step={5} value={volume} disabled={busy}
        onChange={(event) => setVolume(Number(event.target.value))}
        onPointerUp={() => { if (playing) void send({ action: "volume", volume: volume / 100, fadeMs: 1_000 }); }}
        onKeyUp={() => { if (playing) void send({ action: "volume", volume: volume / 100, fadeMs: 1_000 }); }} />
    </label>
    <div className="admin-music-row">
      <label className="sc-tool-label">Library track
        <select className="sc-tool-select" value={selected} disabled={busy || !music?.tracks?.length} onChange={(event) => setSelected(event.target.value)}>
          <option value="">{music?.tracksError ?? (music?.tracks?.length ? "Choose an MP3…" : "No MP3s in the media library")}</option>
          {music?.tracks?.map((track) => <option key={track.src} value={track.src}>{track.src}</option>)}
        </select>
      </label>
      <label className="sc-tool-label admin-music-loop"><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} /> Loop</label>
      <button className="sc-tool-button" data-sc-tool-variant="primary" type="button" disabled={busy || !selected}
        onClick={() => void send({ action: "play", src: selected, volume: volume / 100, loop, fadeMs: 1_000 })}>Play</button>
    </div>
    <p className="admin-music-help">The next scene with a music cue takes over again.</p>
  </section>;
}
