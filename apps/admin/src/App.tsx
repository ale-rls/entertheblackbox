import { DisplaySettingsPanel } from "./DisplaySettingsPanel.js";
import { RunOfShowPanel } from "./RunOfShowPanel.js";
import { LiveGraph } from "./LiveGraph.js";
import { StatusIcon, type ToolStatus } from "@entertheblackbox/tool-ui";
import { AudioDiagnostics } from "./AudioDiagnostics";
import PocketBase from "pocketbase";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

const POCKETBASE_URL = import.meta.env.VITE_POCKETBASE_URL ?? "http://127.0.0.1:8090";

export type Status = {
  audio?: { backgroundMusic?: { src: string; volume: number } | null; configured: boolean; capacity?: { total: number; assigned: number; available: number }; deliveryFailures?: Record<string, string>; error?: string | null; poll_age_s?: number | null; soundcheckSources?: string[]; backend?: "remote" | "local"; backendLabel?: string; players: Array<{ player_id: string; name?: string; connected: boolean; flagged: boolean; listeners: number; playbackState?: string; phoneReportAgeMs?: number; reconnects?: number; lastRecoveryMs?: number | null }> };
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
    groupId?: string | null;
  }>;
  groups?: Array<{ id: string; label: string; color?: string }>;
  sessionId: string | null;
  lifecycle: string | null;
  phaseId: string | null;
  phaseEpoch: number | null;
  groupPathsStarted: boolean;
  groupPaths: Array<{
    groupId: string;
    memberIds: string[];
    jumpTargets?: string[];
    acceptingParticipants?: boolean;
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
  kind: "video" | "position-question" | "video-position-question" | "group-branch";
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
    if (response.status === 409) throw new Error("The server refused this action in the current show state.");
    if (response.status === 502) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? `Request failed (${response.status})`);
    }
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
      <h2 id={titleId}>{isRestart ? "Restart the show?" : isReunion ? "Bring all groups to reunion?" : "Return the show to idle?"}</h2>
      <p id={descriptionId}>{isRestart
        ? "This creates a new session and returns the running show to its entry phase."
        : isReunion
          ? "This ends every still-running group's current scene early and moves everyone to the shared reunion scene, even groups that aren't ready."
          : "This stops the current show and returns connected installation screens to idle."}</p>
      <div className="sc-tool-dialog-actions">
        <button ref={cancelRef} className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={onCancel}>{isReunion ? "Let groups keep running" : "Keep current show"}</button>
        <button className="sc-tool-button" data-sc-tool-variant="danger" type="button" onClick={onConfirm}>{isRestart ? "Restart show" : isReunion ? "Bring all to reunion" : "Return to idle"}</button>
      </div>
    </div>
  </div>;
}

function JumpConfirmationDialog({ scene, scope, onCancel, onConfirm }: { scene: FlowScene; scope: string; onCancel: () => void; onConfirm: () => void }) {
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
      <p id={descriptionId}>{scope}: this immediately leaves the current scene, clears its in-progress vote or playback state, and starts <span className="sc-tool-mono">{scene.id}</span>.</p>
      <div className="sc-tool-dialog-actions">
        <button ref={cancelRef} className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={onCancel}>Keep current scene</button>
        <button className="sc-tool-button" data-sc-tool-variant="primary" type="button" onClick={onConfirm}>Jump to scene</button>
      </div>
    </div>
  </div>;
}

function sceneKindLabel(kind: FlowScene["kind"]): string {
  return kind === "video" ? "Media"
    : kind === "position-question" ? "Question"
      : kind === "group-branch" ? "Group branch"
        : "Media + vote";
}

