import { AdmissionPrograms, type AdmissionStatus } from './AdmissionPrograms.js';
import { ParticipantTasks, type TaskStatus } from './ParticipantTasks.js';
import { NativeAudioCoverage } from './NativeAudioCoverage.js';
import { SurfaceInstrument } from "./SurfaceInstrument.js";
import { VideoWall } from "./VideoWall.js";
import { SceneTiming } from "./SceneTiming.js";
import { GroupSelectionStart } from "./GroupSelectionStart.js";
import type { TimingMonitor } from "@entertheblackbox/protocol";
import { ServerClock } from "@entertheblackbox/shared";
import { ShowClockPanel } from "./ShowClockPanel.js";
import { DisplaySettingsPanel } from "./DisplaySettingsPanel.js";
import { RunOfShowPanel } from "./RunOfShowPanel.js";
import { LiveGraph } from "./LiveGraph.js";
import { StatusIcon, type ToolStatus } from "@entertheblackbox/tool-ui";
import { AudioDiagnostics } from "./AudioDiagnostics";
import PocketBase from "pocketbase";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

const POCKETBASE_URL = import.meta.env.VITE_POCKETBASE_URL ?? "http://127.0.0.1:8090";

export type Status = {
  tasks?: TaskStatus | null;
  admission?: AdmissionStatus | null;
  audio?: { backgroundMusic?: { src: string; volume: number } | null; configured: boolean; capacity?: { total: number; assigned: number; available: number }; deliveryFailures?: Record<string, string>; error?: string | null; poll_age_s?: number | null; soundcheckSources?: string[]; backend?: "remote" | "local"; backendLabel?: string; players: Array<{ player_id: string; transport?: "icecast" | "janus"; name?: string; connected: boolean; flagged: boolean; listeners: number; playbackState?: string; phoneReportAgeMs?: number; reconnects?: number; lastRecoveryMs?: number | null }> };
  healthy: boolean;
  ready: boolean;
  phoneJoinUrl: string | null;
  uptimeMs: number;
  serverTime?: number;
  timingMonitors?: TimingMonitor[];
  phaseTiming?: { startedAt: number; deadlineAt: number | null } | null;
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
    groupId?: string | null;
    state?: "choosing" | "unassigned" | "active" | "finished";
  }>;
  groups?: Array<{ id: string; label: string; color?: string }>;
  sessionId: string | null;
  lifecycle: string | null;
  phaseId: string | null;
  phaseEpoch: number | null;
  groupDestinations?: string[];
  pendingGroupAssignments?: string[];
  pendingDisconnectedGroupAssignments?: string[];
  groupPathsStarted: boolean;
  groupPaths: Array<{
    parentGroupId?: string | null;
    deadlineAt?: number | null;
    groupId: string;
    startedAt?: number;
    memberIds: string[];
    jumpTargets?: string[];
    acceptingParticipants?: boolean;
    state?: "choosing" | "active" | "finished" | "split" | "empty";
    pendingAssignments?: number;
    pendingDisconnectedAssignments?: number;
    reunionPhaseId?: string;
    phaseId: string;
    phaseEpoch: number;
    done: boolean;
    label: string;
    color: string | null;
    phaseTitle: string;
  }>;
};

type Feedback = { status: "success" | "danger"; message: string };
type ConfirmAction = "idle" | "restart" | "reunion";
export type FlowScene = {
  id: string;
  kind: "video" | "narration" | "position-question" | "video-position-question" | "group-branch";
  title: string;
  routes: Array<{ outcome: string; target: string }>;
};
export type SceneFlow = { entryPhaseId: string; scenes: FlowScene[] };
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
    if (response.status === 409) {
      const body = await response.json().catch(() => null) as { reason?: string } | null;
      throw new Error(body?.reason === "unassigned-participants" ? "Some people still need a group. Keep selection open or assign them before starting." : "The server refused this action in the current show state.");
    }
    if (response.status === 502) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? `Request failed (${response.status})`);
    }
    throw new Error(`Request failed (${response.status})`);
  }
  return response;
}



function showLabel(showId: string | null, shows: PublishedShow[]): string {
  if (!showId) return "—";
  const show = shows.find((candidate) => candidate.showId === showId);
  return show ? `${show.name} (${show.version})` : showId;
}

function StatusLabel({ status, children }: { status: ToolStatus; children: ReactNode }) {
  return <span className="sc-tool-status" data-sc-tool-status={status}><StatusIcon status={status} /><span>{children}</span></span>;
}

