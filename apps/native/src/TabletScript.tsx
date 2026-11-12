import React from 'react';
import { StyleSheet, View } from 'react-native';
import { scriptLines, type TabletScriptExcerpt } from '@entertheblackbox/scenario';
import { Text } from './Text';

/** A scene's actor script excerpt; this tablet's own lines are highlighted for reading aloud. */
export function TabletScript({ script, color }: { script: TabletScriptExcerpt; color: string }) {
  return <View style={styles.wrap} accessibilityLabel={`${script.title}${script.speaker ? `, your lines as ${script.speaker} are highlighted` : ''}`}>
    <Text accessibilityRole="header" style={[styles.title, { color }]}>{script.title}</Text>
    {script.paragraphs.map((paragraph, p) => <View key={p} style={styles.paragraph}>
      {scriptLines(paragraph, script.speaker).map((line, l) => <Text key={l}
        style={[styles.line, { color }, line.own && styles.own]}>{line.text || ' '}</Text>)}
    </View>)}
  </View>;
}
const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16, gap: 18 },
  title: { fontSize: 15, letterSpacing: 1.2, opacity: .8 },
  paragraph: { gap: 2 },
  line: { fontSize: 20, lineHeight: 30 },
  own: { backgroundColor: '#ffe14d', color: '#111111', fontWeight: '600' },
});
