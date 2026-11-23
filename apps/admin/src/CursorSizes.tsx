import { useEffect, useState } from "react";
import { CURSOR_SIZE_MAX, CURSOR_SIZE_MIN, displaySettingsSchema, resolveCursorSize, type DisplaySettings } from "@entertheblackbox/protocol";

type Scene = { id: string; title: string; cueName?: string | undefined };
type Sizes = Pick<DisplaySettings, "cursorSize" | "cursorSizeByScene">;
const STEP = 0.25;

/**
 * Cursor size on the main and group displays: one default and a list of
 * scenes with their own size. Saved with the display settings, so it
 * survives restarts and needs no republish; displays pick it up within seconds.
 */
export function CursorSizes({ token, scenes, currentSceneId }: { token: string; scenes: readonly Scene[]; currentSceneId: string | null }) {
  const [saved, setSaved] = useState<Sizes | null>(null);
  const [draft, setDraft] = useState<Sizes | null>(null);
  const [adding, setAdding] = useState("");
  const [message, setMessage] = useState<{ status: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<DisplaySettings> => {
    const response = await fetch("/api/admin/settings/display", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(response.status === 401 ? "Operator sign-in expired." : `Loading settings failed (${response.status}).`);
    const parsed = displaySettingsSchema.safeParse(((await response.json()) as { display?: unknown }).display);
    if (!parsed.success) throw new Error("The server's display settings could not be read.");
    return parsed.data;
  };
  useEffect(() => {
    let stopped = false;
    load().then((settings) => {
      if (stopped) return;
      const sizes = { cursorSize: settings.cursorSize, cursorSizeByScene: settings.cursorSizeByScene };
      setSaved(sizes); setDraft(sizes);
    }).catch((reason: unknown) => { if (!stopped) setMessage({ status: "danger", text: reason instanceof Error ? reason.message : "Loading settings failed." }); });
    return () => { stopped = true; };
  }, [token]);

  if (!draft) return <section className="sc-tool-panel cursor-sizes" aria-labelledby="cursor-sizes-heading">
    <h2 id="cursor-sizes-heading">Cursor size</h2>
    {message ? <p className="sc-tool-feedback" data-sc-tool-status={message.status} role="alert">{message.text}</p> : <p className="sc-tool-help">Loading…</p>}
  </section>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const title = (id: string) => { const scene = scenes.find((item) => item.id === id); return scene ? scene.cueName ?? scene.title : id; };
  const setScene = (id: string, size: number | undefined) => {
    const next = { ...draft.cursorSizeByScene };
    if (size === undefined) delete next[id]; else next[id] = size;
    setDraft({ ...draft, cursorSizeByScene: next });
  };
  const save = async () => {
    setBusy(true);
    try {
      // Re-read first, so settings changed in the Displays tab meanwhile are kept.
      const current = await load();
      const response = await fetch("/api/admin/settings/display", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...current, ...draft }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? "Operator sign-in expired." : `Saving failed (${response.status}).`);
      setSaved(draft);
      setMessage({ status: "success", text: "Saved. Displays use it within a few seconds." });
    } catch (reason) {
      setMessage({ status: "danger", text: reason instanceof Error ? reason.message : "Saving failed." });
    } finally {
      setBusy(false);
    }
  };
  const available = scenes.filter((scene) => !Object.hasOwn(draft.cursorSizeByScene, scene.id));
  const sizeInput = (label: string, value: number, onChange: (value: number) => void) => <span className="cursor-size-input">
    <input type="range" aria-label={label} min={CURSOR_SIZE_MIN} max={CURSOR_SIZE_MAX} step={STEP} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    <output>{value.toFixed(2)}×</output>
  </span>;

  return <section className="sc-tool-panel cursor-sizes" aria-labelledby="cursor-sizes-heading">
    <div className="admin-section-heading">
      <div><p className="sc-tool-eyebrow">Main and group displays</p><h2 id="cursor-sizes-heading">Cursor size</h2></div>
      <button className="sc-tool-button" data-sc-tool-variant="primary" type="button" disabled={busy || !dirty} onClick={() => void save()}>Save</button>
    </div>
    <p className="sc-tool-help">Scenes listed here draw their cursors at their own size; every other scene uses the default. Now: {resolveCursorSize(draft, currentSceneId).toFixed(2)}×{currentSceneId ? ` in ${title(currentSceneId)}` : ""}.</p>
    <label className="sc-tool-label cursor-size-row">Default{sizeInput("Default cursor size", draft.cursorSize, (cursorSize) => setDraft({ ...draft, cursorSize }))}</label>
    <ul className="cursor-size-scenes">
      {Object.entries(draft.cursorSizeByScene).map(([id, size]) => <li key={id} className="cursor-size-row" aria-current={id === currentSceneId ? "step" : undefined}>
        <span><strong>{title(id)}</strong><small>{id}</small></span>
        {sizeInput(`Cursor size in ${title(id)}`, size, (value) => setScene(id, value))}
        <button className="sc-tool-button" type="button" onClick={() => setScene(id, undefined)}>Remove</button>
      </li>)}
    </ul>
    <div className="cursor-size-add">
      <select className="sc-tool-select" aria-label="Scene to add" value={adding} onChange={(event) => setAdding(event.target.value)}>
        <option value="">Choose a scene…</option>
        {available.map((scene) => <option key={scene.id} value={scene.id}>{scene.cueName ?? scene.title} · {scene.id}</option>)}
      </select>
      <button className="sc-tool-button" type="button" disabled={adding === ""} onClick={() => { setScene(adding, 2); setAdding(""); }}>Add scene</button>
    </div>
    {message && <p className="sc-tool-feedback" data-sc-tool-status={message.status} role="status">{message.text}</p>}
  </section>;
}
