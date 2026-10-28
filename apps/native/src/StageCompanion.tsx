import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, AppState, PanResponder, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ShowChannel, ShowManifest } from '@entertheblackbox/show-content';
import type { StageInput } from './stage-state';
import { stageState } from './stage-state';

type Props = StageInput & {
  origin: string; channel: ShowChannel; name: string; manifest: ShowManifest | null;
  identity: { name: string; color: string } | null; clockText: string; playing: boolean;
  notificationStatus: string; appChannel: string;
  onOrigin: (value: string) => void; onChannel: (value: ShowChannel) => void; onName: (value: string) => void;
  onPrepare: (download: boolean) => void; onJoin: () => void; onUpdate: () => void; onLeave: () => void;
  onPause: () => void; onResume: () => void; onVote: (id: string) => void; onGroup: (id: string) => void;
  onReaction: (kind: 'applause' | 'boo') => void; onPoint: (x: number, y: number) => void;
};
function Action({ label, onPress, disabled = false, primary = false, selected = false }: {
  label: string; onPress: () => void; disabled?: boolean; primary?: boolean; selected?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, primary && styles.primary, selected && styles.selected, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
    <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
  </Pressable>;
}
/** Abstract artwork, intentionally replaceable without changing the screen layout. */
function HeaderArt() {
  return <View accessible accessibilityLabel="Stage companion" style={styles.art}>
    {Array.from({ length: 9 }, (_, i) => <View key={i} style={[styles.artLine, { height: 16 + (4 - Math.abs(4 - i)) * 6, opacity: .25 + (4 - Math.abs(4 - i)) * .16 }]} />)}
  </View>;
}
/** Playback activity, not an amplitude meter. Stops offscreen, when paused, and for reduced motion. */
function AudioField({ playing, compact }: { playing: boolean; compact: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const app = AppState.addEventListener('change', value => setForeground(value === 'active'));
    return () => { mounted = false; motion.remove(); app.remove(); };
  }, []);
  useEffect(() => {
    if (!playing || reduceMotion || !foreground) { pulse.setValue(0); return; }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1300, useNativeDriver: true }),
    ]));
    animation.start(); return () => animation.stop();
  }, [playing, reduceMotion, foreground, pulse]);
  if (!playing) return null;
  return <View accessible accessibilityLabel="Audio playback active" pointerEvents="none" style={[styles.audio, compact && styles.audioCompact]}>
    <View style={styles.bars}>{Array.from({ length: 48 }, (_, i) => <Animated.View key={i} style={[styles.bar, {
      height: 12 + Math.abs(Math.sin(i * .71) * Math.cos(i * .19)) * (compact ? 42 : 130),
      transform: [{ scaleY: pulse.interpolate({ inputRange: [0, 1], outputRange: i % 2 ? [.5, 1] : [1, .45] }) }],
    }]} />)}</View>
    {!compact && <Text style={styles.audioLabel}>AUDIO PLAYING</Text>}
  </View>;
}
function CursorPad({ onPoint, disabled, color }: { onPoint: Props['onPoint']; disabled: boolean; color: string }) {
  const [dot, setDot] = useState({ x: .5, y: .5 });
  const size = useRef({ width: 1, height: 1 });
  const current = useRef({ onPoint, disabled }); current.current = { onPoint, disabled };
  const move = (x: number, y: number) => {
    if (current.current.disabled) return;
    const point = { x: Math.max(0, Math.min(1, x / size.current.width)), y: Math.max(0, Math.min(1, y / size.current.height)) };
    setDot(point); current.current.onPoint(point.x, point.y);
  };
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !current.current.disabled,
    onMoveShouldSetPanResponder: () => !current.current.disabled,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: e => move(e.nativeEvent.locationX, e.nativeEvent.locationY),
    onPanResponderMove: e => move(e.nativeEvent.locationX, e.nativeEvent.locationY),
  })).current;
  return <View style={styles.pad} onLayout={e => { size.current = e.nativeEvent.layout; }}>
    <View style={styles.touchSurface} {...responder.panHandlers}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: 9 }, (_, i) => <React.Fragment key={i}>
        <View style={[styles.gridVertical, { left: `${(i + 1) * 10}%` }]} />
        <View style={[styles.gridHorizontal, { top: `${(i + 1) * 10}%` }]} />
      </React.Fragment>)}
    </View>
    <Text pointerEvents="none" style={styles.padLabel}>Touch or drag to position your cursor</Text>
    <View pointerEvents="none" style={[styles.dot, { left: `${dot.x * 100}%`, top: `${dot.y * 100}%`, backgroundColor: color }]} />
    </View>
    <View style={styles.accessibleCursor}>
      {(['left', 'right', 'up', 'down'] as const).map(direction => <Pressable key={direction} accessibilityRole="button" accessibilityLabel={`Move cursor ${direction}`}
        disabled={disabled} onPress={() => move((dot.x + (direction === 'left' ? -.05 : direction === 'right' ? .05 : 0)) * size.current.width,
          (dot.y + (direction === 'up' ? -.05 : direction === 'down' ? .05 : 0)) * size.current.height)} style={styles.direction}>
        <Text style={styles.muted}>{{ left: '←', right: '→', up: '↑', down: '↓' }[direction]}</Text>
      </Pressable>)}
    </View>
  </View>;
}
export function StageCompanion(props: Props) {
  const [settings, setSettings] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [reaction, setReaction] = useState('');
  const screen = stageState(props);
  const phase = props.snapshot?.phase;
  useEffect(() => { setSelection(null); setReaction(''); }, [props.snapshot?.sessionId, props.snapshot?.phaseEpoch, props.snapshot?.routingEpoch]);
  useEffect(() => { if (props.connected) setSettings(false); }, [props.connected]);
  const subtitle = phase && 'subtitles' in phase ? phase.subtitles?.filter(s => props.now - phase.startedAt >= s.startAtMs && props.now - phase.startedAt < s.endAtMs).map(s => s.text).join('\n') : '';
  const sceneTitle = phase && 'title' in phase ? phase.title : '';
  const normal = props.connected && props.status === 'Connected' && !props.paused && !screen.title.includes('attention');
  const rejected = props.status.startsWith('Join rejected');
  const hasChoices = !!(screen.groups?.groups.length || screen.voting || screen.ratingOpen || screen.cursorOpen);
  return <SafeAreaView style={styles.screen}>
    <StatusBar barStyle="light-content" backgroundColor="#090a0b" />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
      <View style={styles.header}><HeaderArt /><View style={styles.identity}>
        <Text style={styles.identityName}>{props.identity?.name ?? 'SETUP'}</Text>
        {props.connected && <Text style={styles.muted}>{props.snapshot?.currentGroup?.label ?? 'Waiting for group'}</Text>}
      </View></View>
      {settings ? <View style={styles.inset}>
        <Text accessibilityRole="header" style={styles.title}>Device settings</Text>
        {!props.connected && <>
          <Text style={styles.label}>Venue server</Text>
          <TextInput accessibilityLabel="Venue server" style={styles.input} value={props.origin} autoCapitalize="none" autoCorrect={false} editable={!props.busy}
            placeholder="https://show.example.org" placeholderTextColor="#999fa7" onChangeText={props.onOrigin} />
          <Text style={styles.label}>Show channel</Text>
          <View style={styles.row}>{(['rehearsal', 'production'] as const).map(channel => <Action key={channel} label={channel} selected={props.channel === channel} disabled={props.busy} onPress={() => props.onChannel(channel)} />)}</View>
          <Action label="Download / update show" disabled={props.busy || !props.origin.trim()} onPress={() => props.onPrepare(true)} />
          <Action label="Inspect saved show" disabled={props.busy || !props.origin.trim()} onPress={() => props.onPrepare(false)} />
          <Action label="Check & install app update" disabled={props.busy} onPress={props.onUpdate} />
          <Text style={styles.muted}>App channel: {props.appChannel}. App updates and show downloads are separate.</Text>
        </>}
        <Text style={styles.text}>{props.status}</Text>
        {props.manifest && <Text style={styles.muted}>Show {props.manifest.scenarioVersion} · {props.manifest.files.length} files · {props.manifest.revision.slice(0, 8)}</Text>}
        {props.connected && <><Text style={styles.text}>{props.audioStatus}</Text><Text style={styles.muted}>{props.clockText}</Text></>}
        {!!props.notificationStatus && <Text style={styles.muted}>{props.notificationStatus}</Text>}
        {!!props.error && <Text accessibilityRole="alert" style={styles.error}>{props.error}</Text>}
        <Action label="Back" onPress={() => setSettings(false)} />
      </View> : <>
        <View style={[styles.inset, styles.copy]}>
          <Text accessibilityRole="header" style={styles.title}>{screen.title}</Text>
          {normal && !!sceneTitle && sceneTitle !== screen.title && <Text style={styles.text}>{sceneTitle}</Text>}
          <Text style={styles.text}>{subtitle && normal ? subtitle : screen.body}</Text>
          {(props.busy || (props.connected && props.status !== 'Connected' && !rejected)) && <ActivityIndicator color="#cad3df" accessibilityLabel={props.status} />}
          {!!props.error && <Text accessibilityRole="alert" style={styles.error}>{props.error}</Text>}
          {!!props.notificationStatus && props.notificationStatus !== 'Show action notifications enabled' && <Text style={styles.muted}>{props.notificationStatus}</Text>}
          {!props.connected && !props.busy && props.status !== 'Download a show, then join' && <Text style={styles.muted}>{props.status}</Text>}
        </View>
        <AudioField playing={props.playing && !props.paused && !rejected} compact={hasChoices} />
        {screen.cursorOpen && <CursorPad key={`${props.snapshot?.sessionId}:${props.snapshot?.phaseEpoch}:${props.snapshot?.routingEpoch}`} onPoint={props.onPoint} disabled={!screen.canAct} color={props.identity?.color ?? '#d9e4f1'} />}
        <View style={styles.inset}>
          {!props.connected ? <>
            <Text style={styles.label}>Your name / device label</Text>
            <TextInput accessibilityLabel="Your name or device label" style={styles.input} value={props.name} onChangeText={props.onName} maxLength={40} editable={!props.busy} placeholder="e.g. Alex" placeholderTextColor="#999fa7" />
            {!props.origin.trim() && <Text style={styles.muted}>Set the venue server in Device settings to join.</Text>}
            <Action label={props.error ? 'Try joining again' : 'Prepare & join'} primary disabled={props.busy || !props.origin.trim() || !props.name.trim()} onPress={props.onJoin} />
            <Text style={styles.muted}>Joining checks the latest show and prepares your audio.</Text>
          </> : <>
            {screen.groups?.groups.map(group => <Action key={group.id} label={group.label} selected={screen.groups?.selectedGroupId === group.id} disabled={!screen.canAct} onPress={() => props.onGroup(group.id)} />)}
            {screen.voting?.method === 'phone-buttons' && screen.voting.options.map(option => <Action key={option.id} label={option.label} selected={selection === option.id} disabled={!screen.canAct || screen.voting!.closed}
              onPress={() => { setSelection(option.id); props.onVote(option.id); }} />)}
            {selection && <Text accessibilityLiveRegion="polite" style={styles.muted}>Selected on this device: {screen.voting?.options.find(option => option.id === selection)?.label}</Text>}
            {screen.ratingOpen && <><View style={styles.row}>{(['applause', 'boo'] as const).map(kind => <Action key={kind} label={kind === 'applause' ? 'Applause' : 'Boo'} onPress={() => { props.onReaction(kind); setReaction(kind === 'applause' ? 'Applause sent' : 'Boo sent'); }} />)}</View><Text accessibilityLiveRegion="polite" style={styles.muted}>{reaction}</Text></>}
            {(props.paused || props.audioStatus.startsWith('Playback error')) && !rejected && <Action label="Resume at show position" primary onPress={props.onResume} />}
          </>}
        </View>
      </>}
      {!settings && <View style={styles.footer}>
        {props.connected ? <>
          {!props.paused && !rejected && <Action label="Pause audio" onPress={props.onPause} />}
          <Action label={rejected ? 'Back to setup' : 'Leave show'} onPress={props.onLeave} />
          <Action label="Device details" onPress={() => setSettings(true)} />
        </> : <Action label="Device settings" disabled={props.busy} onPress={() => setSettings(true)} />}
      </View>}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090a0b' }, page: { flexGrow: 1, paddingBottom: 24 },
  header: { padding: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  art: { width: 88, height: 48, flexDirection: 'row', gap: 6, alignItems: 'center', transform: [{ skewX: '-15deg' }] },
  artLine: { width: 2, backgroundColor: '#b9c3d0' }, identity: { flex: 1, alignItems: 'flex-end' }, identityName: { color: '#e4e5e6', fontSize: 12, letterSpacing: 1 },
  inset: { paddingHorizontal: 24, paddingVertical: 16, gap: 14 }, copy: { paddingTop: 32, paddingBottom: 28 },
  title: { color: '#e4e5e6', fontSize: 30, fontWeight: '500', letterSpacing: -.7 }, text: { color: '#bbc0c8', fontSize: 17, lineHeight: 25 },
  muted: { color: '#a3aab5', fontSize: 13, lineHeight: 20 }, label: { color: '#d6dbe3', fontSize: 14 }, error: { color: '#ffb8b0', fontSize: 15, lineHeight: 22 },
  input: { color: '#eef0f3', borderColor: '#3c424b', borderWidth: 1, borderRadius: 8, padding: 14, fontSize: 16, backgroundColor: '#101216' },
  button: { minHeight: 48, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: '#434a55', justifyContent: 'center', flexShrink: 1 },
  buttonText: { color: '#e1e6ed', fontSize: 15, textAlign: 'center' }, primary: { backgroundColor: '#dce2ea', borderColor: '#dce2ea' }, primaryText: { color: '#11151b' },
  selected: { borderColor: '#dce2ea', backgroundColor: '#29323e' }, disabled: { opacity: .45 }, pressed: { opacity: .7 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  footer: { paddingHorizontal: 24, paddingTop: 18, marginTop: 'auto', flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  audio: { height: 240, backgroundColor: '#10151c', justifyContent: 'center', overflow: 'hidden' }, audioCompact: { height: 80 },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 3 }, bar: { flex: 1, backgroundColor: '#8f9fb3', opacity: .65, borderRadius: 2 },
  audioLabel: { position: 'absolute', left: 24, bottom: 18, fontSize: 11, color: '#afbdcf', letterSpacing: 1.4 },
  pad: { height: 300, width: '100%', backgroundColor: '#11161c', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  touchSurface: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  padLabel: { color: '#b6c3d3', fontSize: 13, padding: 24, textAlign: 'center' }, gridVertical: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#202831' },
  gridHorizontal: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#202831' },
  dot: { position: 'absolute', width: 18, height: 18, borderRadius: 9, transform: [{ translateX: -9 }, { translateY: -9 }], borderWidth: 2, borderColor: '#f1f4f8' },
  accessibleCursor: { position: 'absolute', bottom: 0, flexDirection: 'row' }, direction: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
