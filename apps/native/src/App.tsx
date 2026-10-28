import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import { z } from 'zod';
import { serverOrigin, type ShowChannel, type ShowManifest } from '@entertheblackbox/show-content';
import { PROTOCOL_VERSION, type ServerToClientMessage } from '@entertheblackbox/protocol';
import { NativeConnection } from './connection';
import { acceptsSnapshot, cueFromSnapshot, type Snapshot } from './cues';
import { downloadShow, loadShow } from './content';
import { ShowPlayer } from './player';
import { StageCompanion } from './StageCompanion';
import { playbackState, stageState } from './stage-state';
import { actionPrompt } from './action-prompt';
import { createActionAlerts, enableActionNotifications } from './notifications';

const joinConfig = z.object({ installationId: z.string().min(1), roomId: z.string().min(1) });
type Voting = Extract<ServerToClientMessage, { t: 'voting_options' }>;
type Groups = Extract<ServerToClientMessage, { t: 'group_selection_options' }>;
export default function App() {
  const [origin, setOrigin] = useState(process.env.EXPO_PUBLIC_SHOW_SERVER ?? '');
  const [channel, setChannel] = useState<ShowChannel>('rehearsal');
  const [name, setName] = useState('');
  const [manifest, setManifest] = useState<ShowManifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Download a show, then join');
  const [audioStatus, setAudioStatus] = useState('Audio not started');
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [voting, setVoting] = useState<Voting | null>(null);
  const [groups, setGroups] = useState<Groups | null>(null);
  const [notificationStatus, setNotificationStatus] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [answered, setAnswered] = useState<string | null>(null);
  const alerts = useRef<ReturnType<typeof createActionAlerts> | null>(null);
  if (!alerts.current) alerts.current = createActionAlerts(() => setNotificationStatus('Could not show an alert. Keep the app open for show actions.'));
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [identity, setIdentity] = useState<{ name: string; color: string } | null>(null);
  const [clockText, setClockText] = useState('');
  const [serverNow, setServerNow] = useState(Date.now());
  const connection = useRef<NativeConnection | null>(null);
  const player = useRef<ShowPlayer | null>(null);
  const latest = useRef<Snapshot | null>(null);
  const seq = useRef(0);
  const inputTime = useRef(0);
  const operation = useRef(false);
  const authorized = useRef(false);
  const prompt = actionPrompt(snapshot, voting, groups, serverNow);
  useEffect(() => {
    alerts.current?.update(connected && status === 'Connected' && notificationsEnabled && prompt?.key !== answered ? prompt : null);
  }, [connected, status, notificationsEnabled, prompt?.key, answered]);
  function acknowledgeAction(kind: 'group' | 'vote' | 'rating') {
    if (!prompt || !(kind === 'rating' ? /:rating:\d+$/.test(prompt.key) : prompt.key.endsWith(`:${kind}`))) return;
    setAnswered(prompt?.key ?? null); alerts.current?.update(null);
  }
  function leave() {
    alerts.current?.update(null); setNotificationsEnabled(false); setAnswered(null);
    connection.current?.stop(); player.current?.dispose(); connection.current = null; player.current = null;
    latest.current = null; authorized.current = false; setSnapshot(null); setVoting(null); setGroups(null); setIdentity(null);
    setConnected(false); setPaused(false); setPlaying(false); setError(''); setNotificationStatus(''); setStatus('Disconnected'); setAudioStatus('Audio stopped');
  }
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state === 'active') connection.current?.resume(); });
    const timer = setInterval(() => {
      const c = connection.current, s = latest.current, p = player.current;
      if (!c || !p) return;
      setServerNow(c.clock.now());
      const timing = p.timing();
      setPlaying(playbackState(timing).playing && !p.isPaused());
      setPaused(p.isPaused());
      setClockText(`Clock ${timing.calibrated ? 'measured' : 'waiting'} · round trip ${Math.round(timing.roundTripMs ?? 0)} ms · drift ${Math.round(timing.media[0]?.driftMs ?? 0)} ms`);
      if (!s) return;
      c.send({ t: 'ping', v: PROTOCOL_VERSION, clientTime: Date.now(), timing: {
        sessionId: s.sessionId, phaseId: s.phase.id, phaseEpoch: s.phaseEpoch, routingEpoch: s.routingEpoch ?? 0, timing } });
    }, 1000);
    return () => { alerts.current?.update(null); listener.remove(); clearInterval(timer); connection.current?.stop(); player.current?.dispose(); };
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
    if (connection.current || !name.trim()) return;
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
    const c = new NativeConnection({ origin: base, ...config, name: name.trim(),
      clientVersion: process.env.EXPO_PUBLIC_SERVER_BUILD_VERSION ?? '0.0.0-dev', lease,
      saveLease: value => { void (value ? SecureStore.setItemAsync(leaseKey, value) : SecureStore.deleteItemAsync(leaseKey)).catch(() => setError('Could not save this device identity')); },
      status: value => { authorized.current = value === 'Connected'; setStatus(value); },
      ended: () => { leave(); setStatus('Show ended. Join again for the next performance.'); },
      message: message => {
        if (message.t === 'identity') { setIdentity({ name: name.trim(), color: message.color }); player.current?.startMusic(); }
        if (message.t === 'reload') setError(`Server requests compatible app content (${message.minVersion}). Leave before checking app updates.`);
        if (message.t === 'join_rejected') { player.current?.setEnabled(false); player.current?.setCue(null); setError(`Join rejected: ${message.reason}`); }
        if (message.t === 'snapshot' || message.t === 'phase') {
          if (!acceptsSnapshot(latest.current, message)) return;
          latest.current = message; setServerNow(c.clock.now()); setSnapshot(message); setVoting(null); setGroups(null);
          player.current?.setCue(cueFromSnapshot(message));
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
  function point(x: number, y: number) {
    const s = latest.current;
    if (!s || !authorized.current || !view.cursorOpen || Date.now() - inputTime.current < 50) return;
    acknowledgeAction('vote');
    inputTime.current = Date.now();
    connection.current?.send({ t: 'input', v: PROTOCOL_VERSION, sessionId: s.sessionId, phaseEpoch: s.phaseEpoch, seq: seq.current++,
      x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) });
  }
  const view = stageState({ connected, busy, status, error, audioStatus, paused, snapshot, voting, groups, now: serverNow });
  return <StageCompanion connected={connected} busy={busy} status={status} error={error} audioStatus={audioStatus}
    paused={paused} playing={playing} snapshot={snapshot} voting={voting} groups={groups} now={serverNow}
    origin={origin} channel={channel} name={name} manifest={manifest} identity={identity} clockText={clockText}
    notificationStatus={notificationStatus} appChannel={Updates.channel ?? 'development'}
    onOrigin={value => { setOrigin(value); setManifest(null); }}
    onChannel={value => { setChannel(value); setManifest(null); }} onName={setName}
    onPrepare={download => void run(() => prepare(download))} onJoin={() => void run(join)}
    onUpdate={() => void run(updateApp)} onLeave={leave}
    onPause={() => { player.current?.setEnabled(false); setPaused(true); setPlaying(false); }}
    onResume={() => { player.current?.setEnabled(true); setPaused(false); }}
    onVote={vote} onPoint={point}
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
