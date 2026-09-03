import { StatusIcon, type ToolStatus } from "@smartphonecracy/tool-ui";
import PocketBase from "pocketbase";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

const POCKETBASE_URL = import.meta.env.VITE_POCKETBASE_URL ?? "http://127.0.0.1:8090";

export type Status = {
  healthy: boolean;
  ready: boolean;
  uptimeMs: number;
  displayConnected: boolean;
  displayHeartbeatAgeMs: number | null;
  displayPlaybackIssue: {
    status: "stalled" | "error" | "autoplay-blocked";
    mediaId: string;
    detail: string | null;
    reportedAt: number;
  } | null;
  connectedParticipants: number;
  participants: Array<{
    clientId: string;
    name: string;
    color: string;
    connected: boolean;
    joinedAt: number;
    lastSeenAt: number;
  }>;
  sessionId: string | null;
  lifecycle: string | null;
  phaseId: string | null;
  phaseEpoch: number | null;
};

type Feedback = { status: "success" | "danger"; message: string };
type ConfirmAction = "idle" | "restart";
type FlowScene = {
  id: string;
  kind: "video" | "position-question" | "video-position-question";
  title: string;
  routes: Array<{ outcome: string; target: string }>;
};
type SceneFlow = { entryPhaseId: string; scenes: FlowScene[] };
type PublishedShow = { showId: string; name: string; version: string; publishedAt: number };
type ShowsInfo = { active: string | null; pending: string | null; shows: PublishedShow[] };
type GhostsInfo = { active: number; pending: number | null };
type LobbyInfo = { startTimes: number[]; nextStartAt: number | null; lifecycle: string | null };

