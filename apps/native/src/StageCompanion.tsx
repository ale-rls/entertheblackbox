import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, BackHandler, Platform, Animated, AppState, PanResponder, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { ShowScreen } from '@entertheblackbox/expo-audio-scheduler';
import type { ShowManifest } from '@entertheblackbox/show-content';
import type { StageInput } from './stage-state';
import { stageState, showModeAction, showModeTextVisible, SHOW_TEXT_IDLE_MS } from './stage-state';
import { contrastText } from './surface';

type Props = StageInput & {
  answered: string | null;
  origin: string; surface: { color: string; label?: string }; name: string; deviceLabel: string; manifest: ShowManifest | null;
  identity: { name: string; color: string } | null; clockText: string; playing: boolean;
  notificationStatus: string; appChannel: string;
  onOrigin: (value: string) => void; onName: (value: string) => void; onDeviceLabel: (value: string) => void;
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
  const [showMode, setShowMode] = useState(false);
  const [modeError, setModeError] = useState('');
  const [pinScreen, setPinScreen] = useState(false);
  const modeBusy = useRef(false);
  const mounted = useRef(true);
  const connected = useRef(props.connected);
  connected.current = props.connected;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  async function enterShowMode() {
    if (modeBusy.current || !ShowScreen) return;
    modeBusy.current = true;
    setModeError('');
    try {
      await ShowScreen.setActive(true);
      if (!mounted.current || !connected.current) {
        await ShowScreen.setActive(false);
        return;
      }
      setShowMode(true);
      if (pinScreen && Platform.OS === 'android') {
        try { await ShowScreen.pin(); }
        catch { setModeError('Screen pinning unavailable. Hold Exit show mode to return to device controls.'); }
      }
    } catch { setModeError('Could not keep the screen awake. Try entering show mode again.'); }
    finally { modeBusy.current = false; }
  }
  useEffect(() => {
    if (!showMode) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => {
      back.remove();
      void ShowScreen?.setActive(false).catch(() => setModeError('Could not release screen pinning. Use Android’s unpin gesture.'));
    };
  }, [showMode]);
  useEffect(() => { if (!props.connected) setShowMode(false); }, [props.connected]);
  const [settings, setSettings] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [reaction, setReaction] = useState('');
  const screen = stageState(props);
  useEffect(() => { setSelection(null); setReaction(''); }, [props.snapshot?.sessionId, props.snapshot?.phaseEpoch, props.snapshot?.routingEpoch]);
  useEffect(() => { if (props.connected) setSettings(false); }, [props.connected]);
  const normal = props.connected && props.status === 'Connected' && !props.paused && !screen.title.includes('attention');
  const rejected = props.status.startsWith('Join rejected');
  const hasChoices = !!(screen.groups?.groups.length || screen.voting || screen.ratingOpen || screen.cursorOpen);
  const needsAction = showModeAction(props, props.answered);
  const problem = !normal || !!props.error || !!modeError;
  const reveal = !showMode || needsAction || problem;
  // Show-mode text fades after a few idle seconds; any touch brings it back.
  const [lastTouch, setLastTouch] = useState(Date.now());
  const [idle, setIdle] = useState(false);
  const textOpacity = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => motion.remove();
  }, []);
  useEffect(() => {
    setIdle(false);
    if (!showMode) return;
    const timer = setTimeout(() => setIdle(true), SHOW_TEXT_IDLE_MS);
    return () => clearTimeout(timer);
  }, [showMode, lastTouch]);
  const textVisible = showModeTextVisible({ showMode, needsAction, problem, idleMs: idle ? SHOW_TEXT_IDLE_MS : 0 });
  useEffect(() => {
    if (reduceMotion) { textOpacity.setValue(textVisible ? 1 : 0); return; }
    const animation = Animated.timing(textOpacity, { toValue: textVisible ? 1 : 0, duration: textVisible ? 200 : 800, useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [textVisible, reduceMotion, textOpacity]);
  const surfaceText = contrastText(props.surface.color);
  return <SafeAreaView style={[styles.screen, showMode && { backgroundColor: props.surface.color }]}
    onStartShouldSetResponderCapture={() => { if (showMode) setLastTouch(Date.now()); return false; }}>
    <StatusBar hidden={showMode} barStyle="light-content" backgroundColor="#090a0b" />
    <ScrollView key={showMode ? 'show' : 'controls'} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
      {!showMode && <View style={styles.header}><View style={styles.identity}>
        <Text style={styles.identityName}>{props.identity?.name ?? 'SETUP'}</Text>
        {props.connected && <Text style={styles.muted}>{props.snapshot?.currentGroup?.label ?? 'Waiting for group'}</Text>}
      </View></View>}
      {reveal && <Animated.View style={showMode ? { backgroundColor: '#090a0b', opacity: textOpacity } : undefined}>{settings ? <View style={styles.inset}>
        <Text accessibilityRole="header" style={styles.title}>Device settings</Text>
        {!props.connected && <>
          <Text style={styles.label}>Device label</Text>
          <TextInput accessibilityLabel="Device label" style={styles.input} value={props.deviceLabel} autoCapitalize="characters" autoCorrect={false} maxLength={40} editable={!props.busy}
            placeholder="e.g. T07 — matches the sticker on this tablet" placeholderTextColor="#999fa7" onChangeText={props.onDeviceLabel} />
          <Text style={styles.muted}>Saved on this device and used as its name in the show. Admin sorts and identifies tablets by this label.</Text>
          <Text style={styles.label}>Venue server</Text>
          <TextInput accessibilityLabel="Venue server" style={styles.input} value={props.origin} autoCapitalize="none" autoCorrect={false} editable={!props.busy}
            placeholder="https://show.example.org" placeholderTextColor="#999fa7" onChangeText={props.onOrigin} />
          <Action label="Download / update show" disabled={props.busy || !props.origin.trim()} onPress={() => props.onPrepare(true)} />
          <Action label="Inspect saved show" disabled={props.busy || !props.origin.trim()} onPress={() => props.onPrepare(false)} />
          <Action label="Check & install app update" disabled={props.busy} onPress={props.onUpdate} />
          <Text style={styles.muted}>App software: {props.appChannel}. Show content updates automatically when you join.</Text>
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
          <Text style={styles.text}>{screen.body}</Text>
          {(props.busy || (props.connected && props.status !== 'Connected' && !rejected)) && <ActivityIndicator color="#cad3df" accessibilityLabel={props.status} />}
          {!!props.error && <Text accessibilityRole="alert" style={styles.error}>{props.error}</Text>}
          {!!props.notificationStatus && props.notificationStatus !== 'Show action notifications enabled' && <Text style={styles.muted}>{props.notificationStatus}</Text>}
          {!props.connected && !props.busy && props.status !== 'Download a show, then join' && <Text style={styles.muted}>{props.status}</Text>}
        </View>
        {screen.cursorOpen && <CursorPad key={`${props.snapshot?.sessionId}:${props.snapshot?.phaseEpoch}:${props.snapshot?.routingEpoch}`} onPoint={props.onPoint} disabled={!screen.canAct} color={props.identity?.color ?? '#d9e4f1'} />}
        <View style={styles.inset}>
          {!props.connected ? <>
            {props.deviceLabel.trim() ? <Text style={styles.label}>This tablet: {props.deviceLabel.trim()}</Text> : <>
              <Text style={styles.label}>Your name / device label</Text>
              <TextInput accessibilityLabel="Your name or device label" style={styles.input} value={props.name} onChangeText={props.onName} maxLength={40} editable={!props.busy} placeholder="e.g. Alex" placeholderTextColor="#999fa7" />
            </>}
            {!props.origin.trim() && <Text style={styles.muted}>Set the venue server in Device settings to join.</Text>}
            <Action label={props.error ? 'Try joining again' : 'Prepare & join'} primary disabled={props.busy || !props.origin.trim() || !(props.deviceLabel.trim() || props.name.trim())} onPress={props.onJoin} />
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
      </>}</Animated.View>}
      {!settings && <Animated.View style={showMode ? { opacity: textOpacity } : undefined}><AudioField playing={props.playing && !props.paused && !rejected} compact={showMode || hasChoices} /></Animated.View>}
      {!!modeError && <Text accessibilityRole="alert" style={styles.error}>{modeError}</Text>}
      {showMode && <Animated.View style={[styles.exitWrap, { opacity: textOpacity }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Exit show mode" accessibilityHint="Hold for two seconds" delayLongPress={2000} onLongPress={() => { setModeError(''); setShowMode(false); }} style={styles.exitMode}>
          <Text style={[styles.exitText, { color: surfaceText }]}>Hold to exit show mode</Text>
        </Pressable>
      </Animated.View>}
      {!showMode && !settings && <View style={styles.footer}>
        {props.connected ? <>
          {ShowScreen && !rejected && <>
            <Action label="Enter show mode" onPress={() => void enterShowMode()} />
            {Platform.OS === 'android' && <Action label={pinScreen ? 'Screen pinning: on' : 'Screen pinning: off'} selected={pinScreen} onPress={() => setPinScreen(!pinScreen)} />}
            <Text style={styles.muted}>Show mode keeps the screen awake between actions; the operator can set its color. Hold the exit control for two seconds. Android asks you to confirm screen pinning to restrict Home and app switching.</Text>
          </>}
          {!props.paused && !rejected && <Action label="Pause audio" onPress={props.onPause} />}
          <Action label={rejected ? 'Back to setup' : 'Leave show'} onPress={props.onLeave} />
          <Action label="Device details" onPress={() => setSettings(true)} />
        </> : <Action label="Device settings" disabled={props.busy} onPress={() => setSettings(true)} />}
      </View>}
    </ScrollView>
    {showMode && !!props.surface.label && <View pointerEvents="none" style={styles.identify} accessibilityLiveRegion="polite">
      <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.identifyText, { color: surfaceText }]}>{props.surface.label}</Text>
    </View>}
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  exitWrap: { marginTop: 'auto' }, exitMode: { padding: 24, alignItems: 'center', minHeight: 64, backgroundColor: 'transparent' },
  exitText: { fontSize: 13, lineHeight: 20, opacity: .55 },
  identify: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 24 },
  identifyText: { fontSize: 220, fontWeight: '700', letterSpacing: -4 },
  screen: { flex: 1, backgroundColor: '#090a0b' }, page: { flexGrow: 1, paddingBottom: 24 },
  header: { padding: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  identity: { flex: 1, alignItems: 'flex-end' }, identityName: { color: '#e4e5e6', fontSize: 12, letterSpacing: 1 },
  inset: { paddingHorizontal: 24, paddingVertical: 16, gap: 14 }, copy: { paddingTop: 32, paddingBottom: 28 },
  title: { color: '#e4e5e6', fontSize: 30, fontWeight: '500', letterSpacing: -.7 }, text: { color: '#bbc0c8', fontSize: 17, lineHeight: 25 },
  muted: { color: '#a3aab5', fontSize: 13, lineHeight: 20 }, label: { color: '#d6dbe3', fontSize: 14 }, error: { color: '#ffb8b0', fontSize: 15, lineHeight: 22 },
  input: { color: '#eef0f3', borderColor: '#3c424b', borderWidth: 1, borderRadius: 8, padding: 14, fontSize: 16, backgroundColor: '#101216' },
  button: { minHeight: 48, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: '#434a55', justifyContent: 'center', flexShrink: 1 },
  buttonText: { color: '#e1e6ed', fontSize: 15, textAlign: 'center' }, primary: { backgroundColor: '#dce2ea', borderColor: '#dce2ea' }, primaryText: { color: '#11151b' },
  selected: { borderColor: '#dce2ea', backgroundColor: '#29323e' }, disabled: { opacity: .45 }, pressed: { opacity: .7 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  footer: { paddingHorizontal: 24, paddingTop: 18, marginTop: 'auto', flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  audio: { height: 240, backgroundColor: '#10151c', justifyContent: 'center', overflow: 'hidden' }, audioCompact: { height: 80, backgroundColor: 'transparent' },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 3 }, bar: { flex: 1, backgroundColor: '#8f9fb3', opacity: .65, borderRadius: 2 },
  audioLabel: { position: 'absolute', left: 24, bottom: 18, fontSize: 11, color: '#afbdcf', letterSpacing: 1.4 },
  pad: { height: 300, width: '100%', backgroundColor: '#11161c', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  touchSurface: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  padLabel: { color: '#b6c3d3', fontSize: 13, padding: 24, textAlign: 'center' }, gridVertical: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#202831' },
  gridHorizontal: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#202831' },
  dot: { position: 'absolute', width: 18, height: 18, borderRadius: 9, transform: [{ translateX: -9 }, { translateY: -9 }], borderWidth: 2, borderColor: '#f1f4f8' },
  accessibleCursor: { position: 'absolute', bottom: 0, flexDirection: 'row' }, direction: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
