import { useCallback, useEffect, useState } from "react";

export type AnnouncementClip = { id: string; text: string; durationMs: number; createdAt: string };
type Playing = { id: string; startedAt: number; durationMs: number } | null;
type Listing = { clips: AnnouncementClip[]; canGenerate: boolean; playing: Playing; serverNow: number };

const seconds = (ms: number) => `${Math.max(0, Math.round(ms / 1000))} s`;

/** Why a request failed, in operator words. */
export function announcementError(status: number, body: { error?: string; message?: string } | null): string {
  if (status === 401) return "Operator sign-in expired.";
  if (body?.error === "voice_unavailable") return "Voice generation is not set up on the server (ELEVENLABS_API_KEY). Saved clips still play.";
  if (body?.error === "voice_failed") return `The voice service failed: ${body.message ?? "no details"}`;
  if (body?.error === "announcement_not_found") return "That clip no longer exists.";
  if (body?.error === "announcements_unavailable" || body?.error === "show_unavailable") return "Announcements need a running server with PocketBase.";
  if (body?.error === "invalid_announcement") return "Type 1–2000 characters.";
  return `Request failed (${status}).`;
}

/**
 * Operator voice announcements: type a line, the server speaks it with the
 * show's AI voice and keeps it; any saved clip plays on the main display's
 * speakers, with the scene's own audio ducked underneath.
 */
export function Announcements({ token }: { token: string }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [message, setMessage] = useState<{ status: "success" | "warning" | "danger"; text: string } | null>(null);
  const [, setTick] = useState(0);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`/api/admin/announcements${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) } });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) throw new Error(announcementError(response.status, body as { error?: string; message?: string } | null));
    return body ?? {};
  }, [token]);

  const load = useCallback(async () => {
    const body = await request("") as unknown as Listing;
    if (!Array.isArray(body.clips) || typeof body.serverNow !== "number") throw new Error("This server does not offer announcements yet.");
    setOffsetMs(body.serverNow - Date.now());
    setListing(body);
  }, [request]);

  // Not urgent: the rest of the Show tab works without announcements.
  useEffect(() => { load().catch((error: unknown) => setMessage({ status: "warning", text: error instanceof Error ? error.message : "Loading announcements failed." })); }, [load]);

  const playing = listing?.playing ?? null;
  const remainingMs = playing ? playing.startedAt + playing.durationMs - (Date.now() + offsetMs) : 0;
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setTick((value) => value + 1), 500);
    return () => clearInterval(timer);
  }, [playing]);
  useEffect(() => { if (playing && remainingMs <= 0) setListing((current) => current ? { ...current, playing: null } : current); }, [playing, remainingMs]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setMessage(null);
    try { await action(); }
    catch (error) { setMessage({ status: "danger", text: error instanceof Error ? error.message : "Request failed." }); }
    finally { setBusy(null); }
  };
  const play = (id: string) => run(`play-${id}`, async () => {
    const body = await request(`/${encodeURIComponent(id)}/play`, { method: "POST" }) as { delivered: boolean; playing: Playing; serverNow: number };
    setOffsetMs(body.serverNow - Date.now());
    setListing((current) => current ? { ...current, playing: body.playing } : current);
    if (!body.delivered) setMessage({ status: "warning", text: "No main display is connected: nothing played." });
  });
  const generate = (andPlay: boolean) => run("generate", async () => {
    const body = await request("", { method: "POST", body: JSON.stringify({ text }) }) as { clip: AnnouncementClip };
    setText("");
    setListing((current) => current ? { ...current, clips: [body.clip, ...current.clips] } : current);
    if (andPlay) {
      const played = await request(`/${encodeURIComponent(body.clip.id)}/play`, { method: "POST" }) as { delivered: boolean; playing: Playing; serverNow: number };
      setOffsetMs(played.serverNow - Date.now());
      setListing((current) => current ? { ...current, playing: played.playing } : current);
      if (!played.delivered) setMessage({ status: "warning", text: "Saved, but no main display is connected: nothing played." });
    } else setMessage({ status: "success", text: `Saved (${seconds(body.clip.durationMs)}).` });
  });
  const stop = () => run("stop", async () => {
    await request("/stop", { method: "POST" });
    setListing((current) => current ? { ...current, playing: null } : current);
  });
  const remove = (id: string) => run(`delete-${id}`, async () => {
    await request(`/${encodeURIComponent(id)}`, { method: "DELETE" });
    setConfirmDelete(null);
    setListing((current) => current ? { ...current, clips: current.clips.filter((clip) => clip.id !== id), playing: current.playing?.id === id ? null : current.playing } : current);
  });

  const canGenerate = listing?.canGenerate ?? false;
  return <section className="sc-tool-panel announcements" aria-labelledby="announcements-heading">
    <div className="admin-section-heading">
      <div><p className="sc-tool-eyebrow">Main display · room speakers</p><h2 id="announcements-heading">Voice announcements</h2></div>
      {playing && remainingMs > 0 && <button className="sc-tool-button" data-sc-tool-variant="danger" type="button" disabled={busy === "stop"} onClick={() => void stop()}>Stop · {seconds(remainingMs)} left</button>}
    </div>
    <p className="sc-tool-help">Spoken with the show's AI voice. Scene audio is lowered while it plays; the scene keeps running. Delivery tags like [amused] or [short pause] work and are not spoken.</p>
    <form onSubmit={(event) => { event.preventDefault(); void generate(true); }}>
      <label className="sc-tool-label" htmlFor="announcement-text">New announcement
        <textarea id="announcement-text" className="sc-tool-field" rows={3} maxLength={2000} value={text} disabled={!canGenerate || busy === "generate"}
          placeholder={canGenerate ? "Was die KI jetzt sagen soll …" : "Voice generation is not set up on the server."}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void generate(true); } }} />
      </label>
      <div className="announcements-actions">
        <button className="sc-tool-button" data-sc-tool-variant="primary" type="submit" disabled={!canGenerate || !text.trim() || busy !== null}>{busy === "generate" ? "Generating…" : "Generate & play"}</button>
        <button className="sc-tool-button" type="button" disabled={!canGenerate || !text.trim() || busy !== null} onClick={() => void generate(false)}>Save for later</button>
      </div>
    </form>
    {message && <p className="sc-tool-feedback" data-sc-tool-status={message.status} role={message.status === "danger" ? "alert" : "status"}>{message.text}</p>}
    {listing && listing.clips.length === 0 && <p className="sc-tool-help">No saved announcements yet.</p>}
    {listing && listing.clips.length > 0 && <ul className="announcements-list">
      {listing.clips.map((clip) => <li key={clip.id} data-playing={playing?.id === clip.id || undefined}>
        <button className="sc-tool-button" data-sc-tool-variant={playing?.id === clip.id ? "primary" : "secondary"} type="button" disabled={busy !== null} onClick={() => void play(clip.id)} aria-label={`Play: ${clip.text}`}>▶ {seconds(clip.durationMs)}</button>
        <span className="announcements-text">{clip.text}</span>
        {confirmDelete === clip.id
          ? <><button className="sc-tool-button" data-sc-tool-variant="danger" type="button" disabled={busy !== null} onClick={() => void remove(clip.id)}>Delete</button><button className="sc-tool-button" type="button" onClick={() => setConfirmDelete(null)}>Keep</button></>
          : <button className="sc-tool-button" type="button" disabled={busy !== null} onClick={() => setConfirmDelete(clip.id)} aria-label={`Delete: ${clip.text}`}>✕</button>}
      </li>)}
    </ul>}
  </section>;
}
