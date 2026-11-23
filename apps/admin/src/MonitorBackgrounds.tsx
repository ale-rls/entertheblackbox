import { useState } from "react";
import { MONITOR_IDS, MONITOR_TEXT_COLOR_PRESETS, type MonitorId } from "@entertheblackbox/scenario";

export type MonitorBackgroundColors = Partial<Record<MonitorId, string>>;

/**
 * Live background colour per stage monitor. A colour set here overrides the
 * monitor's scheduled cue background until it is cleared (or the show
 * returns to idle).
 */
export function MonitorBackgrounds({ token, colors, onChange }: {
  token: string;
  colors: MonitorBackgroundColors;
  onChange: (colors: MonitorBackgroundColors) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (next: MonitorBackgroundColors) => {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/monitor-backgrounds", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ colors: next }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? "Operator sign-in expired." : `Monitor colours failed (${response.status}).`);
      const result = await response.json() as { colors: MonitorBackgroundColors };
      onChange(result.colors);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Monitor colours failed.");
    } finally {
      setBusy(false);
    }
  };
  const set = (id: MonitorId, color: string | undefined) => {
    const next = { ...colors };
    if (color === undefined) delete next[id]; else next[id] = color;
    void send(next);
  };
  const anySet = MONITOR_IDS.some((id) => colors[id] !== undefined);
  return <section className="sc-tool-panel monitor-backgrounds" aria-labelledby="monitor-backgrounds-heading">
    <div className="admin-section-heading">
      <div><p className="sc-tool-eyebrow">Stage monitors</p><h2 id="monitor-backgrounds-heading">Monitor backgrounds</h2></div>
      <button className="sc-tool-button" type="button" disabled={busy || !anySet} onClick={() => void send({})}>Clear all</button>
    </div>
    <p className="sc-tool-help">Overrides the scene's monitor backgrounds live until cleared. Cleared automatically when the show returns to idle.</p>
    <div className="monitor-background-rows">
      {MONITOR_IDS.map((id) => {
        const current = colors[id];
        return <div className="monitor-background-row" key={id}>
          <strong className="monitor-background-id" style={current ? { background: current } : undefined}>{id}</strong>
          <div className="surface-palette" role="radiogroup" aria-label={`${id} background`}>
            {MONITOR_TEXT_COLOR_PRESETS.map((preset) => <button key={preset.color} type="button" role="radio" className="surface-swatch"
              aria-checked={current?.toLowerCase() === preset.color} aria-label={`${id} ${preset.name}`} title={preset.name}
              style={{ background: preset.color }} disabled={busy} onClick={() => set(id, preset.color)} />)}
            <input type="color" aria-label={`${id} custom background`} value={current ?? "#000000"} disabled={busy} onChange={(event) => set(id, event.target.value)} />
            <button className="sc-tool-button" type="button" disabled={busy || current === undefined} onClick={() => set(id, undefined)}>Scene</button>
          </div>
        </div>;
      })}
    </div>
    {error && <p className="sc-tool-feedback" data-sc-tool-status="danger" role="alert">{error}</p>}
  </section>;
}
