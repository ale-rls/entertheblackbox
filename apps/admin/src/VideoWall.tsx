import { useEffect, useMemo, useRef, useState } from "react";
import {
  duplicateWallLabels, WALL_CLIP_NAME, WALL_MAX_COLS, WALL_MAX_ROWS, wallFfmpegCommand, wallSliceFileName, wallSlicePlan, wallSlotIds,
  type WallLayout, type WallSlice,
} from "@entertheblackbox/shared";

type DeviceStatus = { clip: string | null; state: "idle" | "downloading" | "ready" | "playing" | "ended" | "error"; driftMs?: number; detail?: string; at: number };
type Device = { clientId: string; name: string; slot: string | null; connected: boolean; status?: DeviceStatus };
type Clip = { id: string; slices: Record<string, { src: string; bytes: number }> };
export type WallSnapshot = {
  layout: WallLayout;
  state: { clip: string | null; startAt: number | null; loop: boolean };
  devices: Device[];
  serverNow: number;
  clips: Clip[] | null;
  clipsError?: string;
};

const POLL_MS = 1_000;
const naturally = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Short operator-facing state for one wall position. */
export function slotState(device: Device | undefined, clip: string | null): { text: string; tone: "success" | "warning" | "danger" | "info" } {
  if (!device) return { text: "No tablet", tone: "warning" };
  if (!device.connected) return { text: "Offline", tone: "danger" };
  const status = device.status;
  if (!clip) return { text: "Connected", tone: "info" };
  if (!status || status.clip !== clip) return { text: "Waiting for tablet", tone: "warning" };
  if (status.state === "error") return { text: status.detail ?? "Error", tone: "danger" };
  if (status.state === "downloading") return { text: "Downloading", tone: "info" };
  if (status.detail) return { text: status.detail, tone: "warning" };
  if (status.state === "playing") {
    const drift = status.driftMs ?? 0;
    return { text: `Playing ${drift >= 0 ? "+" : ""}${drift} ms`, tone: Math.abs(drift) > 100 ? "warning" : "success" };
  }
  if (status.state === "ended") return { text: "Ended", tone: "info" };
  return { text: "Ready", tone: "success" };
}

/** Comma-separated slice sheet for the editor. */
export function sliceSheetCsv(layout: WallLayout, clip: string): string {
  const rows = [["slot", "tablet", "crop_x", "crop_y", "crop_w", "crop_h", "export_w", "export_h", "premiere_scale_pct", "premiere_position_x", "premiere_position_y", "file"]];
  for (const slice of wallSlicePlan(layout).slices) {
    rows.push([slice.id, layout.slots[slice.id] ?? "", ...[slice.crop.x, slice.crop.y, slice.crop.w, slice.crop.h, slice.export.widthPx, slice.export.heightPx,
      slice.premiere.scalePercent, slice.premiere.positionX, slice.premiere.positionY].map(String), wallSliceFileName(clip, slice.id)]);
  }
  return rows.map((row) => row.join(",")).join("\n") + "\n";
}

/**
 * Admin → Wall: the tablet video wall. Layout and slice calculator (slices are
 * cut by hand in an editor), tablet-to-position assignment, and synced playback.
 */