export function App() {
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
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [flow, setFlow] = useState<SceneFlow | null>(null);
  const [jumpScope, setJumpScope] = useState<{ groupId?: string; label: string; epoch: number | null; sessionId: string | null; phaseId: string | null }>({ label: "Whole show", epoch: null, sessionId: null, phaseId: null });
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
  const [soundcheckSource, setSoundcheckSource] = useState("");
  const [soundcheckTarget, setSoundcheckTarget] = useState("");
  const [soundchecking, setSoundchecking] = useState(false);
  const [localBridgeUrl, setLocalBridgeUrl] = useState("");
  const [localBridgeToken, setLocalBridgeToken] = useState("");
  const [localPublicUrl, setLocalPublicUrl] = useState("");
  const [localNetworkLabel, setLocalNetworkLabel] = useState("");
  const [musicSource, setMusicSource] = useState("");
  const [musicVolume, setMusicVolume] = useState(20);
  const [settingMusic, setSettingMusic] = useState(false);
  const setBackgroundMusic = async (stop = false) => {
    setSettingMusic(true);
    try {
      const response = await api("audio/music", connectedToken, {
        method: "POST", body: JSON.stringify({ src: stop ? null : musicSource, volume: musicVolume / 100 }),
      });
      if (!response.ok) throw new Error(await response.text());
      await refresh();
      setFeedback({ status: "success", message: stop ? "Background music stopped." : "Background music started on all streams." });
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "Could not change music." });
    } finally { setSettingMusic(false); }
  };
  const [switchingAudioBackend, setSwitchingAudioBackend] = useState(false);
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
      const response = await api("status", connectedToken, { signal: abort.signal });
      const nextStatus = await response.json() as Status;
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

  const soundcheck = async (action: "play" | "stop") => {
    setSoundchecking(true);
    setFeedback(null);
    try {
      const response = await api("audio/soundcheck", connectedToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action === "play" ? { src: soundcheckSource } : {}), ...(soundcheckTarget ? { participantId: soundcheckTarget } : {}) }),
      });
      const result = await response.json() as { affected: number };
      setFeedback({ status: "success", message: `${action === "play" ? "Soundcheck started on" : "Audio stopped on"} ${result.affected} phone${result.affected === 1 ? "" : "s"}.` });
      await refresh();
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "Soundcheck failed." });
    } finally {
      setSoundchecking(false);
    }
  };

  const switchAudioBackend = async (mode: "remote" | "local") => {
    setSwitchingAudioBackend(true);
    setFeedback(null);
    try {
      const response = await api("audio/bridge", connectedToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "remote" ? { mode } : {
          mode, url: localBridgeUrl, token: localBridgeToken, publicUrl: localPublicUrl, label: localNetworkLabel,
        }),
      });
      const result = await response.json() as { backend: string; label?: string };
      setFeedback({ status: "success", message: mode === "remote" ? "Switched back to the remote audio backend." : `Switched to local audio backend “${result.label}”.` });
      await refresh();
    } catch (error) {
      setFeedback({ status: "danger", message: error instanceof Error ? error.message : "Could not switch the audio backend." });
    } finally {
      setSwitchingAudioBackend(false);
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
  const startGroupPaths = async () => {
    setWorkingAction("start-group-paths");
    setFeedback(null);
    try {
      await api("groups/start-paths", connectedToken, { method: "POST" });
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
      await api("groups/reunion", connectedToken, { method: "POST" });
      setFeedback({ status: "success", message: "All groups brought to reunion." });
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
    void (action === "reunion" ? forceReunion() : control(action)).finally(() => {
      requestAnimationFrame(() => {
        if (confirmTriggerRef.current?.disabled) controlsHeadingRef.current?.focus();
      });
    });
  };
  const requestJump = (scene: FlowScene, trigger: HTMLButtonElement, groupId?: string) => {
    const path = status?.groupPaths.find((p) => p.groupId === groupId);
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
        if (confirmTriggerRef.current?.disabled) flowHeadingRef.current?.focus();
      });
    });
  };

  const isActive = status?.lifecycle === "active";
  const canStart = Boolean(status && !isActive && status.connectedParticipants > 0);
  const canReturnToIdle = Boolean(status?.lifecycle && status.lifecycle !== "idle");
  const busy = workingAction !== null;
  const currentScene = status ? flow?.scenes.find((scene) => scene.id === status.phaseId) : undefined;
  const inGroupBranch = currentScene?.kind === "group-branch";
  const sceneTitle = (id: string): string => id === "idle" ? "End" : flow?.scenes.find((scene) => scene.id === id)?.title ?? id;
  const skipLabel = currentScene?.kind === "video" && currentScene.routes[0] ? `Next scene → ${sceneTitle(currentScene.routes[0].target)}` : "Skip current phase";
  const playbackStatus: ToolStatus = status?.displayPlaybackIssue?.status === "stalled" ? "warning" : status?.displayPlaybackIssue ? "danger" : "success";
  const globalStatus: ToolStatus = status ? (statusStale || !status.healthy || !status.ready ? "warning" : status.displayPlaybackIssue ? playbackStatus : "success") : connectionError ? "danger" : "info";
  const globalLabel = status ? (statusStale ? "Status stale" : !status.healthy || !status.ready ? "System not ready" : status.displayPlaybackIssue ? "Playback issue" : "System ready") : refreshing ? "Connecting" : connectionError ? "Connection failed" : "Not connected";

  return <div data-sc-tool-density="standard" data-sc-tool-root>
    <main className="admin-app">
      <header className="admin-header">
        <div><p className="sc-tool-eyebrow">Live installation / operator console</p><h1>{audioOnly ? "Audio diagnostics" : "Operations"}</h1></div>
        {audioOnly ? <a href="/admin/">Back to operations</a> : <StatusLabel status={globalStatus}>{globalLabel}</StatusLabel>}
      </header>

      {!audioOnly && <RunOfShowPanel />}

      <section className="sc-tool-panel admin-connection" aria-labelledby="admin-connection-heading">
        <div className="admin-section-heading">
          <div><p className="sc-tool-eyebrow">Secure access</p><h2 id="admin-connection-heading">Admin connection</h2></div>
          {status && <StatusLabel status={statusStale ? "warning" : "success"}>{statusStale ? "Last status received" : "Authenticated"}</StatusLabel>}
        </div>
        {(!audioOnly || !status || connectionError) && <form className="admin-connection-form" onSubmit={(event) => void connect(event)}>
          <label className="sc-tool-label" htmlFor="admin-email">Operator email
            <input id="admin-email" className="sc-tool-field" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="sc-tool-label" htmlFor="admin-password">Password
            <input id="admin-password" className="sc-tool-field sc-tool-mono" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby="admin-token-help" />
          </label>
          <button className="sc-tool-button" data-sc-tool-variant="primary" type="submit" disabled={refreshing || signingIn}>{status ? "Reconnect" : signingIn ? "Signing in…" : refreshing ? "Connecting…" : "Sign in"}</button>
        </form>}
        <p id="admin-token-help" className="sc-tool-help">Stays signed in on this device for 30 days. Connected sessions refresh every 2 seconds.</p>
        {connectionError && <p className="sc-tool-feedback admin-feedback" data-sc-tool-status={statusStale ? "warning" : "danger"} role="alert"><StatusIcon status={statusStale ? "warning" : "danger"} /><span>{connectionError}{statusStale ? " Showing the last received status." : ""}</span></p>}
      </section>
      {!audioOnly && status && <DisplaySettingsPanel key={connectedToken} token={connectedToken} />}


      {feedback && <div className="sc-tool-feedback admin-page-feedback" data-sc-tool-status={feedback.status} role={feedback.status === "danger" ? "alert" : "status"}><StatusIcon status={feedback.status} /><span>{feedback.message}</span></div>}

      {!status ? <section className="sc-tool-panel admin-empty-state" aria-live="polite">
        <p className="sc-tool-eyebrow">Operational data</p>
        <h2>{refreshing ? "Loading live status…" : "Connect to load live status"}</h2>
        <p className="sc-tool-copy">No operational values are shown until the admin API authenticates this browser session.</p>
      </section> : <div className="admin-grid">
        <section className="sc-tool-panel admin-flow-panel" aria-labelledby="admin-flow-heading">
          <div className="admin-section-heading">
            <div><p className="sc-tool-eyebrow">Live show navigation</p><h2 ref={flowHeadingRef} id="admin-flow-heading" tabIndex={-1}>Scene navigator</h2></div>
            <StatusLabel status={isActive && !status.groupPathsStarted ? "success" : "info"}>{status.groupPathsStarted ? "Groups running" : isActive ? "Jump enabled" : "Available during show"}</StatusLabel>
          </div>
          <p className="sc-tool-copy admin-flow-intro">The published show graph with live group locations. Select a scene to inspect its participants or move a group.</p>
          {flow?.scenes.length ? <LiveGraph flow={flow} status={status} busy={busy} onJump={requestJump} onAssign={assignGroup} /> : <p className="sc-tool-copy">No scene graph is available from the running show.</p>}
        </section>
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
            <div><button className="sc-tool-button" data-sc-tool-variant={isActive ? "secondary" : "primary"} type="button" disabled={!canStart || busy} onClick={() => void control("start")}>Start show</button><span>{isActive ? "Unavailable while active" : status.connectedParticipants < 1 ? "A participant must be connected" : "Begin a new live session"}</span></div>
            {inGroupBranch ? (status.groupPathsStarted ? <>
              {status.groupPaths.map((path) => <div key={path.groupId}>
                <button className="sc-tool-button" data-sc-tool-variant={path.done ? "secondary" : "primary"} type="button" disabled={path.done || path.acceptingParticipants === false || busy} onClick={() => void skipPhase(path.groupId, path.label)}>
                  {path.done ? `${path.label} — waiting` : `Next scene for ${path.label} — ${path.memberIds.length} ${path.memberIds.length === 1 ? "person" : "people"}`}
                </button>
                <span>{path.done ? "At the reunion point, waiting on the other groups" : `Currently on “${path.phaseTitle}”`}</span>
              </div>)}
              <div><button className="sc-tool-button" data-sc-tool-variant="danger" type="button" disabled={busy} onClick={(event) => requestConfirmation("reunion", event.currentTarget)}>Bring all groups to reunion</button><span>Explicitly ends unfinished branches, with confirmation</span></div>
            </> : <div><button className="sc-tool-button" data-sc-tool-variant="primary" type="button" disabled={!isActive || busy} onClick={() => void startGroupPaths()}>Start group paths</button><span>Finishes assignment and begins the branches</span></div>)
              : <div><button className="sc-tool-button" data-sc-tool-variant={isActive ? "primary" : "secondary"} type="button" disabled={!isActive || busy} onClick={() => void skipPhase()}>{skipLabel}</button><span>{isActive ? "Server validates phase support" : "Available during an active show"}</span></div>}
            <div><button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={!isActive || busy} onClick={(event) => requestConfirmation("restart", event.currentTarget)}>Restart show</button><span>Create a new session from the entry phase</span></div>
            <div><button className="sc-tool-button" data-sc-tool-variant="danger" type="button" disabled={!canReturnToIdle || busy} onClick={(event) => requestConfirmation("idle", event.currentTarget)}>Return to idle</button><span>Stop the current show</span></div>
          </div>
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
        </section>

        <section className="sc-tool-panel" aria-label="Headphone streams">
          <h2>Headphone streams</h2>
          <p><a href="/admin/?view=audio">Open live audio diagnostics →</a></p>
          {!status.audio?.configured ? <p>Audio bridge is not configured.</p> : <>
            <p>Active backend: <strong>{status.audio.backend === "local" ? status.audio.backendLabel ?? "Local" : "Remote"}</strong></p>
            {status.audio.error && <p role="alert">{status.audio.error}</p>}
            {Object.keys(status.audio.deliveryFailures ?? {}).length > 0 && <p role="alert">
              Narration delivery failed for {Object.keys(status.audio.deliveryFailures ?? {}).join(", ")}. Retrying automatically; hold the show until resolved.
            </p>}
            {status.audio.poll_age_s == null || status.audio.poll_age_s > 15 ? <p role="alert">Listener status is unavailable or stale.</p> : null}
            <p>A stream connection does not confirm audible playback. Phone reports can be delayed while the screen is locked.</p>
            <ul className="admin-participant-list">{status.audio.players.map((player) => <li key={player.player_id}>
              <strong>{player.name ?? player.player_id}</strong>
              <span>{player.connected ? `${player.listeners} stream connection(s)` : player.flagged ? "No listener — check headphones" : "Waiting for listener"}</span>
              {player.reconnects !== undefined && <span>
                Last phone report: {player.playbackState === "reconnecting" ? "audio interrupted, recovering" : player.playbackState}
                {" · "}{player.reconnects} interruption{player.reconnects === 1 ? "" : "s"}
                {player.lastRecoveryMs != null && ` · last recovery ${(player.lastRecoveryMs / 1000).toFixed(1)}s`}
              </span>}
            </li>)}</ul>
            <div className="admin-connection-form" aria-label="Background music">
              <h3>Background music</h3>
              <p>Loops underneath narration on all phone streams, including phones joining later.</p>
              <p>{status.audio.backgroundMusic ? `Selected: ${status.audio.backgroundMusic.src} (${Math.round(status.audio.backgroundMusic.volume * 100)}%)` : "Music stopped"}</p>
              <label>Music track<select className="sc-tool-field" value={musicSource} onChange={(event) => setMusicSource(event.target.value)}>
                <option value="">Choose published MP3…</option>
                {(status.audio.soundcheckSources ?? []).map((src) => <option key={src} value={src}>{src}</option>)}
              </select></label>
              <label>Music volume: {musicVolume}%<input type="range" min="0" max="100" value={musicVolume} onChange={(event) => setMusicVolume(Number(event.target.value))} /></label>
              <button className="sc-tool-button" type="button" disabled={settingMusic || !musicSource} onClick={() => void setBackgroundMusic()}>Play / apply music</button>
              <button className="sc-tool-button" type="button" disabled={settingMusic} onClick={() => void setBackgroundMusic(true)}>Stop music</button>
              <p className="sc-tool-help">Publish music as MP3 media in the active show. Stream buffering delays audible changes by a few seconds.</p>
            </div>
            <div className="admin-connection-form" aria-label="Phone audio soundcheck">
              <label className="sc-tool-label"><span>Test MP3</span><select className="sc-tool-select" value={soundcheckSource} onChange={(event) => setSoundcheckSource(event.target.value)}>
                <option value="">Choose authored audio…</option>
                {(status.audio.soundcheckSources ?? []).map((src) => <option key={src} value={src}>{src}</option>)}
              </select></label>
              <label className="sc-tool-label"><span>Send to</span><select className="sc-tool-select" value={soundcheckTarget} onChange={(event) => setSoundcheckTarget(event.target.value)}>
                <option value="">All registered phones</option>
                {status.audio.players.map((player) => <option key={player.player_id} value={player.player_id}>{player.name ?? player.player_id}</option>)}
              </select></label>
              <div className="admin-control-list">
                <div><button className="sc-tool-button" data-sc-tool-variant="primary" type="button" disabled={soundchecking || !soundcheckSource || isActive} onClick={() => void soundcheck("play")}>Play on phone</button><span>{isActive ? "Disabled while a show is active" : "Interrupts current phone audio"}</span></div>
                <div><button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={soundchecking || isActive} onClick={() => void soundcheck("stop")}>Stop phone audio</button><span>Resets the selected phone stream</span></div>
              </div>
              {(status.audio.soundcheckSources?.length ?? 0) === 0 && <p className="sc-tool-help">No MP3 files are present in the active show’s published media manifest.</p>}
            </div>
            <div className="admin-audio-backend-form" aria-label="Local audio backend">
              <p className="sc-tool-help">If Icecast/Liquidsoap feels laggy over the network, start the local rig (<code>services/audio</code>, <code>make up</code>) on this or another machine on the venue LAN, then switch to it here. One machine, two addresses below: this server reaches it one way, audience phones reach it another. If this server is remote, those are almost always <em>different</em> URLs, even though both point at the same box.</p>
              <div className="admin-audio-backend-fields">
                <label className="sc-tool-label">
                  <span>Control URL — reached by this server</span>
                  <input className="sc-tool-field sc-tool-mono" type="text" placeholder="e.g. http://100.x.y.z:8300 (Tailscale) if this server is remote" value={localBridgeUrl} onChange={(event) => setLocalBridgeUrl(event.target.value)} />
                  <span className="sc-tool-help">Wherever this process actually runs. A private LAN IP only works here if this server is also on that LAN.</span>
                </label>
                <label className="sc-tool-label"><span>Bridge token</span><input className="sc-tool-field sc-tool-mono" type="password" value={localBridgeToken} onChange={(event) => setLocalBridgeToken(event.target.value)} /></label>
                <label className="sc-tool-label">
                  <span>Stream URL — reached by audience phones</span>
                  <input className="sc-tool-field sc-tool-mono" type="text" placeholder="e.g. http://192.168.1.42:8300 (venue LAN)" value={localPublicUrl} onChange={(event) => setLocalPublicUrl(event.target.value)} />
                  <span className="sc-tool-help">Usually the bridge machine's plain venue-LAN address — not a VPN/tailnet address, phones aren't on that network.</span>
                </label>
                <label className="sc-tool-label"><span>Network label</span><input className="sc-tool-field sc-tool-mono" type="text" placeholder="e.g. Stage-LAN (5GHz)" value={localNetworkLabel} onChange={(event) => setLocalNetworkLabel(event.target.value)} /></label>
              </div>
              {localBridgeUrl && localPublicUrl && localBridgeUrl === localPublicUrl && <p className="sc-tool-validation" role="alert">Control URL and Stream URL are identical. That's only correct if this server and audience phones are on the exact same network — if this server runs remotely, double-check you haven't pasted the same address into both.</p>}
              <div className="admin-control-list">
                <div><button className="sc-tool-button" data-sc-tool-variant="primary" type="button" disabled={switchingAudioBackend || !localBridgeUrl || !localBridgeToken || !localPublicUrl || !localNetworkLabel} onClick={() => void switchAudioBackend("local")}>Test &amp; switch to local</button><span>Health-checks the control URL first; nothing changes if it fails. Does not confirm phones can reach the stream URL.</span></div>
                {status.audio.backend === "local" && <div><button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={switchingAudioBackend} onClick={() => void switchAudioBackend("remote")}>Switch back to remote</button><span>Returns to the deployment's default backend</span></div>}
              </div>
            </div>
          </>}
        </section>
        <section className="sc-tool-panel" aria-labelledby="admin-participants-heading">
          <div className="admin-section-heading">
            <div><p className="sc-tool-eyebrow">Who has joined</p><h2 id="admin-participants-heading">Participants</h2></div>
            <span className="sc-tool-mono admin-section-count">{status.connectedParticipants} connected</span>
          </div>
          {status.participants.length === 0 ? <p className="sc-tool-copy">Nobody has joined this session yet.</p> : <ul className="admin-participant-list">
            {status.participants.map((participant) => <li key={participant.clientId}>
              <span className="admin-participant-color" style={{ backgroundColor: participant.color }} />
              <div><strong>{participant.name}</strong><span>{(() => { const path = status.groupPaths.find((p) => p.memberIds.includes(participant.clientId)); return path ? `${path.label} · ${path.done ? "Waiting at reunion" : path.phaseTitle}` : status.groupPathsStarted ? "Waiting / needs assignment" : sceneTitle(status.phaseId ?? "idle"); })()}</span><span>joined {new Date(participant.joinedAt).toLocaleTimeString([], { timeStyle: "short" })}</span>
                {(status.groups?.length ?? 0) > 0 && <label className="sc-tool-label"><span>{status.groupPathsStarted ? "Move to group · current playback position" : "Audience group"}</span><select disabled={busy} className="sc-tool-select" value={status.groupPathsStarted ? status.groupPaths.find((p) => p.memberIds.includes(participant.clientId))?.groupId ?? "" : participant.groupId ?? ""} onChange={(event) => void assignGroup(participant.clientId, event.target.value)}>
                  <option value="" disabled>Unassigned</option>
                  {status.groups!.map((group) => <option key={group.id} value={group.id} disabled={status.groupPathsStarted && !status.groupPaths.some((path) => path.groupId === group.id && path.acceptingParticipants !== false)}>{group.label}{status.groupPathsStarted && !status.groupPaths.some((path) => path.groupId === group.id && path.acceptingParticipants !== false) ? " · not running" : ""}</option>)}
                </select></label>}
              </div>
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
          <p className="sc-tool-help">Applies automatically; while a show is running, the change waits until that show ends.</p>
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
          <p className="sc-tool-help">Live + replayed past-participant cursors are topped up to this count on display. 0 disables ghosts and defers to whatever the published show sets. While a show is running, the change waits until that show ends.</p>
        </section>



      </div>}
    </main>
    {confirmAction && <ConfirmationDialog action={confirmAction} onCancel={closeConfirmation} onConfirm={confirmControl} />}
    {jumpScene && <JumpConfirmationDialog scene={jumpScene} scope={jumpScope.label} onCancel={closeJumpConfirmation} onConfirm={confirmJump} />}
  </div>;
}
