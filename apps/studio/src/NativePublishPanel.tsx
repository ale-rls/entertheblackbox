import { useRef, useState, type FormEvent } from "react";

// musicSources: MP3 filenames in the shared media library; the server pulls the chosen one from it on publish.
type Props = { token: string; exportScenario: () => unknown; musicSources: string[]; active: boolean; onClose: () => void };
export function NativePublishPanel({ token, exportScenario, musicSources, active, onClose }: Props) {
  const [channel, setChannel] = useState<"rehearsal" | "production">("rehearsal");
  const [musicSrc, setMusicSrc] = useState("");
  const [musicVolume, setMusicVolume] = useState(0.2);
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string }>();
  const inFlight = useRef(false);
  async function publish(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || active || !token) return;
    inFlight.current = true; setWorking(true); setFeedback(undefined);
    try {
      const scenario = exportScenario(); // Compile/validate the current draft, not a stale saved copy.
      const response = await fetch("/api/admin/native-shows/publish", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel, scenario, ...(musicSrc ? { backgroundMusic: { src: musicSrc, volume: musicVolume } } : {}) }),
      });
      const result = await response.json().catch(() => null) as {
        error?: string; message?: string; revision?: string; fileCount?: number; scenarioVersion?: string;
      } | null;
      if (!response.ok) {
        const messages: Record<string, string> = {
          show_active: "Wait until the live show ends before publishing to devices.",
          publish_in_progress: "Another device release is being published. Wait for it to finish and try again.",
          unauthorized: "Your operator session expired. Sign in again to publish.",
          invalid_scenario: "The show graph is invalid. Resolve Diagnostics before publishing.",
          invalid_native_publish_request: "The show could not be exported. Resolve Diagnostics before publishing.",
          native_publishing_unavailable: "This server does not support native publishing yet. Deploy the native publishing server first.",
        };
        throw new Error(messages[result?.error ?? ""] ?? result?.message ?? `Publish failed (${response.status}). Use Studio served by the venue server.`);
      }
      if (!result?.revision || typeof result.fileCount !== "number") throw new Error("The server returned an invalid publication result. Check the channel before retrying.");
      setFeedback({ error: false, message: `Published ${channel}: show ${result.scenarioVersion}, ${result.fileCount} audio files, revision ${result.revision.slice(0, 12)}. Devices download this release on their next join. Activate the matching show on the server separately.` });
    } catch (error) {
      setFeedback({ error: true, message: error instanceof Error ? error.message : "Publication failed. Try again." });
    } finally { inFlight.current = false; setWorking(false); }
  }
  return <form onSubmit={event => void publish(event)}>
    <p className="sc-tool-help">Publish this draft’s audio to the venue server. Referenced MP3s must already be synced there. This replaces the selected device channel; it does not activate a server scenario or update the installed app.</p>
    {active && <p role="status" className="sc-tool-help">A show is running. Publishing becomes available after it ends.</p>}
    <label className="sc-tool-label" htmlFor="native-show-channel">Device channel
      <select id="native-show-channel" className="sc-tool-field" value={channel} disabled={working}
        onChange={event => { setChannel(event.target.value as "rehearsal" | "production"); setFeedback(undefined); }}>
        <option value="rehearsal">Rehearsal</option><option value="production">Production</option>
      </select>
    </label>
    <label className="sc-tool-label" htmlFor="native-show-music">Background music
      <select id="native-show-music" className="sc-tool-field" value={musicSrc} disabled={working} onChange={event => setMusicSrc(event.target.value)}>
        <option value="">No background music</option>
        {musicSources.map(src => <option key={src} value={src}>{src}</option>)}
      </select>
    </label>
    <label className="sc-tool-label">Background music volume
      <input className="sc-tool-field" type="number" min="0.01" max="1" step="0.01" value={musicVolume} disabled={working}
        onChange={event => setMusicVolume(Number(event.target.value))} />
    </label>
    <p className="sc-tool-help">Music loops locally throughout the joined session, including gaps between narration. Choose an audible show soundscape from the media library; upload it there first if it is missing.</p>
    <div className="publish-panel-actions">
      <button className="sc-tool-button" type="button" disabled={working} onClick={onClose}>Close</button>
      <button className="sc-tool-button" data-sc-tool-variant="primary" type="submit" disabled={working || active || !token}>
        {working ? "Publishing audio…" : "Publish to devices"}
      </button>
    </div>
    {feedback && <p role={feedback.error ? "alert" : "status"} className="sc-tool-help">{feedback.message}</p>}
  </form>;
}