/** A dashboard panel that can be collapsed once it isn't the operator's immediate focus. Keeps the same eyebrow/heading/status-label header used by the always-expanded sections. */
function CollapsibleSection({ id, eyebrow, title, status, open, onToggle, children }: {
  id: string;
  eyebrow: string;
  title: string;
  status?: { status: ToolStatus; label: ReactNode };
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  return <details className="sc-tool-panel admin-collapsible" open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
    <summary className="admin-section-heading admin-collapsible-summary">
      <div><p className="sc-tool-eyebrow">{eyebrow}</p><h2 id={id}>{title}</h2></div>
      <div className="admin-collapsible-trailing">
        {status && <StatusLabel status={status.status}>{status.label}</StatusLabel>}
      </div>
    </summary>
    <div className="admin-collapsible-body">{children}</div>
  </details>;
}

function ConfirmationDialog({ action, scopeLabel, onCancel, onConfirm }: { scopeLabel?: string | undefined; action: ConfirmAction; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = `admin-${action}-confirmation-title`;
  const descriptionId = `admin-${action}-confirmation-description`;
  const isRestart = action === "restart";
  const isReunion = action === "reunion";

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
      <h2 id={titleId}>{isRestart ? "Restart the show?" : isReunion ? scopeLabel ? `Finish subgroups of ${scopeLabel}?` : "Bring all groups to reunion?" : "Return the show to idle?"}</h2>
      <p id={descriptionId}>{isRestart
        ? "This creates a new session and returns the running show to its entry phase."
        : isReunion
          ? scopeLabel ? `This ends only the subgroups of ${scopeLabel} and advances their parent to its reunion. Other groups continue.` : "This ends every still-running group's current scene early and moves everyone to the shared reunion scene, even groups that aren't ready."
          : "This stops the current show and returns connected installation screens to idle."}</p>
      <div className="sc-tool-dialog-actions">
        <button ref={cancelRef} className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={onCancel}>{isReunion ? "Let groups keep running" : "Keep current show"}</button>
        <button className="sc-tool-button" data-sc-tool-variant="danger" type="button" onClick={onConfirm}>{isRestart ? "Restart show" : isReunion ? "Bring all to reunion" : "Return to idle"}</button>
      </div>
    </div>
  </div>;
}

function JumpConfirmationDialog({ scene, scope, restart = false, onCancel, onConfirm }: { scene: FlowScene; scope: string; restart?: boolean; onCancel: () => void; onConfirm: () => void }) {
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
      <p className="sc-tool-eyebrow">{restart ? "Restart current scene" : "Scene jump"}</p>
      <h2 id={titleId}>{restart ? "Restart" : "Jump to"} “{scene.title}”?</h2>
      <p id={descriptionId}>{restart ? `${scope}: replay this scene from the beginning, reset its timer and clear its current vote. Audio, video and show cues play again. Other group paths keep running.` : <>{scope}: this immediately leaves the current scene, clears its in-progress vote or playback state, and starts <span className="sc-tool-mono">{scene.id}</span>.</>}</p>
      <div className="sc-tool-dialog-actions">
        <button ref={cancelRef} className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={onCancel}>Keep current scene</button>
        <button className="sc-tool-button" data-sc-tool-variant="primary" type="button" onClick={onConfirm}>{restart ? "Restart scene" : "Jump to scene"}</button>
      </div>
    </div>
  </div>;
}

/**
 * Join-screen copy is set up once per show and rarely touched live, so it
 * stays collapsed (and its settings fetch deferred until first opened)
 * rather than sitting ahead of operational panels every time this page loads.
 */
function DisplaySettingsDisclosure({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  return <details className="sc-tool-panel admin-collapsible" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="admin-collapsible-summary"><p className="sc-tool-eyebrow">Show setup</p><span>Display text and waiting video</span></summary>
    {open && <DisplaySettingsPanel key={token} token={token} />}
  </details>;
}

function sceneKindLabel(kind: FlowScene["kind"]): string {
  return kind === "video" ? "Media"
    : kind === "narration" ? "Narration"
      : kind === "position-question" ? "Question"
        : kind === "group-branch" ? "Group branch"
          : "Media + vote";
}

export function App() {
  const [activeTab, setActiveTab] = useState(() => {
    try { const saved = localStorage.getItem("admin-view"); return ["show", "devices", "displays", "setup"].includes(saved ?? "") ? saved! : "show"; } catch { return "show"; }
  });
  const selectTab = (tab: string) => { setActiveTab(tab); try { localStorage.setItem("admin-view", tab); } catch {} };

  const clock = useRef(new ServerClock()).current;
  const audioOnly = new URLSearchParams(window.location.search).get("view") === "audio";
  const [statusReceivedAt, setStatusReceivedAt] = useState<number | null>(null);
  const refreshInFlight = useRef(false);
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
  const [reunionScope, setReunionScope] = useState<{ groupId: string; phaseId: string; phaseEpoch: number; label: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [flow, setFlow] = useState<SceneFlow | null>(null);
  const [jumpScope, setJumpScope] = useState<{ groupId?: string; label: string; epoch: number | null; sessionId: string | null; phaseId: string | null }>({ label: "Whole show", epoch: null, sessionId: null, phaseId: null });
  const [restartingScene, setRestartingScene] = useState(false);
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
  // Collapsible dashboard sections: default open/closed is decided once, the
  // first time live status arrives, then left entirely to the operator's own
  // clicks -- re-deciding it on every 2s poll would fight manual toggles.
  const [showSectionOpen, setShowSectionOpen] = useState(false);
  const [ghostsSectionOpen, setGhostsSectionOpen] = useState(false);
  const collapsibleDefaultsSet = useRef(false);
  useEffect(() => {
    if (collapsibleDefaultsSet.current || !status) return;
    collapsibleDefaultsSet.current = true;
  }, [status]);
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
    if (!connectedToken || refreshInFlight.current) return;
    refreshInFlight.current = true;
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 10_000);
    setRefreshing(true);
    try {
      const sentAt = Date.now();
      const response = await api("status", connectedToken, { signal: abort.signal });
      const nextStatus = await response.json() as Status;
      if (nextStatus.serverTime !== undefined) clock.addSample(sentAt, Date.now(), nextStatus.serverTime);
      statusRef.current = nextStatus;
      setStatus(nextStatus);
      setStatusReceivedAt(Date.now());
      setStatusStale(false);
      setConnectionError("");
    } catch (error) {
      setStatusStale(statusRef.current !== null);
      setConnectionError(error instanceof Error ? error.message : "Could not connect to the admin API.");
    } finally {
      clearTimeout(timeout);
      refreshInFlight.current = false;
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
    if (!audioOnly) {
      void loadShows();
      void loadGhosts();
      void loadLobby();
      void loadFlow();
    }
    // shows/ghosts poll alongside status so these controls can't go stale
    // while this tab sits open -- selecting/typing a value that fell out
    // of date used to 400 instead of just re-populating.
    const timer = window.setInterval(() => {
      void refresh();
      if (!audioOnly) {
        void loadShows();
        void loadGhosts();
        void loadLobby();
      }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [connectedToken, refresh, loadShows, loadGhosts, loadLobby, loadFlow, audioOnly]);

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

  const addLobbyTimeInFiveMinutes = async () => {
    const startAt = Date.now() + 5 * 60_000;
    await saveLobbyTimes([...(lobbyInfo?.startTimes ?? []), startAt], "Show added in 5 minutes.");
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
      setFeedback({ status: "success", message: status?.lifecycle === "active" ? "Saved -- queued until the current show ends." : "Saved -- applies automatically within moments." });
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
      setFeedback({ status: "success", message: status?.lifecycle === "active" ? "Saved -- queued until the current show ends." : "Saved -- applies automatically within moments." });
      await loadGhosts();
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "Could not save the ghost fill target." });
    } finally {
      setSavingGhosts(false);
    }
  };

  const signOut = () => {
    localStorage.removeItem("admin-token");
    statusRef.current = null;
    setStatus(null);
    setStatusStale(false);
    setConnectionError("");
    setConnectedToken("");
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

  const control = async (action: "start" | "idle" | "restart") => {
    setWorkingAction(action);
    setFeedback(null);
    try {
      await api(action, connectedToken, { method: "POST" });
      const labels = { start: "Show started.", idle: "Show returned to idle.", restart: "Show restarted." };
      setFeedback({ status: "success", message: labels[action] });
      await refresh();
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "The action failed." });
    } finally {
      setWorkingAction(null);
    }
  };
  const skipPhase = async (groupId?: string, groupLabel?: string) => {
    const workingKey = groupId ? `skip-${groupId}` : "skip";
    setWorkingAction(workingKey);
    setFeedback(null);
    try {
      await api("skip", connectedToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(groupId ? { groupId, expectedPhaseId: status?.groupPaths.find((path) => path.groupId === groupId)?.phaseId } : { expectedPhaseId: status?.phaseId }),
      });
      setFeedback({ status: "success", message: groupLabel ? `${groupLabel}’s current scene skipped.` : "Current phase skipped." });
      await refresh();
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "The action failed." });
    } finally {
      setWorkingAction(null);
    }
  };
  const startGroupPaths = async (groupId?: string, expectedPhaseId = status?.phaseId ?? undefined, expectedEpoch = status?.phaseEpoch ?? undefined, skipDisconnected = false) => {
    setWorkingAction("start-group-paths");
    setFeedback(null);
    try {
      await api("groups/start-paths", connectedToken, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId, expectedPhaseId, expectedEpoch, ...(skipDisconnected ? { skipDisconnected: true } : {}) }) });
      setFeedback({ status: "success", message: "Group assignment finished; branches started." });
      await refresh();
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "Could not start the group branches." });
    } finally {
      setWorkingAction(null);
    }
  };
  const forceReunion = async () => {
    setWorkingAction("reunion");
    setFeedback(null);
    try {
      await api("groups/reunion", connectedToken, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId: reunionScope?.groupId, expectedPhaseId: reunionScope?.phaseId ?? status?.phaseId, expectedEpoch: reunionScope?.phaseEpoch ?? status?.phaseEpoch }) });
      setFeedback({ status: "success", message: reunionScope ? `${reunionScope.label} subgroups finished.` : "All groups brought to reunion." });
      await refresh();
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "Could not bring groups to reunion." });
    } finally {
      setWorkingAction(null);
    }
  };
  const assignGroup = async (participantId: string, groupId: string) => {
    setFeedback(null);
    setWorkingAction("assign");
    try {
      await api("groups/assign", connectedToken, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, groupId, expectedEpoch: status?.phaseEpoch, sessionId: status?.sessionId }),
      });
      setFeedback({ status: "success", message: status?.groupPathsStarted ? "Participant joined the group’s current scene and playback position." : "Participant group updated." });
      await refresh();
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "Could not update the participant group." });
    } finally { setWorkingAction(null); }
  };

  const jumpToScene = async (scene: FlowScene) => {
    setWorkingAction("jump");
    setFeedback(null);
    try {
      await api("jump", connectedToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phaseId: scene.id, groupId: jumpScope.groupId, expectedPhaseId: jumpScope.phaseId, expectedEpoch: jumpScope.epoch, sessionId: jumpScope.sessionId }),
      });
      setFeedback({ status: "success", message: restartingScene ? `Restarted “${scene.title}”.` : `Jumped to “${scene.title}”.` });
      await refresh();
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "Could not jump to that scene." });
    } finally {
      setWorkingAction(null);
    }
  };

  const requestConfirmation = (action: ConfirmAction, trigger: HTMLButtonElement, scope?: { groupId: string; phaseId: string; phaseEpoch: number; label: string }) => {
    setReunionScope(scope ?? null);
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
    void (action === "reunion" ? forceReunion() : control(action)).finally(() => {
      requestAnimationFrame(() => {
        if (confirmTriggerRef.current?.disabled) controlsHeadingRef.current?.focus();
      });
    });
  };
  const requestJump = (scene: FlowScene, trigger: HTMLButtonElement, groupId?: string, restart = false) => {
    setRestartingScene(restart);
    const path = status?.groupPaths.find((p) => p.groupId === groupId && p.state !== "split");
    setJumpScope({ ...(groupId ? { groupId } : {}), label: path ? `${path.label} · ${path.memberIds.length} participants` : "Whole show", epoch: path?.phaseEpoch ?? status?.phaseEpoch ?? null, sessionId: status?.sessionId ?? null, phaseId: path?.phaseId ?? status?.phaseId ?? null });
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
        if (!confirmTriggerRef.current?.isConnected || confirmTriggerRef.current.disabled) {
          (restartingScene ? controlsHeadingRef : flowHeadingRef).current?.focus();
        }
      });
    });
  };

  const isActive = status?.lifecycle === "active";
  const canStart = Boolean(status && !isActive);
  const canReturnToIdle = Boolean(status?.lifecycle && status.lifecycle !== "idle");
  const busy = workingAction !== null || statusStale || Boolean(connectionError);
  const currentScene = status ? flow?.scenes.find((scene) => scene.id === status.phaseId) : undefined;
  const inGroupBranch = currentScene?.kind === "group-branch";
  const sceneTitle = (id: string): string => id === "idle" ? "End" : flow?.scenes.find((scene) => scene.id === id)?.title ?? id;
  const skipLabel = currentScene?.kind === "video" && currentScene.routes[0] ? `Next scene → ${sceneTitle(currentScene.routes[0].target)}` : "Skip current phase";
  // Once a session has authenticated cleanly, the connection form collapses
  // to a corner chip -- it reappears automatically on connectionError (token
  // expiry, a failed request) so re-authenticating is never more than one
  // glance away, without permanently occupying primary dashboard space.
  const connectionAuthenticated = Boolean(status) && !connectionError;

  const renderGroup = (path: Status["groupPaths"][number], ancestors: string[] = []): ReactNode => (<div className="admin-group-lane" key={`${path.groupId}:${path.phaseEpoch}`}><h3>{path.label}</h3><p>{path.memberIds.length} {path.memberIds.length === 1 ? "participant" : "participants"} · {path.state === "choosing" ? "Choosing" : path.done ? "Waiting at reunion" : path.state === "empty" ? "Empty" : path.state === "split" ? "Subgroups running" : "Running"}</p><h4>{path.phaseTitle}</h4><SceneTiming clock={clock} startedAt={path.startedAt} deadlineAt={path.deadlineAt} stale={statusStale} finished={path.done} />
                {path.state === "choosing" ? <GroupSelectionStart label={`Start groups for ${path.label}`} pending={path.pendingAssignments ?? 0} disconnected={path.pendingDisconnectedAssignments ?? 0} disabled={busy} onStart={(skip) => void startGroupPaths(path.groupId, path.phaseId, path.phaseEpoch, skip)} />
                  : path.state === "split" ? <button className="sc-tool-button" type="button" disabled={busy} onClick={(event) => requestConfirmation("reunion", event.currentTarget, path)}>Finish subgroups of {path.label}</button>
                  : <button className="sc-tool-button" data-sc-tool-variant={path.done ? "secondary" : "primary"} type="button" disabled={path.done || path.state === "empty" || path.acceptingParticipants === false || busy} onClick={() => void skipPhase(path.groupId, path.label)}>
                  {path.state === "empty" ? `${path.label} — empty, available to join` : path.done ? `${path.label} — finished` : `Next scene for ${path.label} — ${path.memberIds.length} ${path.memberIds.length === 1 ? "person" : "people"}`}
                </button>}
                <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={busy || path.done || path.state === "empty" || path.state === "split" || path.state === "choosing" || path.acceptingParticipants === false || !flow?.scenes.some(scene => scene.id === path.phaseId)} onClick={(event) => {
                  const scene = flow?.scenes.find(scene => scene.id === path.phaseId);
                  if (scene) requestJump(scene, event.currentTarget, path.groupId, true);
                }}>Restart scene for {path.label}</button>
                <span>{path.state === "choosing" ? "" : path.done ? "At the reunion point, waiting on the other groups" : `Currently on “${path.phaseTitle}”`}</span>
              <div className="admin-nested-groups">{status?.groupPaths.filter(child => child.parentGroupId === path.groupId && !ancestors.includes(child.groupId) && child.groupId !== path.groupId).map(child => renderGroup(child, [...ancestors, path.groupId]))}</div></div>);

  return <div data-sc-tool-density="standard" data-sc-tool-root>
    <main className="admin-app">
      <div className="admin-topbar">
        <header className="admin-header">
          <div><h1>{audioOnly ? "Audio diagnostics" : "Operations"}</h1></div>
          <div className="admin-header-chrome">
            {audioOnly && <a className="admin-back-link" href="/admin/">Back to operations</a>}

          </div>
        </header>
        {status && <div className="admin-status-bar" aria-label="Operational status">
          <StatusLabel status={isActive ? "success" : "info"}>{status.lifecycle ?? "Unavailable"}</StatusLabel>
          <span>{connectionAuthenticated ? "Operator signed in" : "Operator disconnected"}</span>{connectionAuthenticated && <button className="sc-tool-button" type="button" onClick={signOut}>Sign out</button>}
          <button className="sc-tool-button" onClick={() => selectTab("devices")}>{status.connectedParticipants} participants</button>
          <StatusLabel status={statusStale ? "warning" : status.ready ? "success" : "danger"}>{statusStale ? "Updates stale" : status.ready ? "Server connected" : "Server not ready"}</StatusLabel>
        </div>}
        {!audioOnly && <nav className="admin-tabs" aria-label="Admin views">{["show", "tasks", "devices", "instrument", "wall", "displays", "setup"].map(tab => <button key={tab} className="sc-tool-button" aria-pressed={activeTab === tab} onClick={() => selectTab(tab)}>{tab[0]!.toUpperCase() + tab.slice(1)}</button>)}</nav>}

      </div>

      {connectedToken && (activeTab === "devices" || audioOnly) && <NativeAudioCoverage key={connectedToken} token={connectedToken} />}
      {connectedToken && status?.admission && activeTab === 'tasks' && <AdmissionPrograms token={connectedToken} state={status.admission} participants={status.participants} groups={status.groups ?? []} />}
      {connectedToken && status?.tasks && activeTab === 'tasks' && <ParticipantTasks token={connectedToken} state={status.tasks} sessionId={status.sessionId ?? ''} phaseId={status.phaseId ?? ''} phaseEpoch={status.phaseEpoch ?? 0} participants={status.participants} refresh={tasks => setStatus(current => current ? { ...current, tasks } : current)} />}
      {connectedToken && status && activeTab === "instrument" && !audioOnly && <SurfaceInstrument token={connectedToken} participants={status.participants} />}
      {connectedToken && activeTab === "wall" && !audioOnly && <VideoWall key={connectedToken} token={connectedToken} pocketbaseUrl={POCKETBASE_URL} />}
      {status && (activeTab === "devices" || audioOnly) && <ShowClockPanel clock={clock} status={status} stale={statusStale} receivedAt={statusReceivedAt} />}

      {!connectionAuthenticated && <section className="sc-tool-panel admin-connection" aria-labelledby="admin-connection-heading">
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
      </section>}

      {status?.displayPlaybackIssue && <p className="sc-tool-feedback" role="alert">Video playback · {status.displayPlaybackIssue.status.toUpperCase()} · {status.displayPlaybackIssue.mediaId}: {status.displayPlaybackIssue.detail}</p>}
      {showsInfo?.pending && showsInfo.pending !== showsInfo.active && <p className="sc-tool-feedback">Show selection queued: {showLabel(showsInfo.pending, showsInfo.shows)}. {isActive ? "The current performance finishes first." : "Waiting for activation."}</p>}
      {feedback && <div className="sc-tool-feedback admin-page-feedback" data-sc-tool-status={feedback.status} role={feedback.status === "danger" ? "alert" : "status"}><StatusIcon status={feedback.status} /><span>{feedback.message}</span></div>}

      {!status ? <section className="sc-tool-panel admin-empty-state" aria-live="polite">
        <p className="sc-tool-eyebrow">Operational data</p>
        <h2>{refreshing ? "Loading live status…" : "Connect to load live status"}</h2>
        <p className="sc-tool-copy">No operational values are shown until the admin API authenticates this browser session.</p>
      </section> : audioOnly ? <AudioDiagnostics status={status} receivedAt={statusReceivedAt} failed={Boolean(connectionError)} /> : <div className="admin-grid" data-admin-tab={activeTab}>
        <section hidden={activeTab !== "displays"} className="sc-tool-panel admin-display-content"><h2>Displays</h2><p>Open each output on its screen and enter fullscreen there.</p><div className="admin-display-links">{[{ id: "Main projection", url: "/display/", reported: status.displayConnected ? "Connected" : "Disconnected" }, ...["M1", "M2", "M3", "M4"].map(id => ({ id, url: `/display/?monitor=${id}&setup=1`, reported: "Not reported" })), ...(status.groups ?? []).map(group => ({ id: group.label, url: `/display/?group=${encodeURIComponent(group.id)}`, reported: "Not reported" }))].map(output => <div key={output.id}><strong>{output.id}</strong><span>{output.reported}</span><a href={output.url} target="_blank" rel="noreferrer">Open display ↗</a></div>)}</div></section>
        <section hidden={activeTab !== "show"} className="sc-tool-panel admin-session-panel" aria-labelledby="admin-controls-heading">
          <div className="admin-section-heading"><div><p className="sc-tool-eyebrow">{status.sessionId ? `Session ${status.sessionId}` : "No active session"}</p><h2 ref={controlsHeadingRef} id="admin-controls-heading" tabIndex={-1}>{isActive ? sceneTitle(status.phaseId ?? "idle") : "Ready to start"}</h2></div><StatusLabel status={isActive ? "success" : "info"}>{status.lifecycle ?? "Unavailable"}</StatusLabel></div>
          <div className="admin-session-layout">
          <div>
          {!status.groupPathsStarted && <SceneTiming clock={clock} startedAt={status.phaseTiming?.startedAt} deadlineAt={status.phaseTiming?.deadlineAt} stale={statusStale} />}
          <div className="admin-control-list">
            <div hidden={isActive}><button className="sc-tool-button" data-sc-tool-variant={isActive ? "secondary" : "primary"} type="button" disabled={!canStart || busy} onClick={() => void control("start")}>Start show</button><span>{isActive ? "Unavailable while active" : "Begin a new live session"}</span></div>
            {inGroupBranch ? (status.groupPathsStarted ? <>
              {status.groupPaths.filter(path => !path.parentGroupId || !status.groupPaths.some(parent => parent.groupId === path.parentGroupId)).map(path => renderGroup(path))}
              <div className="admin-group-reunion"><h3>Shared reunion</h3><p>{[...new Set(status.groupPaths.map(path => path.reunionPhaseId).filter((id): id is string => Boolean(id)))].map(sceneTitle).join(" · ")}</p><p>{status.groupPaths.filter(path => path.done).length} / {status.groupPaths.length} paths finished. The shared timeline resumes when occupied paths finish.</p><button className="sc-tool-button" data-sc-tool-variant="danger" type="button" disabled={busy} onClick={(event) => requestConfirmation("reunion", event.currentTarget)}>Bring all groups to reunion</button><span>Explicitly ends unfinished branches, with confirmation</span></div>
            </> : <div><GroupSelectionStart label="Start group paths" pending={status.pendingGroupAssignments?.length ?? 0} disconnected={status.pendingDisconnectedGroupAssignments?.length ?? 0} disabled={!isActive || busy} onStart={(skip) => void startGroupPaths(undefined, undefined, undefined, skip)} /></div>)
              : <div><button className="sc-tool-button" data-sc-tool-variant={isActive ? "primary" : "secondary"} type="button" disabled={!isActive || busy} onClick={() => void skipPhase()}>{skipLabel}</button><span>{isActive ? "Server validates phase support" : "Available during an active show"}</span></div>}
            {!inGroupBranch && <div><button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={!isActive || busy || !currentScene} onClick={(event) => { if (currentScene) requestJump(currentScene, event.currentTarget, undefined, true); }}>Restart current scene</button><span>Replay from the beginning; reset the timer and current vote</span></div>}
            <div><button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={!isActive || busy} onClick={(event) => requestConfirmation("restart", event.currentTarget)}>Restart show</button><span>Create a new session from the entry phase</span></div>
            <div><button className="sc-tool-button" data-sc-tool-variant="danger" type="button" disabled={!canReturnToIdle || busy} onClick={(event) => requestConfirmation("idle", event.currentTarget)}>Return to idle</button><span>Stop the current show</span></div>
          </div>
          </div>

          </div>
        </section>

        <div hidden={activeTab !== "setup"} className="admin-setup-content">          <section className="admin-session-schedule" aria-labelledby="admin-lobby-heading">
            <div className="admin-section-heading"><h3 id="admin-lobby-heading">Lobby schedule</h3><StatusLabel status={lobbyInfo?.nextStartAt ? "info" : "warning"}>{lobbyInfo?.nextStartAt ? "Scheduled" : "Manual start"}</StatusLabel></div>
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
          <button className="sc-tool-button admin-lobby-quick-add" data-sc-tool-variant="primary" type="button" disabled={savingLobby} onClick={() => void addLobbyTimeInFiveMinutes()}>
            {savingLobby ? "Saving…" : "Add show in 5 minutes"}
          </button>
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
          </section><RunOfShowPanel phoneJoinUrl={status.phoneJoinUrl} /></div>

        {isActive && <section hidden={activeTab !== "show"} className="sc-tool-panel admin-flow-panel" aria-labelledby="admin-flow-heading">
          <div className="admin-section-heading">
            <div><p className="sc-tool-eyebrow">Live show navigation</p><h2 ref={flowHeadingRef} id="admin-flow-heading" tabIndex={-1}>Scene navigator</h2></div>
            <StatusLabel status={isActive && !status.groupPathsStarted ? "success" : "info"}>{status.groupPathsStarted ? "Groups running" : isActive ? "Jump enabled" : "Available during show"}</StatusLabel>
          </div>
          <ol className="admin-scene-list">{flow?.scenes.filter(scene => scene.id === status.phaseId || flow.scenes.find(current => current.id === status.phaseId)?.routes.some(route => route.target === scene.id)).map(scene => <li key={scene.id}><span>{scene.id === status.phaseId ? "Current" : "Next route"}</span><strong>{scene.title}</strong></li>)}</ol>
          <details><summary>Full graph &amp; jump</summary>
          {flow?.scenes.length ? <LiveGraph flow={flow} status={status} busy={busy} onJump={requestJump} onAssign={assignGroup} /> : <p className="sc-tool-copy">No scene graph is available from the running show.</p>}</details>
        </section>}

        <section hidden={activeTab !== "devices"} className="sc-tool-panel admin-device-content"><h2>Native participant audio</h2><p>All participant devices use the iOS/Android app with downloaded show audio. Publish narration and background music from Studio. Use the device timing monitor to inspect device timing.</p></section>
        <section hidden={activeTab !== "devices"} className="sc-tool-panel admin-device-content" aria-labelledby="admin-participants-heading">
          <div className="admin-section-heading">
            <div><p className="sc-tool-eyebrow">Who has joined</p><h2 id="admin-participants-heading">Participants</h2></div>
            <span className="sc-tool-mono admin-section-count">{status.connectedParticipants} connected</span>
          </div>
          {status.participants.length === 0 ? <p className="sc-tool-copy">Nobody has joined this session yet.</p> : <ul className="admin-participant-list">
            {status.participants.map((participant) => <li key={participant.clientId}>
              <span className="admin-participant-color" style={{ backgroundColor: participant.color }} />
              <div><strong>{participant.name}</strong>{participant.state && <span>{({ choosing: "Choosing a group", unassigned: "Needs a group — choose on phone or assign here", active: "Active", finished: "Finished — other groups continue" })[participant.state]}</span>}<span>{(() => { const path = status.groupPaths.find((p) => p.memberIds.includes(participant.clientId)); return path ? `${status.groups?.find((g) => g.id === participant.groupId)?.label ?? path.label} · ${path.done ? "Waiting at reunion" : path.phaseTitle}` : status.groupPathsStarted ? "Waiting / needs assignment" : `${status.groups?.find((g) => g.id === participant.groupId)?.label ?? "Unassigned"} · ${sceneTitle(status.phaseId ?? "idle")}`; })()}</span><span>joined {new Date(participant.joinedAt).toLocaleTimeString([], { timeStyle: "short" })}</span>
                {(status.groups?.length ?? 0) > 0 && <label className="sc-tool-label"><span>{status.groupPathsStarted ? "Move to group · current playback position" : "Audience group"}</span><select disabled={busy} className="sc-tool-select" value={participant.groupId ?? ""} onChange={(event) => void assignGroup(participant.clientId, event.target.value)}>
                  <option value="" disabled>Unassigned</option>
                  {status.groups!.map((group) => <option key={group.id} value={group.id} disabled={status.groupDestinations ? !status.groupDestinations.includes(group.id) : status.groupPathsStarted && !status.groupPaths.some((path) => path.groupId === group.id && path.acceptingParticipants !== false)}>{group.label}{(status.groupDestinations ? !status.groupDestinations.includes(group.id) : status.groupPathsStarted && !status.groupPaths.some((path) => path.groupId === group.id && path.acceptingParticipants !== false)) ? " · unavailable" : ""}</option>)}
                </select></label>}
              </div>
              <StatusLabel status={participant.connected ? "success" : "warning"}>{participant.connected ? "Connected" : "Disconnected"}</StatusLabel>
            </li>)}
          </ul>}
        </section>


        <div hidden={activeTab !== "setup"} className="admin-setup-content"><CollapsibleSection id="admin-show-heading" eyebrow="Which content is live" title="Active show" open={showSectionOpen} onToggle={setShowSectionOpen}>
          <dl className="admin-session-facts">
            <div><dt>Currently running</dt><dd className="sc-tool-mono">{showLabel(showsInfo?.active ?? null, showsInfo?.shows ?? [])}</dd></div>
            {status?.displayPlaybackIssue && <p className="sc-tool-feedback" role="alert">Video playback · {status.displayPlaybackIssue.status.toUpperCase()} · {status.displayPlaybackIssue.mediaId}: {status.displayPlaybackIssue.detail}</p>}
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
          <p className="sc-tool-help">Applies automatically; while a show is running, the change waits until that show ends.</p>
        </CollapsibleSection>

        <CollapsibleSection id="admin-ghosts-heading" eyebrow="Fill a sparse room" title="Ghost cursors" open={ghostsSectionOpen} onToggle={setGhostsSectionOpen}>
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
          <p className="sc-tool-help">Live + replayed past-participant cursors are topped up to this count on display. 0 disables ghosts and defers to whatever the published show sets. While a show is running, the change waits until that show ends.</p>
        </CollapsibleSection>

        {connectedToken && <DisplaySettingsDisclosure token={connectedToken} />}</div>

      </div>}
    </main>
    {confirmAction && <ConfirmationDialog scopeLabel={reunionScope?.label} action={confirmAction} onCancel={closeConfirmation} onConfirm={confirmControl} />}
    {jumpScene && <JumpConfirmationDialog scene={jumpScene} scope={jumpScope.label} restart={restartingScene} onCancel={closeJumpConfirmation} onConfirm={confirmJump} />}
  </div>;
}
