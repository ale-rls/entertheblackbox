import AudioScheduler from '@entertheblackbox/expo-audio-scheduler';
import { ParticipantTaskCard, taskAlert, type ParticipantTaskState } from './ParticipantTaskCard';
import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import { z } from 'zod';
import { serverOrigin, type ShowChannel, type ShowManifest } from '@entertheblackbox/show-content';
import { PROTOCOL_VERSION, type ServerToClientMessage, type SurfaceMessage, type WallMessage } from '@entertheblackbox/protocol';
import { NativeConnection } from './connection';
import { acceptsSnapshot, cueForPlayback, type Snapshot } from './cues';
import { downloadShow, downloadWallSlice, loadShow } from './content';
import { ShowPlayer } from './player';
import { StageCompanion } from './StageCompanion';
import { PlaybackActivity, stageState } from './stage-state';
import { actionPrompt } from './action-prompt';
import { createActionAlerts, enableActionNotifications } from './notifications';
import { createForegroundAttention } from './foreground-attention';
import { applySurface, expireSurface, initialSurface, surfaceDelay, visibleSurface } from './surface';
import { acceptWall, wallStatus, type WallPlayback, type WallSliceState } from './wall';
import { WallVideo } from './WallVideo';

/** Resend a playing tablet's drift this often, so Admin sees it live. */
const WALL_DRIFT_REPORT_MS = 2_000;

const DEVICE_LABEL_KEY = 'deviceLabel';

