import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, StyleSheet, View } from 'react-native';
import type { ActionPrompt } from './action-prompt';
import { Text } from './Text';

/** Instrument-like colour takeover stays outside the scroll area and never covers controls. */
export function ActionAttention({ prompt }: { prompt: ActionPrompt }) {
  const glow = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const app = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => { mounted = false; motion.remove(); app.remove(); };
  }, []);
  useEffect(() => {
    if (reduceMotion || !foreground) { glow.setValue(1); return; }
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: .65, duration: 800, useNativeDriver: true }),
      Animated.timing(glow, { toValue: 1, duration: 800, useNativeDriver: true }),
    ]), { iterations: 2 });
    pulse.start(); return () => { pulse.stop(); glow.setValue(1); };
  }, [reduceMotion, foreground, glow]);
  return <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.banner}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.glow, { opacity: glow }]} />
    <Text style={styles.title}>YOUR TURN</Text>
    <Text numberOfLines={3} style={styles.body}>{prompt.body.replace(/^Open the app to /, 'Please ')}</Text>
  </View>;
}
const styles = StyleSheet.create({
  banner: { paddingHorizontal: 24, paddingVertical: 20, backgroundColor: '#cab500', borderBottomWidth: 4, borderBottomColor: '#ffffff' },
  glow: { backgroundColor: '#ffe600' },
  title: { color: '#090a0b', fontSize: 34, fontWeight: '700', letterSpacing: 1 },
  body: { color: '#090a0b', fontSize: 19, lineHeight: 25, marginTop: 6 },
});
