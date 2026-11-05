import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { dimColor, surfaceEffectColor, SURFACE_EFFECT_KINDS, type SurfaceEffect, type SurfaceEffectKind } from "@entertheblackbox/shared";
import type { Status } from "./App.js";

type Participant = Status["participants"][number];
type Target = "all" | string[];

export const SURFACE_PALETTE = ["#ffffff", "#ff2d2d", "#ff8a00", "#ffe600", "#22d36b", "#00c2ff", "#3d5afe", "#c34dff", "#ff4fa3"] as const;
/** A press shorter than this is a tap: the tablet stays lit for at least TAP_HOLD_MS. */
export const TAP_MS = 200;
export const TAP_HOLD_MS = 250;
/** Abandon a stuck request so later gestures are not held up behind it. */
const POST_TIMEOUT_MS = 3_000;
const ALL = "__all__";

/**
 * Keyboard layout for playing tablets: four rows of ten, in label order, so
 * T01–T40 sit on 1…0, Q…P, A…;, Z…/. Uses physical key codes, so the layout
 * is the same on AZERTY/QWERTZ keyboards.
 */
export const TABLET_KEY_CODES = [
  "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0",
  "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP",
  "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon",
  "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash",
] as const;
const KEY_HINTS: Record<string, string> = { Semicolon: ";", Comma: ",", Period: ".", Slash: "/" };
export const keyHint = (code: string) => KEY_HINTS[code] ?? code.replace(/^(Digit|Key)/, "");

export const EFFECT_LABELS: Record<SurfaceEffectKind, { name: string; help: string }> = {
  chase: { name: "Chase", help: "One tablet at a time, cycling through every tablet in label order." },
  breathe: { name: "Breathe", help: "Every tablet dims up and down together." },
  wave: { name: "Wave", help: "A brightness wave travels across the tablets in label order." },
  gradient: { name: "Gradient wave", help: "A wave blending between the two colours travels across the tablets." },
  rainbow: { name: "Rainbow", help: "The full hue circle travels across the tablets." },
};

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

const isTyping = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element?.tagName) return false;
  if (element.isContentEditable) return true;
  if (element.tagName === "TEXTAREA" || element.tagName === "SELECT") return true;
  return element.tagName === "INPUT" && !["color", "range", "checkbox", "radio", "button"].includes((element as HTMLInputElement).type);
};
/** A focused slider keeps its own arrow keys. */
const isSliderArrow = (event: globalThis.KeyboardEvent) =>
  (event.target as HTMLInputElement | null)?.type === "range" && event.key.startsWith("Arrow");

type Running = { effect: SurfaceEffect; startedAt: number; clockOffset: number };

/**
 * Plays connected tablets as a colour instrument: press a tile (or its key) to
 * light it, release to return it to its base colour, drag across tiles to play
 * them in turn, hold several to play chords. Programmed effects run on the
 * server. Every gesture is one POST; the server schedules it on the shared clock.
 */
