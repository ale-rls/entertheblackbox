import { StatusIcon, type ToolStatus } from "@smartphonecracy/tool-ui";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

export type Status = {
  healthy: boolean;
  ready: boolean;
  uptimeMs: number;
  displayConnected: boolean;
  displayHeartbeatAgeMs: number | null;
  connectedParticipants: number;
  sessionId: string | null;
  lifecycle: string | null;
  phaseId: string | null;
  phaseEpoch: number | null;
};

type Feedback = { status: "success" | "danger"; message: string };
type ConfirmAction = "idle" | "restart";

async function api(path: string, token: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`/api/admin/${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Invalid admin token");
    if (response.status === 409) throw new Error("The server refused this action in the current show state.");
    throw new Error(`Request failed (${response.status})`);
  }
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function safeJson(value: unknown): string {
  try {
    const json = JSON.stringify(value, null, 2);
    return json ?? String(value);
  } catch {
    return "Raw payload could not be serialized";
  }
}

export function normalizeError(value: unknown, index: number) {
  const record = isRecord(value) ? value : null;
  const at = textValue(record?.at) ?? textValue(record?.timestamp) ?? "—";
  const source = textValue(record?.path) ?? textValue(record?.source) ?? "—";
  const message = textValue(record?.message) ?? textValue(record?.error) ?? textValue(value) ?? "Unstructured error payload";
  return { key: `${index}-${at}-${source}`, at, source, message, raw: safeJson(value) };
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function StatusLabel({ status, children }: { status: ToolStatus; children: ReactNode }) {
  return <span className="sc-tool-status" data-sc-tool-status={status}><StatusIcon status={status} /><span>{children}</span></span>;
}

function OperationRow({ label, status, value, detail }: { label: string; status: ToolStatus; value: string; detail: string }) {
  return <div className="admin-operation-row">
    <div className="admin-operation-label"><StatusIcon status={status} /><span>{label}</span></div>
    <strong className="sc-tool-mono">{value}</strong>
    <span>{detail}</span>
  </div>;
}

function ConfirmationDialog({ action, onCancel, onConfirm }: { action: ConfirmAction; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = `admin-${action}-confirmation-title`;
  const descriptionId = `admin-${action}-confirmation-description`;
  const isRestart = action === "restart";

  useEffect(() => { cancelRef.current?.focus(); }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)"));
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <div className="sc-tool-dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <div className="sc-tool-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={handleKeyDown}>
      <p className="admin-eyebrow">Operator confirmation</p>
      <h2 id={titleId}>{isRestart ? "Restart the show?" : "Return the show to idle?"}</h2>
      <p id={descriptionId}>{isRestart
        ? "This creates a new session and returns the running show to its entry phase."
        : "This stops the current show and returns connected installation screens to idle."}</p>
      <div className="sc-tool-dialog-actions">
        <button ref={cancelRef} className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={onCancel}>Keep current show</button>
        <button className="sc-tool-button" data-sc-tool-variant="danger" type="button" onClick={onConfirm}>{isRestart ? "Restart show" : "Return to idle"}</button>
      </div>
    </div>
  </div>;
}

export function App() {
  const storedToken = sessionStorage.getItem("admin-token") ?? "";
  const [token, setToken] = useState(storedToken);
  const [connectedToken, setConnectedToken] = useState(storedToken);
  const [status, setStatus] = useState<Status | null>(null);
  const [errors, setErrors] = useState<unknown[]>([]);
  const [connectionError, setConnectionError] = useState("");
  const [statusStale, setStatusStale] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [workingAction, setWorkingAction] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const statusRef = useRef<Status | null>(null);
  const confirmTriggerRef = useRef<HTMLButtonElement | null>(null);
  const controlsHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const refresh = useCallback(async () => {
    if (!connectedToken) return;
    setRefreshing(true);
    const [statusResult, errorsResult] = await Promise.allSettled([
      api("status", connectedToken).then(async (response) => await response.json() as Status),
      api("errors", connectedToken).then(async (response) => await response.json() as unknown),
    ]);

    if (statusResult.status === "fulfilled") {
      statusRef.current = statusResult.value;
      setStatus(statusResult.value);
      setStatusStale(false);
      setConnectionError(errorsResult.status === "rejected" ? "Connected, but recent errors could not be loaded." : "");
    } else {
      setStatusStale(statusRef.current !== null);
      setConnectionError(statusResult.reason instanceof Error ? statusResult.reason.message : "Could not connect to the admin API.");
    }
    if (errorsResult.status === "fulfilled") {
      const payload = errorsResult.value;
      setErrors(isRecord(payload) && Array.isArray(payload.errors) ? payload.errors : []);
    }
    setRefreshing(false);
  }, [connectedToken]);

  useEffect(() => {
    if (!connectedToken) return;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2_000);
    return () => window.clearInterval(timer);
  }, [connectedToken, refresh]);

  const connect = (event: FormEvent) => {
    event.preventDefault();
    if (!token) {
      setFeedback({ status: "danger", message: "Enter an admin token before connecting." });
      return;
    }
    sessionStorage.setItem("admin-token", token);
    setFeedback(null);
    setConnectionError("");
    setStatusStale(false);
    if (token === connectedToken) void refresh();
    else {
      statusRef.current = null;
      setStatus(null);
      setErrors([]);
      setConnectedToken(token);
    }
  };

  const control = async (action: "start" | "idle" | "skip" | "restart") => {
    setWorkingAction(action);
    setFeedback(null);
    try {
      await api(action, connectedToken, { method: "POST" });
      const labels = { start: "Show started.", idle: "Show returned to idle.", skip: "Current phase skipped.", restart: "Show restarted." };
      setFeedback({ status: "success", message: labels[action] });
      await refresh();
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "The action failed." });
    } finally {
      setWorkingAction(null);
    }
  };

  const requestConfirmation = (action: ConfirmAction, trigger: HTMLButtonElement) => {
    confirmTriggerRef.current = trigger;
    setConfirmAction(action);
  };
  const closeConfirmation = () => {
    setConfirmAction(null);
    queueMicrotask(() => confirmTriggerRef.current?.focus());
  };
  const confirmControl = () => {
    if (!confirmAction) return;
    const action = confirmAction;
    setConfirmAction(null);
    confirmTriggerRef.current?.focus();
    void control(action).finally(() => {
      requestAnimationFrame(() => {
        if (confirmTriggerRef.current?.disabled) controlsHeadingRef.current?.focus();
      });
    });
  };

  const download = async (format: "json" | "csv") => {
    if (!status?.sessionId || status.sessionId === "idle") return;
    setWorkingAction(`export-${format}`);
    setFeedback(null);
    try {
      const response = await api(`sessions/${encodeURIComponent(status.sessionId)}/export?format=${format}`, connectedToken);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${status.sessionId}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
      setFeedback({ status: "success", message: `${format.toUpperCase()} export prepared.` });
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "The export failed." });
    } finally {
      setWorkingAction(null);
    }
  };

  const isActive = status?.lifecycle === "active";
  const canStart = Boolean(status && !isActive && status.displayConnected && status.connectedParticipants > 0);
  const canReturnToIdle = Boolean(status?.lifecycle && status.lifecycle !== "idle");
  const canExport = Boolean(status?.sessionId && status.sessionId !== "idle");
  const busy = workingAction !== null;
  const globalStatus: ToolStatus = status ? (statusStale || !status.healthy || !status.ready ? "warning" : "success") : connectionError ? "danger" : "info";
  const globalLabel = status ? (statusStale ? "Status stale" : status.healthy && status.ready ? "System ready" : "System not ready") : refreshing ? "Connecting" : connectionError ? "Connection failed" : "Not connected";

  return <div data-sc-tool-density="standard" data-sc-tool-root>
    <main className="admin-app">
      <header className="admin-header">
        <div><p className="admin-eyebrow">Live installation / operator console</p><h1>Operations</h1></div>
        <StatusLabel status={globalStatus}>{globalLabel}</StatusLabel>
      </header>

      <section className="sc-tool-panel admin-connection" aria-labelledby="admin-connection-heading">
        <div className="admin-section-heading">
          <div><p className="admin-eyebrow">Secure access</p><h2 id="admin-connection-heading">Admin connection</h2></div>
          {status && <StatusLabel status={statusStale ? "warning" : "success"}>{statusStale ? "Last status received" : "Authenticated"}</StatusLabel>}
        </div>
        <form className="admin-connection-form" onSubmit={connect}>
          <label className="sc-tool-label" htmlFor="admin-token">Admin token
            <input id="admin-token" className="sc-tool-field sc-tool-mono" type="password" autoComplete="current-password" value={token} onChange={(event) => setToken(event.target.value)} aria-describedby="admin-token-help" />
          </label>
          <button className="sc-tool-button" data-sc-tool-variant="primary" type="submit" disabled={refreshing}>{status ? "Reconnect" : refreshing ? "Connecting…" : "Connect"}</button>
        </form>
        <p id="admin-token-help" className="sc-tool-help">Token is held for this browser session. Connected sessions refresh every 2 seconds.</p>
        {connectionError && <p className="sc-tool-feedback admin-feedback" data-sc-tool-status={statusStale ? "warning" : "danger"} role="alert"><StatusIcon status={statusStale ? "warning" : "danger"} /><span>{connectionError}{statusStale ? " Showing the last received status." : ""}</span></p>}
      </section>

      {feedback && <div className="sc-tool-feedback admin-page-feedback" data-sc-tool-status={feedback.status} role={feedback.status === "danger" ? "alert" : "status"}><StatusIcon status={feedback.status} /><span>{feedback.message}</span></div>}

      {!status ? <section className="sc-tool-panel admin-empty-state" aria-live="polite">
        <p className="admin-eyebrow">Operational data</p>
        <h2>{refreshing ? "Loading live status…" : "Connect to load live status"}</h2>
        <p>No operational values are shown until the admin API authenticates this browser session.</p>
      </section> : <div className="admin-grid">
        <section className="sc-tool-panel" aria-labelledby="admin-status-heading">
          <div className="admin-section-heading"><div><p className="admin-eyebrow">Live topology</p><h2 id="admin-status-heading">Operational status</h2></div><span className="sc-tool-mono admin-section-count">Live</span></div>
          <div className="admin-operation-list">
            <OperationRow label="Server" status={status.healthy && status.ready ? "success" : status.healthy ? "warning" : "danger"} value={status.healthy && status.ready ? "READY" : "NOT READY"} detail={`uptime ${formatDuration(status.uptimeMs)}`} />
            <OperationRow label="Display" status={status.displayConnected ? "success" : "danger"} value={status.displayConnected ? "CONNECTED" : "DISCONNECTED"} detail={status.displayConnected && status.displayHeartbeatAgeMs !== null ? `heartbeat ${status.displayHeartbeatAgeMs} ms ago` : "no heartbeat available"} />
            <OperationRow label="Participants" status={status.connectedParticipants > 0 ? "info" : "warning"} value={String(status.connectedParticipants)} detail="currently connected" />
            <OperationRow label="Session" status={isActive ? "success" : "info"} value={(status.lifecycle ?? "unavailable").toUpperCase()} detail={status.sessionId ? `session ${status.sessionId}` : "no session ID"} />
          </div>
        </section>

        <section className="sc-tool-panel" aria-labelledby="admin-controls-heading">
          <div className="admin-section-heading"><div><p className="admin-eyebrow">{status.sessionId ? `Session ${status.sessionId}` : "No active session"}</p><h2 ref={controlsHeadingRef} id="admin-controls-heading" tabIndex={-1}>Session controls</h2></div><StatusLabel status={isActive ? "success" : "info"}>{status.lifecycle ?? "Unavailable"}</StatusLabel></div>
          <dl className="admin-session-facts">
            <div><dt>Current phase</dt><dd className="sc-tool-mono">{status.phaseId ?? "—"}</dd></div>
            <div><dt>Epoch</dt><dd className="sc-tool-mono">{status.phaseEpoch ?? "—"}</dd></div>
            <div><dt>Lifecycle</dt><dd className="sc-tool-mono">{status.lifecycle ?? "—"}</dd></div>
          </dl>
          <div className="admin-control-list">
            <div><button className="sc-tool-button" data-sc-tool-variant={isActive ? "secondary" : "primary"} type="button" disabled={!canStart || busy} onClick={() => void control("start")}>Start show</button><span>{isActive ? "Unavailable while active" : !status.displayConnected ? "Display must be connected" : status.connectedParticipants < 1 ? "A participant must be connected" : "Begin a new live session"}</span></div>
            <div><button className="sc-tool-button" data-sc-tool-variant={isActive ? "primary" : "secondary"} type="button" disabled={!isActive || busy} onClick={() => void control("skip")}>Skip current phase</button><span>{isActive ? "Server validates phase support" : "Available during an active show"}</span></div>
            <div><button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={!isActive || busy} onClick={(event) => requestConfirmation("restart", event.currentTarget)}>Restart show</button><span>Create a new session from the entry phase</span></div>
            <div><button className="sc-tool-button" data-sc-tool-variant="danger" type="button" disabled={!canReturnToIdle || busy} onClick={(event) => requestConfirmation("idle", event.currentTarget)}>Return to idle</button><span>Stop the current show</span></div>
          </div>
        </section>

        <section className="sc-tool-panel" aria-labelledby="admin-export-heading">
          <div className="admin-section-heading"><div><p className="admin-eyebrow">Session archive</p><h2 id="admin-export-heading">Session export</h2></div><StatusLabel status={canExport ? "success" : "info"}>{canExport ? "Ready" : "Unavailable"}</StatusLabel></div>
          <p className="admin-copy">Download the data available for the current session.</p>
          {status.sessionId && <p className="admin-export-id sc-tool-mono">{status.sessionId}</p>}
          <div className="admin-button-row"><button className="sc-tool-button" data-sc-tool-variant="primary" type="button" disabled={!canExport || busy} onClick={() => void download("csv")}>Export CSV</button><button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={!canExport || busy} onClick={() => void download("json")}>Export JSON</button></div>
          {!canExport && <p className="sc-tool-help">A current session ID is required before an export can be prepared.</p>}
        </section>

        <section className="sc-tool-panel admin-errors" aria-labelledby="admin-errors-heading">
          <div className="admin-section-heading"><div><p className="admin-eyebrow">Server log</p><h2 id="admin-errors-heading">Recent errors</h2></div><StatusLabel status={errors.length ? "warning" : "success"}>{errors.length ? `${errors.length} reported` : "None reported"}</StatusLabel></div>
          {errors.length ? <div className="sc-tool-table-region" role="region" aria-label="Recent operational errors" tabIndex={0}>
            <table className="sc-tool-table"><caption className="sc-tool-visually-hidden">Recent errors returned by the admin API</caption><thead><tr><th>Time</th><th>Source</th><th>Message</th><th>Payload</th></tr></thead><tbody>{errors.map((error, index) => { const row = normalizeError(error, index); return <tr key={row.key}><td className="sc-tool-mono">{row.at}</td><td className="sc-tool-mono">{row.source}</td><td>{row.message}</td><td><details><summary>Raw</summary><pre>{row.raw}</pre></details></td></tr>; })}</tbody></table>
          </div> : <p className="admin-copy">No recent errors were returned by the server.</p>}
        </section>
      </div>}
    </main>
    {confirmAction && <ConfirmationDialog action={confirmAction} onCancel={closeConfirmation} onConfirm={confirmControl} />}
  </div>;
}
