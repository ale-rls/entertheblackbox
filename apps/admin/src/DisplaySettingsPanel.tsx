import { useEffect, useState, type FormEvent } from "react";
import { DEFAULT_DISPLAY_SETTINGS, displaySettingsSchema, type DisplaySettings } from "@entertheblackbox/protocol";

type LibraryVideo = { src: string; url: string; available: boolean };

/** Signage kiosks aren't part of the running show, so this list is fixed here rather than fetched. */
const SIGNAGE_SPOTS = [{ id: "lobby", label: "Lobby entrance" }];

export function DisplaySettingsPanel({ token }: { token: string }) {
  const [value, setValue] = useState<DisplaySettings>({ ...DEFAULT_DISPLAY_SETTINGS });
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [libraryError, setLibraryError] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryRetry, setLibraryRetry] = useState(0);
  const [groups, setGroups] = useState<{ id: string; label: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoaded(false);
    setError("");
    void fetch("/api/admin/settings/display", { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load display settings (${response.status}).`);
        const result = await response.json();
        const parsed = displaySettingsSchema.safeParse(result.display);
        if (!parsed.success) throw new Error("The server returned invalid display settings. Retry or check the server version.");
        const display = parsed.data;
        if (abort.signal.aborted) return;
        setGroups(Array.isArray(result.groups) ? result.groups : []);
        setValue(display); setConfigured(result.configured === true); setLoaded(true);
      }).catch((error: unknown) => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : "Could not load settings."); });
    return () => abort.abort();
  }, [token, retry]);
  useEffect(() => {
    const abort = new AbortController();
    setLibraryLoading(true); setLibraryError("");
    void fetch("/api/admin/settings/waiting-videos", { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the media library. Retry to choose a video.");
        const result = await response.json();
        if (!Array.isArray(result.videos)) throw new Error("The server returned an invalid media library.");
        if (!abort.signal.aborted) setVideos(result.videos);
      }).catch((error: unknown) => { if (!abort.signal.aborted) setLibraryError(error instanceof Error ? error.message : "Could not load the media library."); })
      .finally(() => { if (!abort.signal.aborted) setLibraryLoading(false); });
    return () => abort.abort();
  }, [token, libraryRetry]);
  const videoOptions = (current: string) => <>
    {current && !videos.some((video) => video.url === current) && <option value={current}>Saved video (not in library): {current}</option>}
    {videos.map((video) => <option key={video.url} value={video.url} disabled={!video.available}>{video.src}{video.available ? "" : " — syncing to server"}</option>)}
  </>;
  const edit = (patch: Partial<DisplaySettings>) => { setValue((current) => ({ ...current, ...patch })); setNotice(""); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = displaySettingsSchema.safeParse(value);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the settings."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/settings/display", {
        method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      if (!response.ok) throw new Error(`Could not save display settings (${response.status}). Your edits are still here.`);
      setNotice("Saved to PocketBase. Open displays update within five seconds.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save settings."); }
    finally { setBusy(false); }
  };
  return <section className="sc-tool-panel" aria-labelledby="display-settings-heading">
    <h2 id="display-settings-heading">Display text and waiting video</h2>
    <p className="sc-tool-help">Join-screen text for this platform, stored in PocketBase. These changes apply live to open displays.</p>
    {!loaded ? <><p>Loading display settings…</p>{error && <button type="button" className="sc-tool-button" onClick={() => setRetry((n) => n + 1)}>Retry loading settings</button>}</> : <form onSubmit={(event) => void save(event)}>
      <fieldset disabled={busy || !configured} style={{ border: 0, padding: 0, margin: 0 }}>
        <label className="sc-tool-label">Join heading<input className="sc-tool-field" value={value.heading} maxLength={160} onChange={(e) => edit({ heading: e.target.value })} /></label>
        <label className="sc-tool-label">Countdown wording<input className="sc-tool-field" value={value.countdownTemplate} maxLength={160} onChange={(e) => edit({ countdownTemplate: e.target.value })} /></label>
        <p className="sc-tool-help">Include {"{time}"} where the remaining time should appear.</p>
        <label className="sc-tool-label">Network instructions<textarea className="sc-tool-field" rows={3} value={value.networkInstructions} maxLength={600} onChange={(e) => edit({ networkInstructions: e.target.value })} /></label>
        <p className="sc-tool-help">Use {"{wifi}"} for the configured Wi-Fi name, or write the network name directly. Leave blank to hide this line.</p>
        <label className="sc-tool-label">Joining instructions<textarea className="sc-tool-field" rows={3} value={value.joinInstructions} maxLength={600} onChange={(e) => edit({ joinInstructions: e.target.value })} /></label>
        <label className="sc-tool-checkbox"><input type="checkbox" checked={value.showJoinUrl} onChange={(e) => edit({ showJoinUrl: e.target.checked })} />Show the phone join URL</label>
        <h3>Lobby and waiting video</h3>
        <p className="sc-tool-help">Choose a video from the shared media library. It loops muted while a display waits in the lobby or between group paths. Add videos in Studio → Media library.</p>
        {libraryLoading && <p role="status">Loading media library…</p>}
        {libraryError && <p role="alert">{libraryError}</p>}
        <button className="sc-tool-button" type="button" disabled={libraryLoading} onClick={() => setLibraryRetry((n) => n + 1)}>Refresh media library</button>
        {!libraryLoading && !libraryError && videos.length === 0 && <p>No videos in the media library yet.</p>}
        <label className="sc-tool-label">Default waiting video<select className="sc-tool-field" value={value.waitingVideoUrl} onChange={(e) => edit({ waitingVideoUrl: e.target.value })}>
          <option value="">Use bundled lobby clips / black group displays</option>
          {videoOptions(value.waitingVideoUrl)}
        </select></label>
        {groups.map((group) => {
          const override = value.groupWaitingVideoUrls[group.id];
          const setOverride = (url: string | undefined) => {
            const overrides = { ...value.groupWaitingVideoUrls };
            if (url === undefined) delete overrides[group.id]; else overrides[group.id] = url;
            edit({ groupWaitingVideoUrls: overrides });
          };
          return <fieldset key={group.id}>
            <legend>{group.label} ({group.id})</legend>
            <label className="sc-tool-label">{group.label} waiting video<select className="sc-tool-field" value={override === undefined ? "inherit" : override} onChange={(e) => setOverride(e.target.value === "inherit" ? undefined : e.target.value)}>
              <option value="inherit">Use default</option><option value="">Black screen</option>
              {videoOptions(override ?? "")}
            </select></label>
          </fieldset>;
        })}
        {groups.length === 0 && <p className="sc-tool-help">Per-group settings appear when the active show defines groups.</p>}
        <h3>Signage kiosks</h3>
        <p className="sc-tool-help">A signage kiosk always shows its video and the live join QR code, independent of the show's state — for a screen near the entrance, for example. Open it at <span className="sc-tool-mono">/display/?signage=&lt;id&gt;</span>.</p>
        {SIGNAGE_SPOTS.map((spot) => {
          const override = value.signageVideoUrls[spot.id];
          const setOverride = (url: string | undefined) => {
            const overrides = { ...value.signageVideoUrls };
            if (url === undefined) delete overrides[spot.id]; else overrides[spot.id] = url;
            edit({ signageVideoUrls: overrides });
          };
          return <fieldset key={spot.id}>
            <legend>{spot.label} (?signage={spot.id})</legend>
            <label className="sc-tool-label">{spot.label} video<select className="sc-tool-field" value={override === undefined ? "inherit" : override} onChange={(e) => setOverride(e.target.value === "inherit" ? undefined : e.target.value)}>
              <option value="inherit">Use default</option><option value="">Black screen (QR only)</option>
              {videoOptions(override ?? "")}
            </select></label>
          </fieldset>;
        })}
        <button className="sc-tool-button" data-sc-tool-variant="primary" type="submit">{busy ? "Saving…" : "Save display settings"}</button>
      </fieldset>
      {!configured && <p role="status">PocketBase persistence is not configured. Display text cannot be saved.</p>}
    </form>}
    {error && <p role="alert" className="sc-tool-feedback">{error}</p>}
    {notice && <p role="status" className="sc-tool-feedback">{notice}</p>}
  </section>;
}