export function SurfaceInstrument({ token, participants }: { token: string; participants: Participant[] }) {
  const [color, setColor] = useState<string>(SURFACE_PALETTE[1]);
  const [color2, setColor2] = useState<string>(SURFACE_PALETTE[5]);
  const [brightness, setBrightness] = useState(1);
  const [latch, setLatch] = useState(false);
  const [keyboardOn, setKeyboardOn] = useState(true);
  const [effectKind, setEffectKind] = useState<SurfaceEffectKind>("chase");
  const [periodMs, setPeriodMs] = useState(2_000);
  const [running, setRunning] = useState<Running | null>(null);
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [lit, setLit] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [delivered, setDelivered] = useState<number | null>(null);

  const tiles = useMemo(() => [...participants].sort(byLabel), [participants]);
  const duplicates = useMemo(() => duplicateLabels(participants), [participants]);
  const connectedIds = useMemo(() => tiles.filter((tile) => tile.connected).map((tile) => tile.clientId), [tiles]);
  const order = connectedIds.join("|");
  /** Physical key code → tablet, in label order (disconnected tablets keep their key). */
  const keyTiles = useMemo(() => new Map<string, Participant>(tiles.slice(0, TABLET_KEY_CODES.length).map((tile, i) => [TABLET_KEY_CODES[i]!, tile])), [tiles]);
  const tileKeys = useMemo(() => new Map([...keyTiles].map(([code, tile]) => [tile.clientId, code])), [keyTiles]);

  const out = dimColor(color, brightness);
  const latest = useRef({ out, connectedIds, latch, keyTiles });
  latest.current = { out, connectedIds, latch, keyTiles };

  /** Who is holding each key: pointer ids and keyboard codes. A key releases when its last holder lets go. */
  const holders = useRef(new Map<string, Set<string>>());
  const holderKey = useRef(new Map<string, string>());
  const pressedAt = useRef(new Map<string, number>());
  const pendingRelease = useRef(new Map<string, number>());
  const latched = useRef(new Set<string>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * Requests go out one at a time, in order. Parallel fetches can reach the
   * server out of order, and a release overtaking its flash leaves a tablet stuck lit.
   */
  const send = <T,>(url: string, body: unknown, onOk?: (result: T, sentAt: number) => void) => {
    queue.current = queue.current.then(async () => {
      const sentAt = Date.now();
      const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(POST_TIMEOUT_MS) : undefined;
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) throw new Error(response.status === 401 ? "Operator sign-in expired." : `Surface command failed (${response.status}).`);
      const result = await response.json() as T & { delivered?: number };
      setDelivered(result.delivered ?? null);
      setError("");
      onOk?.(result, sentAt);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Surface command failed."));
  };
  const post = (body: { target: Target; mode: "flash" | "release" | "identify"; color?: string }) => send("/api/admin/surface", body);

  const targetFor = (key: string): Target => key === ALL ? "all" : [key];
  const markLit = (key: string, value: string | null) => setLit((current) => {
    const keys = key === ALL ? [ALL, ...latest.current.connectedIds] : [key];
    const next = { ...current };
    for (const id of keys) { if (value) next[id] = value; else delete next[id]; }
    return next;
  });
  const light = (key: string, value = latest.current.out) => { post({ target: targetFor(key), mode: "flash", color: value }); markLit(key, value); };
  const unlight = (key: string) => { post({ target: targetFor(key), mode: "release" }); markLit(key, null); };

  const engage = (holder: string, key: string) => {
    if (latest.current.latch) {
      // Latch: each press toggles the tablet; lifting does nothing.
      holderKey.current.set(holder, key);
      if (latched.current.delete(key)) unlight(key); else { latched.current.add(key); light(key); }
      return;
    }
    const pending = pendingRelease.current.get(key);
    // A fresh press must not be cut off by the previous tap's delayed release.
    if (pending !== undefined) { window.clearTimeout(pending); pendingRelease.current.delete(key); }
    holderKey.current.set(holder, key);
    const set = holders.current.get(key) ?? new Set<string>();
    holders.current.set(key, set);
    set.add(holder);
    if (set.size === 1) { pressedAt.current.set(key, Date.now()); light(key); }
  };
  const disengage = (holder: string) => {
    const key = holderKey.current.get(holder);
    if (key === undefined) return;
    holderKey.current.delete(holder);
    const set = holders.current.get(key);
    if (!set?.delete(holder) || set.size > 0) return;
    holders.current.delete(key);
    const elapsed = Date.now() - (pressedAt.current.get(key) ?? 0);
    if (elapsed >= TAP_MS) { unlight(key); return; }
    pendingRelease.current.set(key, window.setTimeout(() => { pendingRelease.current.delete(key); unlight(key); }, TAP_HOLD_MS - elapsed));
  };
  const releaseAll = () => {
    for (const timer of pendingRelease.current.values()) window.clearTimeout(timer);
    pendingRelease.current.clear(); holders.current.clear(); holderKey.current.clear(); latched.current.clear();
    setLit({});
    post({ target: "all", mode: "release" });
  };

  // Changing colour or dimmer recolours whatever is currently held or latched, without lifting.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const active = new Set([...holders.current.keys(), ...latched.current, ...pendingRelease.current.keys()]);
    for (const key of active) light(key, out);
  }, [out]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- effects
  const effect: SurfaceEffect = { kind: effectKind, color, color2, periodMs, brightness };
  const effectGeneration = useRef(0);
  const startEffect = () => { const generation = effectGeneration.current; send<{ running: { startedAt: number } | null; serverNow?: number }>(
    "/api/admin/surface/effect", { action: "start", effect, order: connectedIds },
    (result, sentAt) => {
      if (!result.running || generation !== effectGeneration.current) return;
      const clockOffset = result.serverNow === undefined ? 0 : result.serverNow - (sentAt + Date.now()) / 2;
      setRunning({ effect: { ...effect }, startedAt: result.running.startedAt, clockOffset });
    }); };
  const stopEffect = () => { effectGeneration.current += 1; setRunning(null); setPreview({}); send("/api/admin/surface/effect", { action: "stop" }); };
  // Live-update a running effect when its settings or the tablet list change (the server keeps its phase).
  const effectKey = `${effectKind}|${color}|${color2}|${periodMs}|${brightness}|${order}`;
  const runningRef = useRef(running);
  runningRef.current = running;
  useEffect(() => {
    if (!runningRef.current) return;
    const timer = window.setTimeout(startEffect, 80);
    return () => window.clearTimeout(timer);
  }, [effectKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mirror the effect on the tiles, computed from the server's start time.
  useEffect(() => {
    if (!running) return;
    const draw = () => {
      const elapsed = Date.now() + running.clockOffset - running.startedAt;
      setPreview(Object.fromEntries(connectedIds.map((id, i) => [id, surfaceEffectColor(running.effect, i, connectedIds.length, elapsed)])));
    };
    draw();
    const timer = window.setInterval(draw, 50);
    return () => window.clearInterval(timer);
  }, [running, order]); // eslint-disable-line react-hooks/exhaustive-deps

  // --------------------------------------------------------------- keyboard
  const handlers = useRef({ engage, disengage, releaseAll, stopEffect });
  handlers.current = { engage, disengage, releaseAll, stopEffect };
  useEffect(() => {
    if (!keyboardOn) return;
    const down = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || isSliderArrow(event)) return;
      const { keyTiles: map } = latest.current;
      const palette = /^Digit([1-9])$/.exec(event.code);
      if (event.shiftKey && palette) {
        event.preventDefault();
        setColor(SURFACE_PALETTE[Number(palette[1]) - 1]!);
        return;
      }
      const step = (delta: number) => setColor((current) => {
        const index = SURFACE_PALETTE.indexOf(current as typeof SURFACE_PALETTE[number]);
        return SURFACE_PALETTE[(index + delta + SURFACE_PALETTE.length) % SURFACE_PALETTE.length]!;
      });
      const tile = map.get(event.code);
      const key = event.code === "Space" ? ALL : tile?.connected ? tile.clientId : null;
      if (key) {
        event.preventDefault();
        if (!event.repeat) handlers.current.engage(`k${event.code}`, key);
        return;
      }
      if (tile) { event.preventDefault(); return; }
      switch (event.key) {
        case "ArrowRight": event.preventDefault(); step(1); break;
        case "ArrowLeft": event.preventDefault(); step(-1); break;
        case "ArrowUp": event.preventDefault(); setBrightness((b) => Math.min(1, Math.round(b * 10 + 1) / 10)); break;
        case "ArrowDown": event.preventDefault(); setBrightness((b) => Math.max(0, Math.round(b * 10 - 1) / 10)); break;
        case "Escape": event.preventDefault(); handlers.current.stopEffect(); handlers.current.releaseAll(); break;
      }
    };
    const up = (event: globalThis.KeyboardEvent) => {
      if (holderKey.current.has(`k${event.code}`)) { event.preventDefault(); handlers.current.disengage(`k${event.code}`); }
    };
    // Keys lifted while the window is unfocused never send keyup: let go of all of them.
    const blur = () => { for (const holder of [...holderKey.current.keys()]) if (holder.startsWith("k")) handlers.current.disengage(holder); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); blur(); };
  }, [keyboardOn]);

  // ---------------------------------------------------------------- pointer
  const keyAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest("[data-surface-key]") as HTMLElement | null)?.dataset.surfaceKey ?? null;
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    const key = (event.target as HTMLElement).closest<HTMLElement>("[data-surface-key]")?.dataset.surfaceKey;
    const holder = `p${event.pointerId}`;
    if (!key || holderKey.current.has(holder) || (event.target as HTMLElement).closest("[data-surface-identify]")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    engage(holder, key);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const holder = `p${event.pointerId}`;
    const current = holderKey.current.get(holder);
    if (current === undefined) return;
    const key = keyAt(event.clientX, event.clientY);
    if (!key || key === current) return;
    // Glissando: hand the note from the previous tile to the one under the pointer.
    if (latest.current.latch) { holderKey.current.delete(holder); } else disengage(holder);
    engage(holder, key);
  };
  const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
    const holder = `p${event.pointerId}`;
    if (latest.current.latch) holderKey.current.delete(holder); else disengage(holder);
  };
  const tileKeyboard = (key: string) => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      if (!event.repeat) engage("focus", key);
    },
    onKeyUp: (event: KeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      if (latest.current.latch) holderKey.current.delete("focus"); else disengage("focus");
    },
  });
  const tileColor = (id: string) => lit[id] ?? preview[id];

  return <section className="sc-tool-panel surface-instrument" aria-labelledby="surface-instrument-heading">
    <div className="admin-section-heading">
      <div><p className="sc-tool-eyebrow">Tablet surfaces</p><h2 id="surface-instrument-heading">Colour instrument</h2></div>
      <span className="sc-tool-mono admin-section-count">{connectedIds.length} connected{delivered === null ? "" : ` · last reached ${delivered}`}</span>
    </div>
    <p className="sc-tool-help">Press a tablet to light it, release to return it to its base colour, drag across tablets to play them in turn. Hold several tiles or keys to play chords. Changes are scheduled on the shared clock, so every addressed tablet switches together. Tablets show the colour in show mode.</p>

    <div className="surface-controls">
      <div className="surface-palette" role="radiogroup" aria-label="Colour">
        {SURFACE_PALETTE.map((swatch, i) => <button key={swatch} type="button" role="radio" aria-checked={color === swatch} aria-label={swatch} title={`${swatch} (Shift+${i + 1})`} className="surface-swatch" style={{ backgroundColor: swatch }}
          // Select on press, not click, so the colour changes while another tile is still held.
          onPointerDown={(event) => { event.preventDefault(); setColor(swatch); }} onClick={() => setColor(swatch)} />)}
        <label className="surface-custom">Custom<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
      </div>
      <label className="surface-slider">Dimmer <span className="sc-tool-mono">{Math.round(brightness * 100)}%</span>
        <input type="range" min={0} max={1} step={0.01} value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} />
      </label>
      <div className="surface-toggles">
        <label><input type="checkbox" checked={latch} onChange={(event) => { setLatch(event.target.checked); }} /> Latch (tap toggles)</label>
        <label><input type="checkbox" checked={keyboardOn} onChange={(event) => setKeyboardOn(event.target.checked)} /> Keyboard play</label>
        <button type="button" className="sc-tool-button" data-sc-tool-variant="secondary" onClick={() => { stopEffect(); releaseAll(); }}>Release all (Esc)</button>
      </div>
    </div>

    <fieldset className="surface-effects">
      <legend>Effects</legend>
      <div className="surface-effect-kinds" role="group" aria-label="Effect">
        {SURFACE_EFFECT_KINDS.map((kind) => <button key={kind} type="button" className="sc-tool-button" aria-pressed={effectKind === kind} onClick={() => setEffectKind(kind)}>{EFFECT_LABELS[kind].name}</button>)}
      </div>
      <p className="sc-tool-help">{EFFECT_LABELS[effectKind].help} Uses the selected colour and the dimmer; changes apply live.</p>
      <div className="surface-effect-settings">
        <label className="surface-slider">Cycle <span className="sc-tool-mono">{(periodMs / 1000).toFixed(1)} s</span>
          <input type="range" min={300} max={10_000} step={100} value={periodMs} onChange={(event) => setPeriodMs(Number(event.target.value))} />
        </label>
        {effectKind === "gradient" && <label className="surface-custom">Second colour<input type="color" value={color2} onChange={(event) => setColor2(event.target.value)} /></label>}
        {running
          ? <button type="button" className="sc-tool-button" data-sc-tool-variant="danger" onClick={stopEffect}>Stop {EFFECT_LABELS[running.effect.kind].name.toLowerCase()}</button>
          : <button type="button" className="sc-tool-button" data-sc-tool-variant="primary" disabled={connectedIds.length === 0} onClick={startEffect}>Start effect</button>}
      </div>
    </fieldset>

    {keyboardOn && <p className="sc-tool-help surface-keys">Keys: rows <kbd>1</kbd>–<kbd>0</kbd>, <kbd>Q</kbd>–<kbd>P</kbd>, <kbd>A</kbd>–<kbd>;</kbd>, <kbd>Z</kbd>–<kbd>/</kbd> play tablets in label order · <kbd>Space</kbd> all · <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>9</kbd> or <kbd>←</kbd>/<kbd>→</kbd> colour · <kbd>↑</kbd>/<kbd>↓</kbd> dimmer · <kbd>Esc</kbd> release all and stop effect.</p>}
    {error && <p className="sc-tool-feedback" data-sc-tool-status="danger" role="alert">{error}</p>}
    {duplicates.size > 0 && <p className="sc-tool-feedback" data-sc-tool-status="warning" role="status">Duplicate tablet labels: {[...duplicates].join(", ")}. Set a unique label in each tablet's Device settings.</p>}
    <div className="surface-grid" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
      <button type="button" className="surface-tile surface-tile-all" data-surface-key={ALL} style={lit[ALL] ? { backgroundColor: lit[ALL] } : undefined} {...tileKeyboard(ALL)}>
        <strong>All tablets</strong>{keyboardOn && <kbd className="surface-key">Space</kbd>}
      </button>
      {tiles.map((tile) => <div key={tile.clientId} role="button" tabIndex={tile.connected ? 0 : -1} aria-disabled={!tile.connected} aria-label={`Play ${tile.name}`}
        className={`surface-tile${tile.connected ? "" : " is-disconnected"}${duplicates.has(tile.name.trim().toLowerCase()) ? " is-duplicate" : ""}`}
        data-surface-key={tile.connected ? tile.clientId : undefined} style={tileColor(tile.clientId) ? { backgroundColor: tileColor(tile.clientId) } : undefined} {...(tile.connected ? tileKeyboard(tile.clientId) : {})}>
        <strong>{tile.name}</strong>
        {keyboardOn && tileKeys.has(tile.clientId) && <kbd className="surface-key">{keyHint(tileKeys.get(tile.clientId)!)}</kbd>}
        <span>{tile.connected ? "Connected" : "Disconnected"}</span>
        {tile.connected && <button type="button" className="sc-tool-button surface-identify" data-surface-identify onClick={() => post({ target: [tile.clientId], mode: "identify" })}>Identify</button>}
      </div>)}
    </div>
  </section>;
}
