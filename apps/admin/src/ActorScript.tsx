import { useEffect, useRef, useState } from "react";
import "./actor-script.css";

type Script = { title: string; paragraphs: string[]; cue: number; revision: string };
type Snapshot = { script: Script | null; readerToken?: string | null };
async function request(token: string, actor: boolean, path = "", init?: RequestInit): Promise<Snapshot> {
  const response = await fetch(actor ? "/api/actor-script" : `/api/admin/script${path}`, {
    ...init, cache: "no-store", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(actor ? "Script unavailable. Ask the operator for the current link." : `Script request failed (${response.status}). Refresh and try again.`);
  return response.json();
}

export function ScriptReader({ script, onCue }: { script: Script; onCue?: (cue: number) => void }) {
  const [follow, setFollow] = useState(true);
  const [size, setSize] = useState(26);
  const current = useRef<HTMLDivElement>(null);
  useEffect(() => { if (follow) current.current?.scrollIntoView?.({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }, [follow, script.cue, script.revision]);
  return <section className="actor-script">
    <header className="script-toolbar"><h2>{script.title}</h2><span>Cue {script.cue + 1} / {script.paragraphs.length}</span>
      <label><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> Follow shared cue</label>
      <button onClick={() => { setFollow(true); current.current?.scrollIntoView?.({ block: "center" }); }}>Return to cue</button>
      <label>Text size <input aria-label="Text size" type="range" min="18" max="48" value={size} onChange={e => setSize(Number(e.target.value))} /></label>
      {onCue && <><button disabled={script.cue === 0} onClick={() => onCue(script.cue - 1)}>Previous cue</button><button disabled={script.cue === script.paragraphs.length - 1} onClick={() => onCue(script.cue + 1)}>Next cue</button></>}
    </header>
    <div className="script-passages" style={{ fontSize: size }}>{script.paragraphs.map((paragraph, index) => <div key={`${script.revision}-${index}`} ref={index === script.cue ? current : undefined} className={`script-passage${index === script.cue ? " is-current" : ""}`} aria-current={index === script.cue ? "step" : undefined}>
      <span className="script-cue-number">{index + 1}</span><p>{paragraph}</p>{onCue && <button aria-label={`Set cue ${index + 1}`} onClick={() => onCue(index)}>Cue here</button>}
    </div>)}</div>
  </section>;
}

export function ActorScript({ token }: { token: string }) {
  const [state, setState] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await request(token, true); if (!disposed) { setState(next); setError(""); } }
      catch (e) { if (!disposed) { setError((e as Error).message); setState(null); } }
      finally { if (!disposed) timer = setTimeout(() => void poll(), 1000); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [token]);
  return <main className="actor-reader"><p className="script-connection" role="status">{error || (state ? "Connected · shared script" : "Connecting…")}</p>{state?.script && <ScriptReader script={state.script} />}</main>;
}

export function ScriptPanel({ token }: { token: string }) {
  const [state, setState] = useState<Snapshot | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (busy) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await request(token, false); if (!disposed) setState(next); }
      catch (e) { if (!disposed) setError((e as Error).message); }
      finally { if (!disposed) timer = setTimeout(() => void poll(), 1500); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [token, busy]);
  const update = async (path: string, method: string, body?: unknown) => {
    setBusy(true); setError("");
    try { setState(await request(token, false, path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const link = state?.readerToken ? `${window.location.origin}/admin/#actor-script=${state.readerToken}` : "";
  return <section className="sc-tool-panel script-panel"><h2>Shared actor script</h2>
    <p>Paste a plain-text script. Blank lines separate cues. Actors open the reader link on their own devices; only operators can advance the shared cue.</p>
    <p>The script stays in server memory until cleared or the server restarts. Loading a replacement revokes the previous reader link.</p>
    <form onSubmit={e => { e.preventDefault(); void update("", "PUT", { title, text }); }}>
      <label>Script title<input required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label>Script text<textarea required maxLength={200000} rows={8} value={text} onChange={e => setText(e.target.value)} /></label>
      <button disabled={busy || !title.trim() || !text.trim()}>Load script{state?.script ? " and replace current" : ""}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {link && <div className="script-share"><label>Read-only actor link<input readOnly value={link} onFocus={e => e.target.select()} /></label><a href={link} target="_blank" rel="noreferrer">Open actor reader ↗</a><button disabled={busy} onClick={() => void update("/rotate-link", "POST")}>Replace reader link</button><button disabled={busy} onClick={() => void update("", "DELETE")}>Clear script and revoke link</button></div>}
    {state?.script && <fieldset disabled={busy}><ScriptReader script={state.script} onCue={cue => void update("/cue", "PATCH", { revision: state.script!.revision, cue })} /></fieldset>}
  </section>;
}
