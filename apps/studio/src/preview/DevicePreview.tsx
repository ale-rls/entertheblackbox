import { useEffect, useRef, useState, type FormEvent } from "react";
import type PocketBase from "pocketbase";
import QRCode from "qrcode";
import type { Draft } from "../model.js";
import { exportArtifacts } from "../io.js";

type Status = { id: string; phaseId: string; revision: number; participants: number; displays: number; groups: { id: string; label: string }[] };

function previewId(draftId: string): string {
  const key = `studio-device-preview:${draftId}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch { return crypto.randomUUID(); }
}

export function DevicePreview({ draft, phaseId, request, operator, onClose }: {
  draft: Draft; phaseId: string | undefined; request: number; operator: PocketBase; onClose: () => void;
}) {
  const [id] = useState(() => previewId(draft.id));
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [error, setError] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(!operator.authStore.isValid);
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const canvas = useRef<HTMLCanvasElement>(null);
  const inFlight = useRef(false);
  const latest = useRef({ draft, phaseId });
  latest.current = { draft, phaseId };
  const phoneUrl = new URL(`/phone/?rehearsal=${id}`, location.origin).href;
  const displayUrl = new URL(`/display/?rehearsal=${id}`, location.origin).href;
  const cuesUrl = new URL(`/api/rehearsals/${id}/cues`, location.origin).href;

  const start = async () => {
    if (inFlight.current) return;
    if (!operator.authStore.isValid) { setNeedsSignIn(true); return; }
    const current = latest.current;
    if (!current.phaseId) { setError("Select a phase to preview."); return; }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const artifacts = exportArtifacts(current.draft);
      const response = await fetch(`/api/admin/rehearsals/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${operator.authStore.token}` },
        body: JSON.stringify({ phaseId: current.phaseId, scenario: artifacts["scenario.json"], mediaManifest: artifacts["media-manifest.json"] }),
      });
      const body = await response.json();
      if (response.status === 401) setNeedsSignIn(true);
      if (!response.ok) throw new Error(body.errors?.join("; ") ?? body.message ?? (response.status === 401 ? "Sign in to preview on devices." : `Preview failed (${response.status}).`));
      setStatus(body as Status);
      setNeedsSignIn(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not start preview."); }
    finally { inFlight.current = false; setBusy(false); }
  };

  useEffect(() => { if (request > 0) void start(); }, [request]);
  useEffect(() => {
    if (!status) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/rehearsals/${id}/status`, { cache: "no-store" });
        if (cancelled) return;
        if (response.status === 404) { setStatus(null); setError("Preview ended or the server restarted. Click Preview on devices to reconnect."); return; }
        if (!response.ok) throw new Error();
        const next = await response.json() as Status;
        if (!cancelled) { setStatus(next); setConnectionError(""); }
      } catch { if (!cancelled) setConnectionError("Preview connection lost. Checking again…"); }
    };
    const timer = setInterval(() => void poll(), 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [id, status !== null]);
  useEffect(() => {
    if (status && canvas.current) void QRCode.toCanvas(canvas.current, phoneUrl, { width: 180, margin: 1 }).catch(() => setError("QR could not be drawn. Open the phone link instead."));
  }, [phoneUrl, status !== null, request]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await operator.collection("operators").authWithPassword(credentials.email, credentials.password);
      setCredentials((value) => ({ ...value, password: "" }));
      setNeedsSignIn(false);
      await start();
    } catch { setError("Sign-in failed. Check your email and password."); }
    finally { setBusy(false); }
  };
  const stop = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/rehearsals/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${operator.authStore.token}` } });
      if (!response.ok) throw new Error(`Could not end preview (${response.status}).`);
      setStatus(null);
      onClose();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not end preview."); }
    finally { setBusy(false); }
  };

  if (request === 0) return null;
  return <section className="sc-tool-panel device-preview-panel" aria-label="Preview on devices">
    <header><h2>Preview on devices</h2><button className="sc-tool-button" onClick={onClose}>Hide</button></header>
    {needsSignIn ? <form onSubmit={(event) => void signIn(event)}>
      <p>Sign in as an operator to connect your devices.</p>
      <label className="sc-tool-label">Email<input className="sc-tool-field" type="email" autoComplete="username" required value={credentials.email} onChange={(event) => setCredentials((value) => ({ ...value, email: event.target.value }))} /></label>
      <label className="sc-tool-label">Password<input className="sc-tool-field" type="password" autoComplete="current-password" required value={credentials.password} onChange={(event) => setCredentials((value) => ({ ...value, password: event.target.value }))} /></label>
      <button className="sc-tool-button" type="submit" disabled={busy}>Sign in and preview</button>
    </form> : <>
      <p className="sc-tool-help">Select a phase and preview it with your latest edits. Connected devices stay in this preview while the show continues.</p>
      <button className="sc-tool-button" disabled={busy || !phaseId} onClick={() => void start()}>{busy ? "Preparing preview…" : `Preview latest from ${phaseId ?? "selected phase"}`}</button>
    </>}
    {status && <div className="device-preview-connections">
      <p role="status">Playing: <strong>{status.phaseId}</strong> · {status.participants} phone(s) · {status.displays} display(s)</p>
      <canvas ref={canvas} aria-label="Scan to join this preview on your phone" />
      <p><a href={phoneUrl} target="_blank" rel="noreferrer">Open phone</a> · <a href={displayUrl} target="_blank" rel="noreferrer">Open display</a></p>
      {status.groups.length > 0 && <details><summary>Group displays</summary>{status.groups.map((group) => <p key={group.id}><a href={`${displayUrl}&group=${encodeURIComponent(group.id)}`} target="_blank" rel="noreferrer">{group.label || group.id}</a></p>)}</details>}
      <details><summary>TouchDesigner connection</summary>
        <label className="sc-tool-label">Cue feed URL<input className="sc-tool-field" readOnly value={cuesUrl} onFocus={(event) => event.target.select()} /></label>
        <label className="sc-tool-label">Bearer token<input className="sc-tool-field" readOnly value={id} onFocus={(event) => event.target.select()} /></label>
        <p className="sc-tool-help">Use these in your TouchDesigner cue receiver, then trigger a phase to send its cues.</p>
      </details>
      <p className="sc-tool-help">Preview links last until you end it, the server restarts, or two hours pass without triggering a phase.</p>
      <button className="sc-tool-button" disabled={busy} onClick={() => void stop()}>End device preview</button>
    </div>}
    {connectionError && <p role="status">{connectionError}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
