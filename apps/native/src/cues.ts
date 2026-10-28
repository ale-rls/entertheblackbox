import type { ServerToClientMessage } from '@entertheblackbox/protocol';
export type Snapshot = Extract<ServerToClientMessage, { t: 'snapshot' | 'phase' }>;
/**
 * Narration plays this long after its phase starts (and stops the same amount later), so every
 * phone has received and prepared the clip and starts it at 0:00 instead of seeking past its
 * opening. Video phases stay on the phase clock: the display video seeks the same way, so
 * phone audio and picture remain in step.
 */
export const NARRATION_START_DELAY_MS = 400;
export type Cue = { key: string; src: string; startedAt: number; endsAt: number | null; scenarioVersion: string };
export function acceptsSnapshot(previous: Snapshot | null, next: Snapshot): boolean {
  return !previous || next.sessionId !== previous.sessionId ||
    (next.routingEpoch ?? 0) > (previous.routingEpoch ?? 0) ||
    ((next.routingEpoch ?? 0) === (previous.routingEpoch ?? 0) && next.phaseEpoch >= previous.phaseEpoch);
}
export function cueFromSnapshot(message: Snapshot): Cue | null {
  const p = message.phase;
  if (p.kind === 'idle' || message.phoneAudioActive === false ||
      message.participantState === 'unassigned' || message.participantState === 'finished') return null;
  const group = message.currentGroup?.id;
  const src = p.kind === 'group-branch'
    ? p.branches.find(b => b.groupId === group)?.phoneAudioSrc
    : (group ? p.phoneAudioByGroup?.[group] : undefined) ?? p.phoneAudioSrc;
  if (!src) return null;
  // Group selection can restart the instruction window after phase entry.
  const delay = p.kind === 'video' ? 0 : NARRATION_START_DELAY_MS;
  const startedAt = (p.kind === 'group-branch' && p.deadlineAt !== null ? p.deadlineAt - p.durationMs : p.startedAt) + delay;
  return { key: `${message.sessionId}:${message.routingEpoch ?? 0}:${message.phaseEpoch}:${group ?? ''}:${src}:${startedAt}`,
    src, startedAt, endsAt: p.deadlineAt === null ? null : p.deadlineAt + delay, scenarioVersion: p.scenarioVersion };
}
export function targetPosition(cue: Cue, serverNow: number): number | null {
  if (serverNow < cue.startedAt || (cue.endsAt !== null && serverNow >= cue.endsAt)) return null;
  return Math.max(0, (serverNow - cue.startedAt) / 1000);
}