export function VideoWall({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<WallSnapshot | null>(null);
  const [draft, setDraft] = useState<WallLayout | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedClip, setSelectedClip] = useState("");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const refresh = async () => {
    const response = await fetch("/api/admin/wall", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(response.status === 401 ? "Operator sign-in expired." : `Wall unavailable (${response.status}).`);
    const next = await response.json() as WallSnapshot;
    setSnapshot(next);
    // Keep the operator's unsaved edits; otherwise follow the server.
    if (!dirtyRef.current) setDraft(next.layout);
  };
  useEffect(() => {
    let stopped = false;
    const poll = () => { void refresh().then(() => { if (!stopped) setError(""); }).catch((reason: unknown) => { if (!stopped) setError(reason instanceof Error ? reason.message : "Wall unavailable."); }); };
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const command = async (body: unknown, done?: string) => {
    try {
      const response = await fetch("/api/admin/wall", { method: "POST", headers, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { error?: string; delivered?: number };
      if (!response.ok) throw new Error(result.error === "unknown_clip" ? "That clip is no longer in the media library." : result.error === "no_clip_loaded" ? "Load a clip first." : `Wall command failed (${response.status}).`);
      setError(""); if (done) setNotice(`${done} · sent to ${result.delivered ?? 0} tablets`);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Wall command failed."); }
  };
  const saveLayout = async () => {
    if (!draft) return;
    try {
      const response = await fetch("/api/admin/wall/layout", { method: "PUT", headers, body: JSON.stringify(draft) });
      if (!response.ok) throw new Error(`Could not save the layout (${response.status}). Check the values.`);
      setDirty(false); setError(""); setNotice("Layout saved");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the layout."); }
  };
  const edit = (change: (layout: WallLayout) => WallLayout) => { setDraft((current) => current ? change(current) : current); setDirty(true); };

  if (!snapshot || !draft) return <section className="sc-tool-panel"><h2>Video wall</h2><p className="sc-tool-help">{error || "Loading…"}</p></section>;

  const clips = snapshot.clips ?? [];
  const loaded = snapshot.state.clip;
  const pickedClip = selectedClip || loaded || clips[0]?.id || "";
  const slotIds = wallSlotIds(snapshot.layout);
  const loadedClip = clips.find((clip) => clip.id === loaded);
  const assigned = slotIds.filter((slot) => snapshot.layout.slots[slot]);
  const deviceBySlot = new Map(snapshot.devices.filter((device) => device.slot).map((device) => [device.slot!, device]));
  const ready = assigned.filter((slot) => ["Ready", "Ended"].includes(slotState(deviceBySlot.get(slot), loaded).text) || slotState(deviceBySlot.get(slot), loaded).text.startsWith("Playing")).length;
  const playing = snapshot.state.startAt !== null;

  return <div className="video-wall">
    <section className="sc-tool-panel video-wall-section" aria-labelledby="wall-playback-heading">
      <div className="admin-section-heading">
        <div><p className="sc-tool-eyebrow">Tablet video wall</p><h2 id="wall-playback-heading">Playback</h2></div>
        <span className="sc-tool-mono admin-section-count">{loaded ? `${loaded} · ${ready}/${assigned.length} ready` : "Nothing loaded"}{playing ? " · playing" : ""}</span>
      </div>
      <p className="sc-tool-help">Load a clip so every tablet downloads and checks its slice, wait until they are ready, then play. Tablets start together on the shared clock and keep correcting their position. Tablets must be in show mode to show the wall.</p>
      {error && <p className="sc-tool-feedback" data-sc-tool-status="danger" role="alert">{error}</p>}
      {notice && !error && <p className="sc-tool-feedback" data-sc-tool-status="info" role="status">{notice}</p>}
      {snapshot.clipsError && <p className="sc-tool-feedback" data-sc-tool-status="warning">{snapshot.clipsError}</p>}
      <div className="video-wall-row">
        <label className="sc-tool-label">Clip
          <select className="sc-tool-field" value={pickedClip} onChange={(event) => setSelectedClip(event.target.value)} disabled={clips.length === 0}>
            {clips.length === 0 && <option value="">No wall clips in the media library</option>}
            {clips.map((clip) => {
              const have = slotIds.filter((slot) => clip.slices[slot]).length;
              return <option key={clip.id} value={clip.id}>{clip.id} ({have}/{slotIds.length} positions)</option>;
            })}
          </select>
        </label>
        <button type="button" className="sc-tool-button" data-sc-tool-variant={loaded === pickedClip ? "secondary" : "primary"} disabled={!pickedClip} onClick={() => void command({ action: "load", clip: pickedClip }, `Loaded ${pickedClip}`)}>{loaded === pickedClip ? "Reload" : "Load on tablets"}</button>
        <button type="button" className="sc-tool-button" data-sc-tool-variant="primary" disabled={!loaded} onClick={() => void command({ action: "play" }, playing ? "Restarted" : "Playing")}>{playing ? "Restart" : "Play"}</button>
        <button type="button" className="sc-tool-button" disabled={!loaded || !playing} onClick={() => void command({ action: "cue" }, "Back to first frame")}>Cue to start</button>
        <button type="button" className="sc-tool-button" data-sc-tool-variant="danger" disabled={!loaded} onClick={() => void command({ action: "stop" }, "Wall cleared")}>Stop</button>
        <label className="video-wall-check"><input type="checkbox" checked={snapshot.state.loop} onChange={(event) => void command({ action: "loop", loop: event.target.checked })} /> Loop</label>
      </div>
      {loadedClip && <MissingSlices clip={loadedClip} slots={slotIds} />}
      {!loadedClip && pickedClip && clips.find((clip) => clip.id === pickedClip) && <MissingSlices clip={clips.find((clip) => clip.id === pickedClip)!} slots={slotIds} />}
      <p className="sc-tool-help">Upload slices in Studio → Media library, named <code>&lt;clip&gt;__&lt;position&gt;.mp4</code> (for example <code>ocean__A1.mp4</code>). The calculator below lists the exact names.</p>
    </section>

    <WallMap snapshot={snapshot} draft={draft} dirty={dirty} edit={edit} onSave={() => void saveLayout()} token={token} clip={loaded} />
    <SliceCalculator layout={draft} edit={edit} dirty={dirty} onSave={() => void saveLayout()} defaultClip={pickedClip || "clip"} />
  </div>;
}

function MissingSlices({ clip, slots }: { clip: Clip; slots: string[] }) {
  const missing = slots.filter((slot) => !clip.slices[slot]);
  if (missing.length === 0) return null;
  return <p className="sc-tool-feedback" data-sc-tool-status="warning">{clip.id} has no slice for {missing.join(", ")}. Those tablets keep their surface colour.</p>;
}

function WallMap({ snapshot, draft, dirty, edit, onSave, token, clip }: {
  snapshot: WallSnapshot; draft: WallLayout; dirty: boolean; edit: (change: (layout: WallLayout) => WallLayout) => void; onSave: () => void; token: string; clip: string | null;
}) {
  const names = useMemo(() => [...new Set(snapshot.devices.map((device) => device.name).filter(Boolean))].sort(naturally), [snapshot.devices]);
  const connectedNames = useMemo(() => [...new Set(snapshot.devices.filter((device) => device.connected).map((device) => device.name).filter(Boolean))].sort(naturally), [snapshot.devices]);
  const byName = new Map(snapshot.devices.map((device) => [device.name.trim().toLowerCase(), device]));
  const duplicates = duplicateWallLabels(draft);
  const identify = (clientId: string) => void fetch("/api/admin/surface", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ target: [clientId], mode: "identify" }) });
  const assign = (slot: string, label: string) => edit((layout) => {
    const slots = { ...layout.slots };
    if (label) slots[slot] = label; else delete slots[slot];
    return { ...layout, slots };
  });
  const fillInOrder = () => edit((layout) => {
    const slots: Record<string, string> = {};
    wallSlotIds(layout).forEach((slot, index) => { const label = connectedNames[index]; if (label) slots[slot] = label; });
    return { ...layout, slots };
  });

  return <section className="sc-tool-panel video-wall-section" aria-labelledby="wall-map-heading">
    <div className="admin-section-heading">
      <div><p className="sc-tool-eyebrow">Seen from the audience</p><h2 id="wall-map-heading">Wall positions</h2></div>
      <div className="video-wall-row">
        <button type="button" className="sc-tool-button" onClick={fillInOrder} disabled={connectedNames.length === 0}>Fill in label order</button>
        <button type="button" className="sc-tool-button" data-sc-tool-variant="primary" disabled={!dirty} onClick={onSave}>{dirty ? "Save layout" : "Saved"}</button>
      </div>
    </div>
    <p className="sc-tool-help">A1 is top-left as the audience sees the wall. Pick the tablet that hangs in each position; Identify flashes it with its label. Changes reach the tablets when you save.</p>
    {duplicates.length > 0 && <p className="sc-tool-feedback" data-sc-tool-status="warning">Assigned to more than one position: {duplicates.join(", ")}. Only the first position gets a slice.</p>}
    <div className="video-wall-grid" style={{ gridTemplateColumns: `repeat(${draft.cols}, minmax(7rem, 1fr))` }}>
      {wallSlotIds(draft).map((slot) => {
        const label = draft.slots[slot] ?? "";
        const device = label ? byName.get(label.trim().toLowerCase()) : undefined;
        const state = slotState(dirty ? device : device && device.slot === slot ? device : undefined, clip);
        return <div key={slot} className="video-wall-cell" data-tone={state.tone}>
          <strong className="sc-tool-mono">{slot}</strong>
          <select aria-label={`Tablet at ${slot}`} className="sc-tool-field" value={label} onChange={(event) => assign(slot, event.target.value)}>
            <option value="">—</option>
            {[...new Set([...names, ...(label ? [label] : [])])].map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <span className="video-wall-state">{state.text}</span>
          {device?.connected && <button type="button" className="sc-tool-button video-wall-identify" onClick={() => identify(device.clientId)}>Identify</button>}
        </div>;
      })}
    </div>
  </section>;
}

function NumberField({ label, value, onChange, step = 1, min = 0, max, unit }: { label: string; value: number; onChange: (value: number) => void; step?: number; min?: number; max?: number; unit?: string }) {
  return <label className="sc-tool-label video-wall-number">{label}{unit ? <span className="sc-tool-mono"> ({unit})</span> : null}
    <input className="sc-tool-field sc-tool-mono" type="number" inputMode="decimal" step={step} min={min} max={max} value={Number.isFinite(value) ? value : ""}
      onChange={(event) => { const next = Number(event.target.value); if (event.target.value !== "" && Number.isFinite(next)) onChange(next); }} />
  </label>;
}

function SliceCalculator({ layout, edit, dirty, onSave, defaultClip }: {
  layout: WallLayout; edit: (change: (layout: WallLayout) => WallLayout) => void; dirty: boolean; onSave: () => void; defaultClip: string;
}) {
  const [clip, setClip] = useState(defaultClip);
  const [input, setInput] = useState("master.mov");
  const [reference, setReference] = useState<{ url: string; video: boolean } | null>(null);
  const [copied, setCopied] = useState("");
  useEffect(() => () => { if (reference) URL.revokeObjectURL(reference.url); }, [reference]);
  const valid = layout.cols >= 1 && layout.rows >= 1 && layout.screen.widthMm > 0 && layout.screen.heightMm > 0 && layout.source.widthPx > 0 && layout.source.heightPx > 0;
  const plan = useMemo(() => valid ? wallSlicePlan(layout) : null, [layout, valid]);
  const clipValid = WALL_CLIP_NAME.test(clip);
  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text).then(() => { setCopied(what); window.setTimeout(() => setCopied(""), 1_500); }).catch(() => setCopied("Copy failed"));
  };
  const downloadSheet = () => {
    const url = URL.createObjectURL(new Blob([sliceSheetCsv(layout, clip)], { type: "text/csv" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: `${clip}-slices.csv` });
    link.click(); URL.revokeObjectURL(url);
  };
  const set = (change: (layout: WallLayout) => WallLayout) => edit(change);

  return <section className="sc-tool-panel video-wall-section" aria-labelledby="wall-calc-heading">
    <div className="admin-section-heading">
      <div><p className="sc-tool-eyebrow">Cut slices in Premiere or similar</p><h2 id="wall-calc-heading">Slice calculator</h2></div>
      <button type="button" className="sc-tool-button" data-sc-tool-variant="primary" disabled={!dirty} onClick={onSave}>{dirty ? "Save layout" : "Saved"}</button>
    </div>
    <p className="sc-tool-help">Measure the visible screen area of one tablet as mounted, and the distance between the screens of neighbouring tablets (both bezels plus any spacing). The parts of the video behind those gaps are left out, so lines stay straight across the wall.</p>
    <div className="video-wall-fields">
      <NumberField label="Columns" value={layout.cols} min={1} max={WALL_MAX_COLS} onChange={(cols) => set((l) => ({ ...l, cols: Math.min(WALL_MAX_COLS, Math.max(1, Math.round(cols))) }))} />
      <NumberField label="Rows" value={layout.rows} min={1} max={WALL_MAX_ROWS} onChange={(rows) => set((l) => ({ ...l, rows: Math.min(WALL_MAX_ROWS, Math.max(1, Math.round(rows))) }))} />
      <NumberField label="Screen width" unit="mm" step={0.1} value={layout.screen.widthMm} onChange={(widthMm) => set((l) => ({ ...l, screen: { ...l.screen, widthMm } }))} />
      <NumberField label="Screen height" unit="mm" step={0.1} value={layout.screen.heightMm} onChange={(heightMm) => set((l) => ({ ...l, screen: { ...l.screen, heightMm } }))} />
      <NumberField label="Gap across" unit="mm" step={0.1} value={layout.gapMm.x} onChange={(x) => set((l) => ({ ...l, gapMm: { ...l.gapMm, x } }))} />
      <NumberField label="Gap down" unit="mm" step={0.1} value={layout.gapMm.y} onChange={(y) => set((l) => ({ ...l, gapMm: { ...l.gapMm, y } }))} />
      <NumberField label="Tablet resolution width" unit="px" value={layout.screen.widthPx} min={1} onChange={(widthPx) => set((l) => ({ ...l, screen: { ...l.screen, widthPx: Math.round(widthPx) } }))} />
      <NumberField label="Tablet resolution height" unit="px" value={layout.screen.heightPx} min={1} onChange={(heightPx) => set((l) => ({ ...l, screen: { ...l.screen, heightPx: Math.round(heightPx) } }))} />
      <NumberField label="Master width" unit="px" value={layout.source.widthPx} min={1} onChange={(widthPx) => set((l) => ({ ...l, source: { ...l.source, widthPx: Math.round(widthPx) } }))} />
      <NumberField label="Master height" unit="px" value={layout.source.heightPx} min={1} onChange={(heightPx) => set((l) => ({ ...l, source: { ...l.source, heightPx: Math.round(heightPx) } }))} />
      <NumberField label="Frame rate" unit="fps" step={0.001} value={layout.source.fps} min={1} onChange={(fps) => set((l) => ({ ...l, source: { ...l.source, fps } }))} />
      <label className="sc-tool-label">Framing
        <select className="sc-tool-field" value={layout.fit} onChange={(event) => set((l) => ({ ...l, fit: event.target.value as WallLayout["fit"] }))}>
          <option value="fill">Fill the wall (crop master edges)</option>
          <option value="fit">Fit the master (black around it)</option>
        </select>
      </label>
    </div>
    {!plan ? <p className="sc-tool-feedback" data-sc-tool-status="warning">Enter positive sizes to see the slices.</p> : <>
      <p className="sc-tool-help sc-tool-mono">Wall {plan.wallMm.width} × {plan.wallMm.height} mm · {plan.pxPerMm.toFixed(2)} master px per mm · slice {plan.slices[0]!.crop.w} × {plan.slices[0]!.crop.h} master px{plan.slices[0]!.crop.w > layout.screen.widthPx ? "" : ` (tablet shows ${layout.screen.widthPx} px wide: ${(layout.screen.widthPx / plan.slices[0]!.crop.w).toFixed(1)}× upscaled)`}</p>
      <div className="video-wall-row">
        <label className="sc-tool-label">Reference video or still (stays on this computer)
          <input className="sc-tool-field" type="file" accept="video/*,image/*" onChange={(event) => {
            const file = event.target.files?.[0];
            setReference(file ? { url: URL.createObjectURL(file), video: file.type.startsWith("video/") } : null);
          }} />
        </label>
      </div>
      <SlicePreview layout={layout} plan={plan} reference={reference} />
      <div className="video-wall-row">
        <label className="sc-tool-label">Clip name (file names)
          <input className="sc-tool-field sc-tool-mono" value={clip} onChange={(event) => setClip(event.target.value)} aria-invalid={!clipValid} />
        </label>
        <label className="sc-tool-label">Master file (ffmpeg)
          <input className="sc-tool-field sc-tool-mono" value={input} onChange={(event) => setInput(event.target.value)} />
        </label>
        <button type="button" className="sc-tool-button" disabled={!clipValid} onClick={downloadSheet}>Download slice sheet (CSV)</button>
        <button type="button" className="sc-tool-button" disabled={!clipValid} onClick={() => copy(plan.slices.map((slice) => wallFfmpegCommand(layout, slice, input, clip)).join("\n"), "All ffmpeg commands copied")}>Copy all ffmpeg commands</button>
        {copied && <span className="sc-tool-mono" role="status">{copied}</span>}
      </div>
      {!clipValid && <p className="sc-tool-feedback" data-sc-tool-status="warning">Use letters, digits and dashes for the clip name (no spaces or underscores).</p>}
      <div className="video-wall-table-wrap">
        <table className="video-wall-table">
          <thead><tr><th>Position</th><th>Tablet</th><th>Crop in master (x, y, w × h)</th><th>Premiere sequence</th><th>Scale</th><th>Position</th><th>Export as</th><th /></tr></thead>
          <tbody>{plan.slices.map((slice) => <SliceRow key={slice.id} slice={slice} layout={layout} clip={clip} input={input} copy={copy} />)}</tbody>
        </table>
      </div>
      <details className="sc-tool-help video-wall-howto">
        <summary>How to cut the slices</summary>
        <ol>
          <li><strong>Premiere Pro:</strong> for each position, make a new sequence with the frame size from <em>Premiere sequence</em> and the master's frame rate. Drop the master in, open Effect Controls → Motion and set <em>Scale</em> and <em>Position</em> from the table (anchor point left at the default centre). Export as H.264 with the file name shown.</li>
          <li><strong>Or ffmpeg:</strong> the copy button gives one command per slice with the right crop, size and encoder settings.</li>
          <li><strong>Every slice:</strong> same frame rate and length as the master, H.264 MP4, no audio needed (sound comes from the room), a keyframe every second so tablets can catch up quickly.</li>
          <li>Upload all slices in Studio → Media library, then Load the clip here.</li>
        </ol>
      </details>
    </>}
  </section>;
}

function SliceRow({ slice, layout, clip, input, copy }: { slice: WallSlice; layout: WallLayout; clip: string; input: string; copy: (text: string, what: string) => void }) {
  const { crop, premiere } = slice;
  return <tr>
    <td className="sc-tool-mono">{slice.id}</td>
    <td>{layout.slots[slice.id] ?? "—"}</td>
    <td className="sc-tool-mono">{crop.x}, {crop.y}, {crop.w} × {crop.h}</td>
    <td className="sc-tool-mono">{slice.export.widthPx} × {slice.export.heightPx}</td>
    <td className="sc-tool-mono">{premiere.scalePercent} %</td>
    <td className="sc-tool-mono">{premiere.positionX}, {premiere.positionY}</td>
    <td className="sc-tool-mono">{wallSliceFileName(clip, slice.id)}</td>
    <td><button type="button" className="sc-tool-button video-wall-copy" onClick={() => copy(wallFfmpegCommand(layout, slice, input, clip), `${slice.id} command copied`)}>ffmpeg</button></td>
  </tr>;
}

/** The master frame with each tablet's slice drawn on it; gaps and cropped-away areas are darkened. */
function SlicePreview({ layout, plan, reference }: { layout: WallLayout; plan: ReturnType<typeof wallSlicePlan>; reference: { url: string; video: boolean } | null }) {
  const { widthPx: sw, heightPx: sh } = layout.source;
  const x0 = Math.min(0, plan.wallPx.x), y0 = Math.min(0, plan.wallPx.y);
  const vw = Math.max(sw, plan.wallPx.x + plan.wallPx.w) - x0, vh = Math.max(sh, plan.wallPx.y + plan.wallPx.h) - y0;
  const outside = `M${x0} ${y0}H${x0 + vw}V${y0 + vh}H${x0}Z` + plan.slices.map(({ crop: c }) => `M${c.x} ${c.y}h${c.w}v${c.h}h${-c.w}Z`).join("");
  const font = Math.max(vw, vh) / 40;
  const frame = { left: `${(-x0 / vw) * 100}%`, top: `${(-y0 / vh) * 100}%`, width: `${(sw / vw) * 100}%`, height: `${(sh / vh) * 100}%` };
  return <div className="video-wall-preview" style={{ aspectRatio: `${vw} / ${vh}` }}>
    <div className="video-wall-preview-frame" style={frame}>
      {reference && (reference.video
        ? <video src={reference.url} muted loop autoPlay playsInline />
        : <img src={reference.url} alt="" />)}
    </div>
    <svg viewBox={`${x0} ${y0} ${vw} ${vh}`} role="img" aria-label={`Master frame with ${plan.slices.length} tablet slices`}>
      <path d={outside} fillRule="evenodd" className="video-wall-preview-hidden" />
      <rect x={0} y={0} width={sw} height={sh} className="video-wall-preview-master" />
      {plan.slices.map((slice) => <g key={slice.id}>
        <rect x={slice.crop.x} y={slice.crop.y} width={slice.crop.w} height={slice.crop.h} className="video-wall-preview-slice" />
        <text x={slice.crop.x + font * 0.5} y={slice.crop.y + font * 1.2} fontSize={font} className="video-wall-preview-label">{slice.id}{layout.slots[slice.id] ? ` · ${layout.slots[slice.id]}` : ""}</text>
      </g>)}
    </svg>
  </div>;
}
