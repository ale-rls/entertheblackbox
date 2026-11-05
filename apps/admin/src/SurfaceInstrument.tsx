import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Status } from "./App.js";

type Participant = Status["participants"][number];
type Target = "all" | string[];

export const SURFACE_PALETTE = ["#ffffff", "#ff2d2d", "#ff8a00", "#ffe600", "#22d36b", "#00c2ff", "#3d5afe", "#c34dff", "#ff4fa3"] as const;
/** A press shorter than this is a tap: the tablet stays lit for at least TAP_HOLD_MS. */
export const TAP_MS = 200;
export const TAP_HOLD_MS = 250;
const ALL = "__all__";

/** Natural label order, so T2 sorts before T10. */
export const byLabel = (a: Participant, b: Participant) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || a.clientId.localeCompare(b.clientId);

export function duplicateLabels(participants: readonly Participant[]): Set<string> {
  const seen = new Map<string, number>();
  for (const participant of participants) if (participant.connected) {
    const key = participant.name.trim().toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, count]) => count > 1).map(([key]) => key));
}

/**
 * Plays connected tablets as a colour instrument: press a tile to light it,
 * release to return it to its base colour, drag across tiles to play them in
 * turn. Each gesture is one POST; the server schedules it on the shared clock.
 */
export function SurfaceInstrument({ token, participants }: { token: string; participants: Participant[] }) {
  const [color, setColor] = useState<string>(SURFACE_PALETTE[1]);
  const [lit, setLit] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [delivered, setDelivered] = useState<number | null>(null);
  const press = useRef<{ key: string; at: number; pointerId: number } | null>(null);
  const tiles = useMemo(() => [...participants].sort(byLabel), [participants]);
  const duplicates = useMemo(() => duplicateLabels(participants), [participants]);
  const allIds = () => tiles.filter((tile) => tile.connected).map((tile) => tile.clientId);

  const post = (body: { target: Target; mode: "flash" | "release" | "identify"; color?: string }) => {
    void fetch("/api/admin/surface", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 401 ? "Operator sign-in expired." : `Surface command failed (${response.status}).`);
      const result = await response.json() as { delivered?: number };
      setDelivered(result.delivered ?? null);
      setError("");
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Surface command failed."));
  };
  const targetFor = (key: string): Target => key === ALL ? "all" : [key];
  const markLit = (key: string, value: string | null) => setLit((current) => {
    const keys = key === ALL ? [ALL, ...allIds()] : [key];
    const next = { ...current };
    for (const id of keys) { if (value) next[id] = value; else delete next[id]; }
    return next;
  });
  const start = (key: string) => {
    post({ target: targetFor(key), mode: "flash", color });
    markLit(key, color);
  };
  const stop = (key: string, pressedAt: number) => {
    const elapsed = Date.now() - pressedAt;
    const release = () => { post({ target: targetFor(key), mode: "release" }); markLit(key, null); };
    if (elapsed < TAP_MS) window.setTimeout(release, TAP_HOLD_MS - elapsed);
    else release();
  };
  const keyAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest("[data-surface-key]") as HTMLElement | null)?.dataset.surfaceKey ?? null;

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    const key = (event.target as HTMLElement).closest<HTMLElement>("[data-surface-key]")?.dataset.surfaceKey;
    if (!key || press.current || (event.target as HTMLElement).closest("[data-surface-identify]")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    press.current = { key, at: Date.now(), pointerId: event.pointerId };
    start(key);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const key = keyAt(event.clientX, event.clientY);
    if (!key || key === current.key) return;
    // Glissando: hand the note from the previous tile to the one under the pointer.
    stop(current.key, current.at);
    press.current = { key, at: Date.now(), pointerId: event.pointerId };
    start(key);
  };
  const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    press.current = null;
    stop(current.key, current.at);
  };
  const keyboard = (key: string) => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if ((event.key !== " " && event.key !== "Enter") || event.repeat) return;
      event.preventDefault();
      press.current = { key, at: Date.now(), pointerId: -1 };
      start(key);
    },
    onKeyUp: (event: KeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      const current = press.current;
      press.current = null;
      if (current?.key === key) stop(key, current.at);
    },
  });

  return <section className="sc-tool-panel surface-instrument" aria-labelledby="surface-instrument-heading">
    <div className="admin-section-heading">
      <div><p className="sc-tool-eyebrow">Tablet surfaces</p><h2 id="surface-instrument-heading">Colour instrument</h2></div>
      <span className="sc-tool-mono admin-section-count">{tiles.filter((tile) => tile.connected).length} connected{delivered === null ? "" : ` · last reached ${delivered}`}</span>
    </div>
    <p className="sc-tool-help">Press a tablet to light it, release to return it to its base colour, drag across tablets to play them in turn. Changes are scheduled on the shared clock, so every addressed tablet switches together. Tablets show the colour in show mode.</p>
    <div className="surface-palette" role="radiogroup" aria-label="Colour">
      {SURFACE_PALETTE.map((swatch) => <button key={swatch} type="button" role="radio" aria-checked={color === swatch} aria-label={swatch} className="surface-swatch" style={{ backgroundColor: swatch }} onClick={() => setColor(swatch)} />)}
      <label className="surface-custom">Custom<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
    </div>
    {error && <p className="sc-tool-feedback" data-sc-tool-status="danger" role="alert">{error}</p>}
    {duplicates.size > 0 && <p className="sc-tool-feedback" data-sc-tool-status="warning" role="status">Duplicate tablet labels: {[...duplicates].join(", ")}. Set a unique label in each tablet's Device settings.</p>}
    <div className="surface-grid" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
      <button type="button" className="surface-tile surface-tile-all" data-surface-key={ALL} style={lit[ALL] ? { backgroundColor: lit[ALL] } : undefined} {...keyboard(ALL)}>
        <strong>All tablets</strong>
      </button>
      {tiles.map((tile) => <div key={tile.clientId} role="button" tabIndex={tile.connected ? 0 : -1} aria-disabled={!tile.connected} aria-label={`Play ${tile.name}`}
        className={`surface-tile${tile.connected ? "" : " is-disconnected"}${duplicates.has(tile.name.trim().toLowerCase()) ? " is-duplicate" : ""}`}
        data-surface-key={tile.connected ? tile.clientId : undefined} style={lit[tile.clientId] ? { backgroundColor: lit[tile.clientId] } : undefined} {...(tile.connected ? keyboard(tile.clientId) : {})}>
        <strong>{tile.name}</strong>
        <span>{tile.connected ? "Connected" : "Disconnected"}</span>
        {tile.connected && <button type="button" className="sc-tool-button surface-identify" data-surface-identify onClick={() => post({ target: [tile.clientId], mode: "identify" })}>Identify</button>}
      </div>)}
    </div>
  </section>;
}
