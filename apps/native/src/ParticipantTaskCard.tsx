import React from 'react';
import { View, Pressable } from 'react-native';
import { Text } from './Text';
import { taskAlert, taskVisible, type ParticipantTaskState } from './participant-task';
export function ParticipantTaskCard({ state, now, enabled, respond }: { state: ParticipantTaskState | null; now: number; enabled: boolean; respond: (optionId: string) => void }) {
  const task = state?.task;
  if (!task || !taskVisible(state)) return null;
  const canAnswer = enabled && !!taskAlert(state, now);
  return <View style={{ padding: 20, gap: 12, backgroundColor: '#202226', borderRadius: 12 }}>
    <Text accessibilityRole="header" style={{ color: 'white', fontSize: 22 }}>{task.template.question}</Text>
    {task.status === 'open' && <Text style={{ color: '#ddd' }}>{Math.max(0, Math.ceil((task.deadlineAt - now) / 1000))} seconds remaining</Text>}
    {task.template.options.map(option => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ disabled: !canAnswer, selected: task.recipient.optionId === option.id }} disabled={!canAnswer} onPress={() => respond(option.id)} style={{ padding: 16, borderWidth: 1, borderColor: '#888', opacity: canAnswer ? 1 : .6 }}><Text style={{ color: 'white', fontSize: 18 }}>{option.label}{task.recipient.optionId === option.id ? ' ✓' : ''}</Text></Pressable>)}
    {!!task.recipient.message && <Text accessibilityLiveRegion="polite" style={{ color: 'white', fontSize: 18 }}>{task.recipient.message}</Text>}
    {!enabled && <Text style={{ color: '#ddd' }}>Reconnect to respond.</Text>}
  </View>;
}