const joinConfig = z.object({ installationId: z.string().min(1), roomId: z.string().min(1) });
type Voting = Extract<ServerToClientMessage, { t: 'voting_options' }>;
type Groups = Extract<ServerToClientMessage, { t: 'group_selection_options' }>;
export default function App() {
  const [origin, setOrigin] = useState(process.env.EXPO_PUBLIC_SHOW_SERVER ?? '');
  const channel: ShowChannel = 'production';
  const [surface, setSurface] = useState(initialSurface);
  const [name, setName] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [manifest, setManifest] = useState<ShowManifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Download a show, then join');
  const [audioStatus, setAudioStatus] = useState('Audio not started');
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [voting, setVoting] = useState<Voting | null>(null);
  const [admission, setAdmission] = useState<Extract<ServerToClientMessage, { t: 'admission_state' }> | null>(null);
  const [task, setTaskState] = useState<ParticipantTaskState | null>(null);
  const taskRef = useRef<ParticipantTaskState | null>(null);
  function setTask(value: ParticipantTaskState | null) { taskRef.current = value; setTaskState(value); }
  const [groups, setGroups] = useState<Groups | null>(null);
  const [notificationStatus, setNotificationStatus] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const attention = useRef<ReturnType<typeof createForegroundAttention> | null>(null);
  if (!attention.current) attention.current = createForegroundAttention(() => setNotificationStatus('Could not play the action cue. Follow the on-screen prompt.'));
  const [answered, setAnswered] = useState<string | null>(null);
  const alerts = useRef<ReturnType<typeof createActionAlerts> | null>(null);
  if (!alerts.current) alerts.current = createActionAlerts(() => setNotificationStatus('Could not show an alert. Keep the app open for show actions.'));
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [identity, setIdentity] = useState<{ name: string; color: string } | null>(null);
  const [clockText, setClockText] = useState('');
  const [serverNow, setServerNow] = useState(Date.now());
  const [wall, setWall] = useState<WallMessage | null>(null);
  const [wallSlice, setWallSlice] = useState<WallSliceState>({ state: 'idle' });
  const [wallPlayback, setWallPlayback] = useState<WallPlayback | null>(null);
  const [showMode, setShowMode] = useState(false);
  const joinedOrigin = useRef('');
  const wallReported = useRef({ key: '', at: 0 });
  const connection = useRef<NativeConnection | null>(null);
  const activity = useRef(new PlaybackActivity());
  const player = useRef<ShowPlayer | null>(null);
  const latest = useRef<Snapshot | null>(null);
  const operation = useRef(false);
  const authorized = useRef(false);
  const occupantId = useRef<string | null>(null);
  const surfaceGeneration = useRef(0);
  const surfaceTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  function later(work: () => void, delayMs: number) {
    const generation = surfaceGeneration.current;
    const timer = setTimeout(() => { surfaceTimers.current.delete(timer); if (generation === surfaceGeneration.current) work(); }, delayMs);
    surfaceTimers.current.add(timer);
  }
  function resetSurface() {
    surfaceGeneration.current += 1;
    for (const timer of surfaceTimers.current) clearTimeout(timer);
    surfaceTimers.current.clear();
    setSurface(initialSurface);
  }
  /** Apply on the shared server clock so every tablet switches on the same frame. */
  function scheduleSurface(message: SurfaceMessage, c: NativeConnection) {
    later(() => {
      setSurface(view => applySurface(view, message, Date.now()));
      if (message.mode === 'flash' && message.holdMs !== undefined) later(() => setSurface(view => expireSurface(view, Date.now())), message.holdMs);
    }, surfaceDelay(message.applyAt, c.clock.now(), c.clock.hasSamples));
  }
  useEffect(() => {
    void SecureStore.getItemAsync(DEVICE_LABEL_KEY).then(value => { if (value) setDeviceLabel(value); }).catch(() => { /* Unlabelled until set. */ });
  }, []);
  function saveDeviceLabel(value: string) {
    const label = value.slice(0, 40);
    setDeviceLabel(label);
    void (label.trim() ? SecureStore.setItemAsync(DEVICE_LABEL_KEY, label.trim()) : SecureStore.deleteItemAsync(DEVICE_LABEL_KEY)).catch(() => setError('Could not save the device label'));
  }
  // The person and the tablet are separate: the participant's name, else the tablet's label.
  const joinName = (name.trim() || deviceLabel.trim()).trim();
  const prompt = taskAlert(task, serverNow) ?? actionPrompt(snapshot, voting, groups, serverNow);
  useEffect(() => {
    alerts.current?.update(connected && status === 'Connected' && notificationsEnabled && prompt?.key !== answered ? prompt : null);
  }, [connected, status, notificationsEnabled, prompt?.key, answered]);
  const activePrompt = connected && status === 'Connected' && prompt?.key !== answered ? prompt : null;
  useEffect(() => {
    attention.current?.update(foreground && !paused ? activePrompt : null);
  }, [foreground, paused, activePrompt?.key]);
  useEffect(() => () => { attention.current?.update(null); }, []);
  function acknowledgeAction(kind: 'group' | 'vote' | 'rating') {
    if (!prompt || !(kind === 'rating' ? /:rating:\d+$/.test(prompt.key) : prompt.key.endsWith(`:${kind}`))) return;
    setAnswered(prompt?.key ?? null); alerts.current?.update(null);
  }
  function leave() {
    attention.current?.update(null);
    alerts.current?.update(null); setNotificationsEnabled(false); setAnswered(null);
    connection.current?.stop(); player.current?.dispose(); connection.current = null; player.current = null; resetSurface();
    setWall(null); setWallPlayback(null);
    latest.current = null; occupantId.current = null; authorized.current = false; setSnapshot(null); setAdmission(null); setTask(null); setVoting(null); setGroups(null); setIdentity(null);
    setConnected(false); setPaused(false); setPlaying(false); setError(''); setNotificationStatus(''); setStatus('Disconnected'); setAudioStatus('Audio stopped');
  }
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { setForeground(state === 'active'); if (state === 'active') connection.current?.resume(); });
    const playbackTimer = setInterval(() => {
      const p = player.current;
      const cue = latest.current ? cueForPlayback(latest.current, taskRef.current, connection.current?.clock.now() ?? Date.now()) : null;
      p?.setCue(cue);
      setPlaying(!!p && activity.current.sample(p.timing(), cue?.key ?? null) && !p.isPaused());
    }, 250);
    const timer = setInterval(() => {
      const c = connection.current, s = latest.current, p = player.current;
      if (!c || !p) return;
      setServerNow(c.clock.now());
      const timing = p.timing();
      setPaused(p.isPaused());
      setClockText(`Clock ${timing.calibrated ? 'measured' : 'waiting'} · round trip ${Math.round(timing.roundTripMs ?? 0)} ms · drift ${Math.round(timing.media[0]?.driftMs ?? 0)} ms`);
      if (!s) return;
      c.send({ t: 'ping', v: PROTOCOL_VERSION, clientTime: Date.now(), timing: {
        sessionId: s.sessionId, phaseId: s.phase.id, phaseEpoch: s.phaseEpoch, routingEpoch: s.routingEpoch ?? 0, timing } });
    }, 1000);
    return () => { alerts.current?.update(null); listener.remove(); clearInterval(playbackTimer); clearInterval(timer); connection.current?.stop(); player.current?.dispose(); };
  }, []);
  async function run(work: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { operation.current = false; setBusy(false); }
  }
  async function prepare(download: boolean) {
    const base = serverOrigin(origin);
    setOrigin(base);
    const show = download ? await downloadShow(base, channel, setStatus) : await loadShow(base, channel);
    if (!show) throw new Error('No verified saved show. Download the show first.');
    setManifest(show); setStatus(`Ready: ${show.files.length} audio files verified`);
  }
  async function join() {
    if (connection.current || !joinName) return;
    const base = serverOrigin(origin);
    setStatus('Checking latest published show');
    // Capture this verified release for the whole session, never a stale React state value.
    // Failure deliberately prevents admission; the saved show is not a silent fallback.
    const latestShow = await downloadShow(base, channel, setStatus);
    setManifest(latestShow);
    setStatus(`Latest show ready: ${latestShow.revision.slice(0, 8)}`);
    const response = await fetch(`${base}/api/join-config`);
    if (!response.ok) throw new Error(`Server unavailable (${response.status})`);
    const config = joinConfig.parse(await response.json());
    const leaseKey = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${base}:${config.installationId}`);
    const lease = await SecureStore.getItemAsync(leaseKey);
    try {
      const enabled = await enableActionNotifications();
      setNotificationsEnabled(enabled);
      setNotificationStatus(enabled ? 'Show action notifications enabled' : 'Notifications are off. Enable them in device settings, or keep the app open for show actions.');
    } catch { setNotificationStatus('Notifications unavailable. Keep the app open for show actions.'); }
    await ShowPlayer.configure();
    joinedOrigin.current = base;
    const c = new NativeConnection({
      capabilities: ['participant-tasks-v1', 'participant-task-routing-v1', 'occupant-handover-v1', ...(AudioScheduler.supportsAdmissionPrograms() ? ['admission-programs-v1'] : [])], origin: base, ...config, name: joinName, deviceLabel: deviceLabel.trim() || undefined,
      clientVersion: process.env.EXPO_PUBLIC_SERVER_BUILD_VERSION ?? '0.0.0-dev', lease,
      saveLease: value => { void (value ? SecureStore.setItemAsync(leaseKey, value) : SecureStore.deleteItemAsync(leaseKey)).catch(() => setError('Could not save this device identity')); },
      status: value => { authorized.current = value === 'Connected'; setStatus(value); },
      // The next person on this tablet enters their own name.
      ended: () => { leave(); setName(''); setStatus('Show ended. Join again for the next performance.'); },
      message: message => {
        if (message.t === 'identity') {
          if (occupantId.current !== null && occupantId.current !== message.clientId) {
            latest.current = null; setSnapshot(null); setTask(null); setVoting(null); setGroups(null); setAdmission(null); setAnswered(null);
            alerts.current?.update(null); player.current?.setAdmission(null); player.current?.setCue(null);
          }
          occupantId.current = message.clientId;
          resetSurface(); setIdentity({ name: joinName, color: message.color }); player.current?.startMusic(); }
        if (message.t === 'surface') scheduleSurface(message, c);
        if (message.t === 'wall') setWall(current => acceptWall(current, message));
        if (message.t === 'admission_state') { setAdmission(message); player.current?.setAdmission(message); }
        if (message.t === 'participant_task' && message.sessionId === latest.current?.sessionId) { setTask(message); player.current?.setCue(cueForPlayback(latest.current, message, c.clock.now())); }
        if (message.t === 'reload') setError(`Server requests compatible app content (${message.minVersion}). Leave before checking app updates.`);
        if (message.t === 'join_rejected') { player.current?.setEnabled(false); player.current?.setCue(null); setError(message.reason === 'update_required' ? 'Install the current native app build to join this show.' : `Join rejected: ${message.reason}`); }
        if (message.t === 'snapshot' || message.t === 'phase') {
          if (message.phase.scenarioVersion !== latestShow.scenarioVersion) {
            leave(); setError('The active show changed. Tap Update show & join to download it.'); return;
          }
          if (!acceptsSnapshot(latest.current, message)) return;
          if (latest.current?.sessionId !== message.sessionId) setTask(null);
          latest.current = message; setServerNow(c.clock.now()); setSnapshot(message); setVoting(null); setGroups(null);
          if (message.phase.kind !== 'idle') { setAdmission(null); player.current?.setAdmission(null); }
          player.current?.setCue(cueForPlayback(message, taskRef.current, c.clock.now()));
        }
        if ((message.t === 'voting_options' || message.t === 'group_selection_options') &&
          message.sessionId === latest.current?.sessionId && message.phaseEpoch === latest.current?.phaseEpoch) {
          if (message.t === 'voting_options') setVoting(message); else setGroups(message);
        }
      },
    });
    player.current = new ShowPlayer(latestShow, c.clock, setAudioStatus);
    connection.current = c; setConnected(true); c.start();
  }
  async function updateApp() {
    if (connection.current) return;
    if (!Updates.isEnabled) throw new Error('EAS updates are available in a configured preview or production build.');
    setStatus('Checking app update');
    const update = await Updates.checkForUpdateAsync();
    if (!update.isAvailable) { setStatus('App is up to date'); return; }
    setStatus('Downloading app update');
    await Updates.fetchUpdateAsync(); setStatus('Restarting app'); await Updates.reloadAsync();
  }
  function vote(outcome: string) {
    const s = latest.current;
    if (s && authorized.current && view.canAct && view.voting?.method === 'phone-buttons' && !view.voting.closed) { acknowledgeAction('vote'); connection.current?.send({ t: 'button_vote', v: PROTOCOL_VERSION, sessionId: s.sessionId, phaseEpoch: s.phaseEpoch, outcome }); }
  }
  // Video wall: fetch this tablet's slice whenever the loaded clip changes.
  const slice = wall?.clip ?? null;
  useEffect(() => {
    if (!slice) { setWallSlice({ state: 'idle' }); setWallPlayback(null); return; }
    let cancelled = false;
    setWallSlice({ state: 'downloading' }); setWallPlayback(null);
    downloadWallSlice(joinedOrigin.current, slice)
      .then(uri => { if (!cancelled) setWallSlice({ state: 'ready', uri }); })
      .catch((reason: unknown) => { if (!cancelled) setWallSlice({ state: 'error', detail: reason instanceof Error ? reason.message.slice(0, 300) : 'Download failed' }); });
    return () => { cancelled = true; };
  }, [slice?.sha256, slice?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  // Tell the server (and Admin) how this tablet is doing: on every change, and periodically while playing.
  useEffect(() => {
    const report = wallStatus(slice?.id ?? null, wallSlice, showMode, wallPlayback);
    const key = `${report.clip}|${report.state}|${report.detail ?? ''}`;
    const now = Date.now();
    if (key === wallReported.current.key && (report.state !== 'playing' || now - wallReported.current.at < WALL_DRIFT_REPORT_MS)) return;
    wallReported.current = { key, at: now };
    connection.current?.send({ t: 'wall_status', v: PROTOCOL_VERSION, ...report });
  }, [slice?.id, wallSlice, showMode, wallPlayback]); // eslint-disable-line react-hooks/exhaustive-deps
  const wallLayer = wall?.clip && wallSlice.state === 'ready' && wallSlice.uri
    ? <WallVideo key={wallSlice.uri} uri={wallSlice.uri} slot={wall.clip.slot} region={wall.clip.region} rotation={wall.clip.rotation} startAt={wall.startAt} loop={wall.loop}
      serverNow={() => connection.current?.clock.now() ?? Date.now()} onPlayback={setWallPlayback} />
    : null;
  const view = stageState({ connected, busy, status, error, audioStatus, paused, snapshot, voting, groups, now: serverNow });
  return <StageCompanion actionPrompt={activePrompt} admission={admission} onAdmissionGroup={groupId => { if (admission && authorized.current) connection.current?.send({ t: 'admission_choice', v: PROTOCOL_VERSION, generation: admission.generation, groupId }); }} participantTask={<ParticipantTaskCard state={task} now={serverNow} enabled={connected && status === 'Connected'} respond={optionId => { if (task?.task && authorized.current) connection.current?.send({ t: 'participant_task_response', v: PROTOCOL_VERSION, sessionId: task.sessionId, instanceId: task.task.id, optionId }); }} />} taskVisible={!!task?.task && task.task.status !== 'cancelled'} answered={answered} connected={connected} busy={busy} status={status} error={error} audioStatus={audioStatus}
    paused={paused} playing={playing} snapshot={snapshot} voting={voting} groups={groups} now={serverNow}
    surface={visibleSurface(surface)} wall={wallLayer} wallVisible={!!wallLayer && wall?.startAt != null} onShowMode={setShowMode} origin={origin} name={name} deviceLabel={deviceLabel} onDeviceLabel={saveDeviceLabel} manifest={manifest} identity={identity} clockText={clockText}
    notificationStatus={notificationStatus} appChannel={Updates.channel ?? 'development'}
    onOrigin={value => { setOrigin(value); setManifest(null); }}
    onName={setName}
    onPrepare={download => void run(() => prepare(download))} onJoin={() => void run(join)}
    onUpdate={() => void run(updateApp)} onLeave={leave}
    onPause={() => { player.current?.setEnabled(false); setPaused(true); setPlaying(false); }}
    onResume={() => { player.current?.setEnabled(true); setPaused(false); }}
    onVote={vote}
    onGroup={groupId => {
      const s = latest.current;
      if (s && authorized.current && view.canAct) {
        acknowledgeAction('group');
        connection.current?.send({ t: 'group_selection', v: PROTOCOL_VERSION, sessionId: s.sessionId, phaseEpoch: s.phaseEpoch, groupId });
      }
    }}
    onReaction={kind => {
      const s = latest.current;
      if (s && authorized.current && view.ratingOpen) {
        acknowledgeAction('rating');
        connection.current?.send({ t: 'reaction', v: PROTOCOL_VERSION, sessionId: s.sessionId, phaseEpoch: s.phaseEpoch, kind });
      }
    }} />;
}