async function api(path: string, token: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`/api/admin/${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your session has expired. Sign in again.");
    if (response.status === 409) throw new Error("The server refused this action in the current show state.");
    throw new Error(`Request failed (${response.status})`);
  }
  return response;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function showLabel(showId: string | null, shows: PublishedShow[]): string {
  if (!showId) return "—";
  const show = shows.find((candidate) => candidate.showId === showId);
  return show ? `${show.name} (${show.version})` : showId;
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
      <p className="sc-tool-eyebrow">Operator confirmation</p>
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

function JumpConfirmationDialog({ scene, onCancel, onConfirm }: { scene: FlowScene; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = "admin-jump-confirmation-title";
  const descriptionId = "admin-jump-confirmation-description";

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
      <p className="sc-tool-eyebrow">Scene jump</p>
      <h2 id={titleId}>Jump to “{scene.title}”?</h2>
      <p id={descriptionId}>This immediately leaves the current scene, clears its in-progress vote or playback state, and starts <span className="sc-tool-mono">{scene.id}</span>.</p>
      <div className="sc-tool-dialog-actions">
        <button ref={cancelRef} className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={onCancel}>Keep current scene</button>
        <button className="sc-tool-button" data-sc-tool-variant="primary" type="button" onClick={onConfirm}>Jump to scene</button>
      </div>
    </div>
  </div>;
}

function sceneKindLabel(kind: FlowScene["kind"]): string {
  return kind === "video" ? "Media" : kind === "position-question" ? "Question" : "Media + vote";
}

export function App() {
  // localStorage rather than sessionStorage: the operator token is valid
  // for 30 days (operators auth collection), so the session should survive
  // closing the tab/browser too, not just page reloads within one tab.
  const storedToken = localStorage.getItem("admin-token") ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [connectedToken, setConnectedToken] = useState(storedToken);
  const [status, setStatus] = useState<Status | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [statusStale, setStatusStale] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [workingAction, setWorkingAction] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [flow, setFlow] = useState<SceneFlow | null>(null);
  const [jumpScene, setJumpScene] = useState<FlowScene | null>(null);
  const [showsInfo, setShowsInfo] = useState<ShowsInfo | null>(null);
  const [selectedShowId, setSelectedShowId] = useState("");
  const [savingShow, setSavingShow] = useState(false);
  const [ghostsInfo, setGhostsInfo] = useState<GhostsInfo | null>(null);
  const [targetAudienceSize, setTargetAudienceSize] = useState("");
  const [savingGhosts, setSavingGhosts] = useState(false);
  const [lobbyInfo, setLobbyInfo] = useState<LobbyInfo | null>(null);
  const [newStartTime, setNewStartTime] = useState("");
  const [savingLobby, setSavingLobby] = useState(false);
  const statusRef = useRef<Status | null>(null);
  const confirmTriggerRef = useRef<HTMLButtonElement | null>(null);
  const controlsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const flowHeadingRef = useRef<HTMLHeadingElement | null>(null);
  // selectedShowId/targetAudienceSize are edited in-place while loadShows/
  // loadGhosts now poll every 2s (see the effect below) -- without this, a
  // poll mid-edit would stomp whatever the operator just typed/selected
  // back to the last-known value.
  const selectedShowIdTouched = useRef(false);
  const targetAudienceSizeTouched = useRef(false);

  const refresh = useCallback(async () => {
    if (!connectedToken) return;
    setRefreshing(true);
    try {
      const response = await api("status", connectedToken);
      const nextStatus = await response.json() as Status;
      statusRef.current = nextStatus;
      setStatus(nextStatus);
      setStatusStale(false);
      setConnectionError("");
    } catch (error) {
      setStatusStale(statusRef.current !== null);
      setConnectionError(error instanceof Error ? error.message : "Could not connect to the admin API.");
    } finally {
      setRefreshing(false);
    }
  }, [connectedToken]);

  const loadShows = useCallback(async () => {
    if (!connectedToken) return;
    try {
      const response = await api("shows", connectedToken);
      const info = await response.json() as ShowsInfo;
      if (!info || !Array.isArray(info.shows)) return;
      setShowsInfo(info);
      if (!selectedShowIdTouched.current) setSelectedShowId(info.pending ?? info.active ?? info.shows[0]?.showId ?? "");
    } catch {
      // A stale/invalid token already surfaces via the main connection
      // error banner from refresh(); a transient failure here just means
      // this panel doesn't populate until the next successful load.
    }
  }, [connectedToken]);

  const loadGhosts = useCallback(async () => {
    if (!connectedToken) return;
    try {
      const response = await api("ghosts", connectedToken);
      const info = await response.json() as GhostsInfo;
      if (!info || typeof info.active !== "number") return;
      setGhostsInfo(info);
      if (!targetAudienceSizeTouched.current) setTargetAudienceSize(String(info.pending ?? info.active));
    } catch {
      // Same rationale as loadShows: a stale/invalid token already
      // surfaces via the main connection error banner.
    }
  }, [connectedToken]);

  const loadLobby = useCallback(async () => {
    if (!connectedToken) return;
    try {
      const response = await api("lobby", connectedToken);
      const info = await response.json() as LobbyInfo;
      if (info && Array.isArray(info.startTimes)) setLobbyInfo(info);
    } catch {
      // Main status polling owns connection error reporting.
    }
  }, [connectedToken]);

  const loadFlow = useCallback(async () => {
    if (!connectedToken) return;
    try {
      const response = await api("flow", connectedToken);
      const nextFlow = await response.json() as SceneFlow;
      if (nextFlow && typeof nextFlow.entryPhaseId === "string" && Array.isArray(nextFlow.scenes)) setFlow(nextFlow);
    } catch {
      // Main status polling owns connection error reporting. The active
      // scenario is immutable for the lifetime of an engine, so this can
      // retry on the next authenticated connection instead of polling.
    }
  }, [connectedToken]);

  useEffect(() => {
    if (!connectedToken) return;
    void refresh();
    void loadShows();
    void loadGhosts();
    void loadLobby();
    void loadFlow();
    // shows/ghosts poll alongside status so these controls can't go stale
    // while this tab sits open -- selecting/typing a value that fell out
    // of date used to 400 instead of just re-populating.
    const timer = window.setInterval(() => {
      void refresh();
      void loadShows();
      void loadGhosts();
      void loadLobby();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [connectedToken, refresh, loadShows, loadGhosts, loadLobby, loadFlow]);

  const saveLobbyTimes = async (startTimes: number[], successMessage: string) => {
    setSavingLobby(true);
    setFeedback(null);
    try {
      await api("lobby", connectedToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTimes }),
      });
      setFeedback({ status: "success", message: successMessage });
      await Promise.all([loadLobby(), refresh()]);
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "Could not update the lobby schedule." });
    } finally {
      setSavingLobby(false);
    }
  };

  const addLobbyTime = async (event: FormEvent) => {
    event.preventDefault();
    const startAt = new Date(newStartTime).getTime();
    if (!Number.isSafeInteger(startAt) || startAt <= Date.now()) {
      setFeedback({ status: "danger", message: "Choose a future start time." });
      return;
    }
    await saveLobbyTimes([...(lobbyInfo?.startTimes ?? []), startAt], "Start time added.");
    setNewStartTime("");
  };

  const adjustLobby = async (deltaMs: -60000 | -10000 | 10000 | 60000) => {
    setSavingLobby(true);
    setFeedback(null);
    try {
      await api("lobby/adjust", connectedToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deltaMs }),
      });
      setFeedback({ status: "success", message: `Next start moved ${deltaMs > 0 ? "later" : "earlier"}.` });
      await Promise.all([loadLobby(), refresh()]);
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "Could not adjust the next start." });
    } finally {
      setSavingLobby(false);
    }
  };

  const saveShow = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedShowId) return;
    setSavingShow(true);
    setFeedback(null);
    try {
      await api("shows", connectedToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showId: selectedShowId }),
      });
      selectedShowIdTouched.current = false;
      setFeedback({ status: "success", message: "Saved -- applies automatically within moments." });
      await loadShows();
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "Could not save the active show." });
    } finally {
      setSavingShow(false);
    }
  };

  const saveGhosts = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(targetAudienceSize);
    if (!Number.isInteger(value) || value < 0) return;
    setSavingGhosts(true);
    setFeedback(null);
    try {
      await api("ghosts", connectedToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetAudienceSize: value }),
      });
      targetAudienceSizeTouched.current = false;
      setFeedback({ status: "success", message: "Saved -- applies automatically within moments." });
      await loadGhosts();
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "Could not save the ghost fill target." });
    } finally {
      setSavingGhosts(false);
    }
  };

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (!email || !password) {
      setFeedback({ status: "danger", message: "Enter your operator email and password." });
      return;
    }
    setFeedback(null);
    setConnectionError("");
    setStatusStale(false);
    setSigningIn(true);
    try {
      const pb = new PocketBase(POCKETBASE_URL);
      await pb.collection("operators").authWithPassword(email, password);
      const nextToken = pb.authStore.token;
      localStorage.setItem("admin-token", nextToken);
      setPassword("");
      if (nextToken === connectedToken) void refresh();
      else {
        statusRef.current = null;
        setStatus(null);
        setConnectedToken(nextToken);
      }
    } catch {
      setFeedback({ status: "danger", message: "Invalid operator email or password." });
    } finally {
      setSigningIn(false);
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

  const jumpToScene = async (scene: FlowScene) => {
    setWorkingAction("jump");
    setFeedback(null);
    try {
      await api("jump", connectedToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phaseId: scene.id }),
      });
      setFeedback({ status: "success", message: `Jumped to “${scene.title}”.` });
      await refresh();
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "Could not jump to that scene." });
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
  const requestJump = (scene: FlowScene, trigger: HTMLButtonElement) => {
    confirmTriggerRef.current = trigger;
    setJumpScene(scene);
  };
  const closeJumpConfirmation = () => {
    setJumpScene(null);
    queueMicrotask(() => confirmTriggerRef.current?.focus());
  };
  const confirmJump = () => {
    if (!jumpScene) return;
    const scene = jumpScene;
    setJumpScene(null);
    confirmTriggerRef.current?.focus();
    void jumpToScene(scene).finally(() => {
      requestAnimationFrame(() => {
        if (confirmTriggerRef.current?.disabled) flowHeadingRef.current?.focus();
      });
    });
  };

  const isActive = status?.lifecycle === "active";
  const canStart = Boolean(status && !isActive && status.displayConnected && status.connectedParticipants > 0);
  const canReturnToIdle = Boolean(status?.lifecycle && status.lifecycle !== "idle");
  const busy = workingAction !== null;
  const playbackStatus: ToolStatus = status?.displayPlaybackIssue?.status === "stalled" ? "warning" : status?.displayPlaybackIssue ? "danger" : "success";
  const globalStatus: ToolStatus = status ? (statusStale || !status.healthy || !status.ready ? "warning" : status.displayPlaybackIssue ? playbackStatus : "success") : connectionError ? "danger" : "info";
  const globalLabel = status ? (statusStale ? "Status stale" : !status.healthy || !status.ready ? "System not ready" : status.displayPlaybackIssue ? "Playback issue" : "System ready") : refreshing ? "Connecting" : connectionError ? "Connection failed" : "Not connected";

  return <div data-sc-tool-density="standard" data-sc-tool-root>
    <main className="admin-app">
      <header className="admin-header">
        <div><p className="sc-tool-eyebrow">Live installation / operator console</p><h1>Operations</h1></div>
        <StatusLabel status={globalStatus}>{globalLabel}</StatusLabel>
      </header>

      <section className="sc-tool-panel admin-connection" aria-labelledby="admin-connection-heading">
        <div className="admin-section-heading">
          <div><p className="sc-tool-eyebrow">Secure access</p><h2 id="admin-connection-heading">Admin connection</h2></div>
          {status && <StatusLabel status={statusStale ? "warning" : "success"}>{statusStale ? "Last status received" : "Authenticated"}</StatusLabel>}
        </div>
        <form className="admin-connection-form" onSubmit={(event) => void connect(event)}>
          <label className="sc-tool-label" htmlFor="admin-email">Operator email
            <input id="admin-email" className="sc-tool-field" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="sc-tool-label" htmlFor="admin-password">Password
            <input id="admin-password" className="sc-tool-field sc-tool-mono" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby="admin-token-help" />
          </label>
          <button className="sc-tool-button" data-sc-tool-variant="primary" type="submit" disabled={refreshing || signingIn}>{status ? "Reconnect" : signingIn ? "Signing in…" : refreshing ? "Connecting…" : "Sign in"}</button>
        </form>
        <p id="admin-token-help" className="sc-tool-help">Stays signed in on this device for 30 days. Connected sessions refresh every 2 seconds.</p>
        {connectionError && <p className="sc-tool-feedback admin-feedback" data-sc-tool-status={statusStale ? "warning" : "danger"} role="alert"><StatusIcon status={statusStale ? "warning" : "danger"} /><span>{connectionError}{statusStale ? " Showing the last received status." : ""}</span></p>}
      </section>

      {feedback && <div className="sc-tool-feedback admin-page-feedback" data-sc-tool-status={feedback.status} role={feedback.status === "danger" ? "alert" : "status"}><StatusIcon status={feedback.status} /><span>{feedback.message}</span></div>}

      {!status ? <section className="sc-tool-panel admin-empty-state" aria-live="polite">
        <p className="sc-tool-eyebrow">Operational data</p>
        <h2>{refreshing ? "Loading live status…" : "Connect to load live status"}</h2>
        <p className="sc-tool-copy">No operational values are shown until the admin API authenticates this browser session.</p>
      </section> : <div className="admin-grid">
        <section className="sc-tool-panel" aria-labelledby="admin-status-heading">
          <div className="admin-section-heading"><div><p className="sc-tool-eyebrow">Live topology</p><h2 id="admin-status-heading">Operational status</h2></div><span className="sc-tool-mono admin-section-count">Live</span></div>
          <div className="admin-operation-list">
            <OperationRow label="Server" status={status.healthy && status.ready ? "success" : status.healthy ? "warning" : "danger"} value={status.healthy && status.ready ? "READY" : "NOT READY"} detail={`uptime ${formatDuration(status.uptimeMs)}`} />
            <OperationRow label="Display" status={status.displayConnected ? "success" : "danger"} value={status.displayConnected ? "CONNECTED" : "DISCONNECTED"} detail={status.displayConnected && status.displayHeartbeatAgeMs !== null ? `heartbeat ${status.displayHeartbeatAgeMs} ms ago` : "no heartbeat available"} />
            <OperationRow label="Video playback" status={playbackStatus} value={status.displayPlaybackIssue ? status.displayPlaybackIssue.status.toUpperCase() : "CLEAR"} detail={status.displayPlaybackIssue ? `${status.displayPlaybackIssue.mediaId}: ${status.displayPlaybackIssue.detail ?? "no browser detail"}` : "no active playback issue"} />
            <OperationRow label="Participants" status={status.connectedParticipants > 0 ? "info" : "warning"} value={String(status.connectedParticipants)} detail="currently connected" />
            <OperationRow label="Session" status={isActive ? "success" : "info"} value={(status.lifecycle ?? "unavailable").toUpperCase()} detail={status.sessionId ? `session ${status.sessionId}` : "no session ID"} />
          </div>
        </section>

        <section className="sc-tool-panel" aria-labelledby="admin-controls-heading">
          <div className="admin-section-heading"><div><p className="sc-tool-eyebrow">{status.sessionId ? `Session ${status.sessionId}` : "No active session"}</p><h2 ref={controlsHeadingRef} id="admin-controls-heading" tabIndex={-1}>Session controls</h2></div><StatusLabel status={isActive ? "success" : "info"}>{status.lifecycle ?? "Unavailable"}</StatusLabel></div>
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

        <section className="sc-tool-panel admin-flow-panel" aria-labelledby="admin-flow-heading">
          <div className="admin-section-heading">
            <div><p className="sc-tool-eyebrow">Whole-show navigation</p><h2 ref={flowHeadingRef} id="admin-flow-heading" tabIndex={-1}>Scene navigator</h2></div>
            <StatusLabel status={isActive ? "success" : "info"}>{isActive ? "Jump enabled" : "Available during show"}</StatusLabel>
          </div>
          <p className="sc-tool-copy admin-flow-intro">The published flow is shown in Studio order. Each node includes its outgoing route; branching scenes expose every possible outcome.</p>
          {flow?.scenes.length ? <ol className="admin-flow-list" aria-label="Published show scenes">
            {flow.scenes.map((scene, index) => {
              const isCurrent = status.phaseId === scene.id;
              const isEntry = flow.entryPhaseId === scene.id;
              return <li key={scene.id}>
                <button
                  className="admin-flow-node sc-tool-graph-node"
                  data-sc-tool-domain={scene.kind === "video" ? "video" : "question"}
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={`${isCurrent ? "Current scene, " : ""}${scene.title}${isCurrent ? ", already playing" : ", jump to this scene"}`}
                  type="button"
                  disabled={!isActive || busy || isCurrent}
                  onClick={(event) => requestJump(scene, event.currentTarget)}
                >
                  <span className="admin-flow-node-head"><span>{String(index + 1).padStart(2, "0")} · {sceneKindLabel(scene.kind)}</span>{isEntry && <span>Entry</span>}{isCurrent && <span>Now</span>}</span>
                  <strong>{scene.title}</strong>
                  <span className="sc-tool-mono admin-flow-node-id">{scene.id}</span>
                  <span className="admin-flow-routes">{scene.routes.map((route) => <span key={`${route.outcome}:${route.target}`}><b>{route.outcome}</b> → {route.target === "idle" ? "End" : route.target}</span>)}</span>
                </button>
              </li>;
            })}
          </ol> : <p className="sc-tool-copy">No scene graph is available from the running show.</p>}
        </section>

        <section className="sc-tool-panel" aria-labelledby="admin-lobby-heading">
          <div className="admin-section-heading">
            <div><p className="sc-tool-eyebrow">Waiting room timing</p><h2 id="admin-lobby-heading">Lobby schedule</h2></div>
            <StatusLabel status={lobbyInfo?.nextStartAt ? "info" : "warning"}>{lobbyInfo?.nextStartAt ? "Scheduled" : "Manual start"}</StatusLabel>
          </div>
          <div className="admin-next-start">
            <span>Next start</span>
            <strong>{lobbyInfo?.nextStartAt ? new Date(lobbyInfo.nextStartAt).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" }) : "No automatic start"}</strong>
          </div>
          <div className="admin-time-adjustments" aria-label="Adjust next start time">
            {([-60000, -10000, 10000, 60000] as const).map((delta) => (
              <button key={delta} className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={savingLobby || !lobbyInfo?.nextStartAt} onClick={() => void adjustLobby(delta)}>
                {delta < 0 ? "−" : "+"}{Math.abs(delta) === 60000 ? "1 min" : "10 sec"}
              </button>
            ))}
          </div>
          <form className="admin-connection-form admin-lobby-form" onSubmit={(event) => void addLobbyTime(event)}>
            <label className="sc-tool-label" htmlFor="lobby-start-time">Add start time
              <input id="lobby-start-time" className="sc-tool-field" type="datetime-local" step="1" value={newStartTime} onChange={(event) => setNewStartTime(event.target.value)} />
            </label>
            <button className="sc-tool-button" data-sc-tool-variant="primary" type="submit" disabled={savingLobby || !newStartTime}>{savingLobby ? "Saving…" : "Add"}</button>
          </form>
          {(lobbyInfo?.startTimes.length ?? 0) > 0 ? <ol className="admin-schedule-list">
            {lobbyInfo!.startTimes.map((startAt, index) => <li key={startAt}>
              <div><strong>{index === 0 ? "Next · " : ""}{new Date(startAt).toLocaleDateString([], { dateStyle: "medium" })}</strong><span>{new Date(startAt).toLocaleTimeString([], { timeStyle: "medium" })}</span></div>
              <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={savingLobby} onClick={() => void saveLobbyTimes(lobbyInfo!.startTimes.filter((time) => time !== startAt), "Start time removed.")}>Remove</button>
            </li>)}
          </ol> : <p className="sc-tool-copy">The lobby waits until an operator presses Start show.</p>}
        </section>

        <section className="sc-tool-panel" aria-labelledby="admin-participants-heading">
          <div className="admin-section-heading">
            <div><p className="sc-tool-eyebrow">Who has joined</p><h2 id="admin-participants-heading">Participants</h2></div>
            <span className="sc-tool-mono admin-section-count">{status.connectedParticipants} connected</span>
          </div>
          {status.participants.length === 0 ? <p className="sc-tool-copy">Nobody has joined this session yet.</p> : <ul className="admin-participant-list">
            {status.participants.map((participant) => <li key={participant.clientId}>
              <span className="admin-participant-color" style={{ backgroundColor: participant.color }} />
              <div><strong>{participant.name}</strong><span>joined {new Date(participant.joinedAt).toLocaleTimeString([], { timeStyle: "short" })}</span></div>
              <StatusLabel status={participant.connected ? "success" : "warning"}>{participant.connected ? "Connected" : "Disconnected"}</StatusLabel>
            </li>)}
          </ul>}
        </section>


        <section className="sc-tool-panel" aria-labelledby="admin-show-heading">
          <div className="admin-section-heading">
            <div><p className="sc-tool-eyebrow">Which content is live</p><h2 id="admin-show-heading">Active show</h2></div>
          </div>
          <dl className="admin-session-facts">
            <div><dt>Currently running</dt><dd className="sc-tool-mono">{showLabel(showsInfo?.active ?? null, showsInfo?.shows ?? [])}</dd></div>
            {showsInfo?.pending && <div><dt>Applying</dt><dd className="sc-tool-mono">{showLabel(showsInfo.pending, showsInfo.shows)}</dd></div>}
          </dl>
          {showsInfo && showsInfo.shows.length === 0
            ? <p className="sc-tool-copy">No shows have been published to PocketBase yet.</p>
            : <form className="admin-connection-form" onSubmit={(event) => void saveShow(event)}>
                <label className="sc-tool-label" htmlFor="active-show">Show
                  <select id="active-show" className="sc-tool-field" value={selectedShowId} onChange={(event) => { selectedShowIdTouched.current = true; setSelectedShowId(event.target.value); }}>
                    {(showsInfo?.shows ?? []).map((show) => (
                      <option key={show.showId} value={show.showId}>{show.name} ({show.version}) — {new Date(show.publishedAt).toLocaleString()}</option>
                    ))}
                  </select>
                </label>
                <button className="sc-tool-button" data-sc-tool-variant="primary" type="submit" disabled={savingShow || !selectedShowId}>{savingShow ? "Saving…" : "Save"}</button>
              </form>}
          <p className="sc-tool-help">Applies automatically within moments of saving -- no manual restart needed.</p>
        </section>

        <section className="sc-tool-panel" aria-labelledby="admin-ghosts-heading">
          <div className="admin-section-heading">
            <div><p className="sc-tool-eyebrow">Fill a sparse room</p><h2 id="admin-ghosts-heading">Ghost cursors</h2></div>
          </div>
          <dl className="admin-session-facts">
            <div><dt>Currently filling up to</dt><dd className="sc-tool-mono">{ghostsInfo?.active ?? "—"}</dd></div>
            {ghostsInfo?.pending !== null && ghostsInfo?.pending !== undefined && ghostsInfo.pending !== ghostsInfo.active
              && <div><dt>Applying</dt><dd className="sc-tool-mono">{ghostsInfo.pending}</dd></div>}
          </dl>
          <form className="admin-connection-form" onSubmit={(event) => void saveGhosts(event)}>
            <label className="sc-tool-label" htmlFor="target-audience-size">Fill up to
              <input id="target-audience-size" className="sc-tool-field sc-tool-mono" type="number" min="0" step="1" value={targetAudienceSize} onChange={(event) => { targetAudienceSizeTouched.current = true; setTargetAudienceSize(event.target.value); }} />
            </label>
            <button className="sc-tool-button" data-sc-tool-variant="primary" type="submit" disabled={savingGhosts || targetAudienceSize === ""}>{savingGhosts ? "Saving…" : "Save"}</button>
          </form>
          <p className="sc-tool-help">Live + replayed past-participant cursors are topped up to this count on display. 0 disables ghosts and defers to whatever the published show sets. Applies automatically within moments of saving.</p>
        </section>

      </div>}
    </main>
    {confirmAction && <ConfirmationDialog action={confirmAction} onCancel={closeConfirmation} onConfirm={confirmControl} />}
    {jumpScene && <JumpConfirmationDialog scene={jumpScene} onCancel={closeJumpConfirmation} onConfirm={confirmJump} />}
  </div>;
}
