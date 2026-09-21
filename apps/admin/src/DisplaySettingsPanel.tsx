import { useEffect, useState, type FormEvent } from "react";
import { DEFAULT_DISPLAY_SETTINGS, displaySettingsSchema, type DisplaySettings } from "@entertheblackbox/protocol";

export function DisplaySettingsPanel({ token }: { token: string }) {
  const [value, setValue] = useState<DisplaySettings>({ ...DEFAULT_DISPLAY_SETTINGS });
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
        <p className="sc-tool-help">Muted, looping video while a display waits in the lobby or between group paths. Active scenes keep their own media. Use a direct browser-playable video URL (for example /media/waiting.mp4), not a YouTube page. Files must already be hosted and reachable by the displays.</p>
        <label className="sc-tool-label">Default waiting video URL<input className="sc-tool-field" value={value.waitingVideoUrl} onChange={(e) => edit({ waitingVideoUrl: e.target.value })} /></label>
        <p className="sc-tool-help">Leave blank to keep the bundled lobby clips on the main display and black on waiting group displays.</p>
        {groups.map((group) => {
          const override = value.groupWaitingVideoUrls[group.id];
          const mode = override === undefined ? "inherit" : override === "" ? "black" : "video";
          const setOverride = (url: string | undefined) => {
            const overrides = { ...value.groupWaitingVideoUrls };
            if (url === undefined) delete overrides[group.id]; else overrides[group.id] = url;
            edit({ groupWaitingVideoUrls: overrides });
          };
          return <fieldset key={group.id}>
            <legend>{group.label} ({group.id})</legend>
            <label className="sc-tool-label">Waiting display<select className="sc-tool-field" value={mode} onChange={(e) => setOverride(e.target.value === "inherit" ? undefined : e.target.value === "black" ? "" : value.waitingVideoUrl || "/media/waiting.mp4")}>
              <option value="inherit">Use default</option><option value="black">Black screen</option><option value="video">Custom video</option>
            </select></label>
            {mode === "video" && <label className="sc-tool-label">{group.label} video URL<input className="sc-tool-field" value={override} onChange={(e) => setOverride(e.target.value)} /></label>}
          </fieldset>;
        })}
        {groups.length === 0 && <p className="sc-tool-help">Per-group settings appear when the active show defines groups.</p>}
        <button className="sc-tool-button" data-sc-tool-variant="primary" type="submit">{busy ? "Saving…" : "Save display settings"}</button>
      </fieldset>
      {!configured && <p role="status">PocketBase persistence is not configured. Display text cannot be saved.</p>}
    </form>}
    {error && <p role="alert" className="sc-tool-feedback">{error}</p>}
    {notice && <p role="status" className="sc-tool-feedback">{notice}</p>}
  </section>;
}
