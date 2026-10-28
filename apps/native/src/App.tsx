import React, { useEffect, useRef, useState } from 'react';
import { AppState, Button, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
  const [identity, setIdentity] = useState<{ name: string; color: string } | null>(null);
  const [clockText, setClockText] = useState('');
  const [serverNow, setServerNow] = useState(Date.now());
  const connection = useRef<NativeConnection | null>(null);
  const player = useRef<ShowPlayer | null>(null);
  const latest = useRef<Snapshot | null>(null);
  const seq = useRef(0);
  const inputTime = useRef(0);
  const pad = useRef({ width: 1, height: 1 });
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
    setConnected(false); setPaused(false); setStatus('Disconnected'); setAudioStatus('Audio stopped');
  }
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state === 'active') connection.current?.resume(); });
    const timer = setInterval(() => {
      const c = connection.current, s = latest.current, p = player.current;
      if (!c || !s || !p) return;
      setServerNow(c.clock.now());
      const timing = p.timing();
      setClockText(`Clock ${timing.calibrated ? 'measured' : 'waiting'} · round trip ${Math.round(timing.roundTripMs ?? 0)} ms · drift ${Math.round(timing.media[0]?.driftMs ?? 0)} ms`);
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
    if (!Updates.isEnabled) throw new Error('EAS updates are available in a configured preview or production build.');
    setStatus('Checking app update');
    const update = await Updates.checkForUpdateAsync();
    if (!update.isAvailable) { setStatus('App is up to date'); return; }
    await Updates.fetchUpdateAsync(); await Updates.reloadAsync();
  }
  function vote(outcome: string) {
    const s = latest.current;
    if (s && authorized.current) { acknowledgeAction('vote'); connection.current?.send({ t: 'button_vote', v: PROTOCOL_VERSION, sessionId: s.sessionId, phaseEpoch: s.phaseEpoch, outcome }); }
  }
  function point(x: number, y: number) {
    const s = latest.current;
    if (!s || !authorized.current || Date.now() - inputTime.current < 50) return;
    acknowledgeAction('vote');
    inputTime.current = Date.now();
    connection.current?.send({ t: 'input', v: PROTOCOL_VERSION, sessionId: s.sessionId, phaseEpoch: s.phaseEpoch, seq: seq.current++,
      x: Math.max(0, Math.min(1, x / pad.current.width)), y: Math.max(0, Math.min(1, y / pad.current.height)) });
  }
  const phase = snapshot?.phase;
  const title = phase && 'title' in phase ? phase.title : null;
  const subtitle = phase && 'subtitles' in phase ? phase.subtitles?.filter(s => serverNow - phase.startedAt >= s.startAtMs && serverNow - phase.startedAt < s.endAtMs).map(s => s.text).join('\n') : null;
  const rating = phase && 'rating' in phase ? phase.rating : null;
  const ratingOpen = rating && (!rating.windows || rating.windows.some(w => serverNow - phase!.startedAt >= w.startAtMs && serverNow - phase!.startedAt < w.endAtMs));
  const cursorOpen = phase && ((phase.kind === 'idle' || phase.kind === 'video') ||
    (voting?.method === 'phone-cursor' && !voting.closed)) && (!('showCursors' in phase) || phase.showCursors !== false);
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.heading}>ENTER THE BLACKBOX</Text>
    <Text style={styles.text}>{status}</Text>
    {!!notificationStatus && <Text style={styles.muted}>{notificationStatus}</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!connected ? <>
      <Text style={styles.label}>Venue server</Text>
      <TextInput accessibilityLabel="Venue server" style={styles.input} value={origin} autoCapitalize="none" autoCorrect={false} editable={!busy}
        placeholder="https://show.example.org" placeholderTextColor="#999" onChangeText={v => { setOrigin(v); setManifest(null); }} />
      <Text style={styles.label}>Show channel: {channel}</Text>
      <View style={styles.row}>{(['rehearsal', 'production'] as const).map(value => <Button key={value} title={value} disabled={busy || value === channel}
        onPress={() => { setChannel(value); setManifest(null); }} />)}</View>
      <Button title="Download / update show" disabled={busy || !origin} onPress={() => void run(() => prepare(true))} />
      <Button title="Inspect saved show" disabled={busy || !origin} onPress={() => void run(() => prepare(false))} />
      {manifest && <Text style={styles.text}>Show {manifest.scenarioVersion} · {manifest.files.length} files · {manifest.revision.slice(0, 8)}</Text>}
      <TextInput accessibilityLabel="Your name or device label" style={styles.input} value={name} onChangeText={setName} maxLength={40} editable={!busy}
        placeholder="Your name / device label" placeholderTextColor="#999" />
      <Button title="Update show & join" disabled={busy || !origin.trim() || !name.trim()} onPress={() => void run(join)} />
      <Text style={styles.muted}>Joining checks the latest published show and downloads missing audio. If the check fails, joining stops. The selected release stays fixed until you leave.</Text>
      <Button title="Check & install app update" disabled={busy} onPress={() => void run(updateApp)} />
      <Text style={styles.muted}>App channel: {Updates.channel ?? 'development'} · App updates and show downloads are separate.</Text>
    </> : <>
      {identity && <Text style={[styles.heading, { color: identity.color }]}>{identity.name}</Text>}
      <Text style={styles.text}>{snapshot?.currentGroup?.label ?? 'Waiting for group'}</Text>
      <Text style={styles.heading}>{subtitle || title || (phase?.kind === 'narration' ? phase.text : '')}</Text>
      <Text style={styles.text}>{audioStatus}</Text><Text style={styles.muted}>{clockText}</Text>
      {groups?.groups.map(group => <Button key={group.id} title={group.label} onPress={() => {
        const s = latest.current; if (s && authorized.current) { acknowledgeAction('group'); connection.current?.send({ t: 'group_selection', v: PROTOCOL_VERSION, sessionId: s.sessionId, phaseEpoch: s.phaseEpoch, groupId: group.id }); }
      }} />)}
      {voting && <Text style={styles.text}>{voting.question}</Text>}
      {voting?.method === 'phone-buttons' && voting.options.map(option => <Button key={option.id} title={option.label} disabled={voting.closed} onPress={() => vote(option.id)} />)}
      {voting?.method === 'physical' && <Text style={styles.text}>Move to your answer in the room.</Text>}
      {cursorOpen && <View style={styles.pad} onLayout={event => { pad.current = event.nativeEvent.layout; }}
        onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
        onResponderGrant={event => point(event.nativeEvent.locationX, event.nativeEvent.locationY)}
        onResponderMove={event => point(event.nativeEvent.locationX, event.nativeEvent.locationY)}>
        <Text style={styles.text}>Touch or drag to position your cursor</Text></View>}
      {!!ratingOpen && <View style={styles.row}>{(['applause', 'boo'] as const).map(kind => <Button key={kind} title={kind} onPress={() => {
        const s = latest.current; if (s && authorized.current) { acknowledgeAction('rating'); connection.current?.send({ t: 'reaction', v: PROTOCOL_VERSION, sessionId: s.sessionId, phaseEpoch: s.phaseEpoch, kind }); }
      }} />)}</View>}
      <Button title="Pause this device" disabled={paused} onPress={() => { player.current?.setEnabled(false); setPaused(true); }} />
      <Button title="Resume at show position" onPress={() => { player.current?.setEnabled(true); setPaused(false); }} />
      <Button title="Leave show" onPress={leave} />
      <Text style={styles.muted}>Downloaded narration and configured background music play locally. Keep the music audible during the show. New live cues need a connection. Locked-screen cue reception must be rehearsed on this device.</Text>
    </>}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#101014' }, content: { padding: 24, gap: 18 },
  heading: { color: '#fff', fontSize: 24, fontWeight: '700' }, text: { color: '#eee', fontSize: 16 },
  muted: { color: '#aaa', fontSize: 13 }, error: { color: '#ff9c9c', fontSize: 16 }, label: { color: '#eee' },
  input: { backgroundColor: '#26262c', color: '#fff', borderRadius: 8, padding: 14, fontSize: 16 },
  row: { flexDirection: 'row', gap: 16 }, pad: { height: 220, backgroundColor: '#30303b', alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
});
