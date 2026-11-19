import type { ServerToClientMessage } from '@entertheblackbox/protocol';
export type ParticipantTaskState = Extract<ServerToClientMessage, { t: 'participant_task' }>;
export function taskAlert(state: ParticipantTaskState | null, now: number) {
  const task = state?.task;
  return task && task.status === 'open' && task.deadlineAt > now && (task.recipient.status === 'pending' || task.recipient.status === 'full')
    ? { key: `task:${state.sessionId}:${task.id}`, body: task.template.notificationBody } : null;
}
/** Keep completed choices out of both the card and show-mode attention state. */
export function taskVisible(state: ParticipantTaskState | null) {
  const task = state?.task;
  return !!task && task.status !== 'cancelled' && !['cancelled', 'accepted', 'answered'].includes(task.recipient.status);
}
