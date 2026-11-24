import type { ServerToClientMessage } from '@entertheblackbox/protocol';
export type ParticipantTaskState = Extract<ServerToClientMessage, { t: 'participant_task' }>;
/** A group introduction: the server moved this tablet into a part. It alerts and holds attention until it ends. */
function runningIntroduction(state: ParticipantTaskState | null, now: number) {
  const task = state?.task;
  return !!task && !!task.template.introduction && task.status !== 'cancelled' && task.recipient.status === 'answered' && now < task.deadlineAt;
}
export function taskAlert(state: ParticipantTaskState | null, now: number) {
  const task = state?.task;
  if (task && runningIntroduction(state, now)) return { key: `task:${state!.sessionId}:${task.id}`, body: task.template.notificationBody };
  // An automatic task needs nothing from the tablet: no "your turn", no sound.
  return task && !task.template.autoComplete && task.status === 'open' && task.deadlineAt > now && (task.recipient.status === 'pending' || task.recipient.status === 'full')
    ? { key: `task:${state.sessionId}:${task.id}`, body: task.template.notificationBody } : null;
}
/**
 * Whether the task holds show-mode attention: a choice still to make, or an operator's withdrawal while its task is open.
 * Automatic tasks, completed choices, closed responses, and anything on a closed task never do; their card stays in the controls.
 */
export function taskVisible(state: ParticipantTaskState | null, now: number) {
  const task = state?.task;
  // Past the deadline the card's buttons are already off: let go then, even if the closing update is late on bad Wi-Fi.
  if (runningIntroduction(state, now)) return true;
  if (!task || task.template.autoComplete || task.status !== 'open' || now >= task.deadlineAt) return false;
  return task.recipient.status === 'pending' || task.recipient.status === 'full' || task.recipient.status === 'withdrawn';
}
