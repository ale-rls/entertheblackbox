import { describe, expect, it } from 'vitest';
import { taskAlert, taskVisible, type ParticipantTaskState } from './participant-task';

function state(status: NonNullable<ParticipantTaskState['task']>['recipient']['status']): ParticipantTaskState {
  return { t: 'participant_task', v: 2, sessionId: 'show', task: {
    id: 'casting', status: 'open', deadlineAt: 10000,
    template: { id: 'jobs', title: 'Jobs', question: 'Choose a job', notificationBody: 'Choose',
      groupIds: [], durationMs: 10000, options: [{ id: 'lead', label: 'Lead', message: '' }], fullMessage: 'Choose another job' },
    recipient: { participantId: 'p', status, optionId: status === 'pending' ? null : 'lead', sequence: null,
      respondedAt: status === 'pending' ? null : 1000, message: status === 'full' ? 'Choose another job' : '',
      audio: { src: 'lead.mp3', durationMs: 2000, startedAt: 1000 } },
  } };
}

describe('participant task visibility', () => {
  it.each(['accepted', 'answered'] as const)('returns to neutral after a server-confirmed %s response without changing audio', status => {
    const message = state(status);
    const before = structuredClone(message);
    expect(taskVisible(message)).toBe(false);
    expect(taskAlert(message, 2000)).toBeNull();
    expect(message).toEqual(before);
    message.task!.status = 'closed';
    expect(taskVisible(message)).toBe(false);
  });
  it.each(['pending', 'full'] as const)('keeps %s choices visible and actionable until the deadline', status => {
    const message = state(status);
    expect(taskVisible(message)).toBe(true);
    expect(taskAlert(message, 2000)).not.toBeNull();
    expect(taskAlert(message, 10000)).toBeNull();
    if (status === 'full') expect(message.task!.recipient.message).toBe('Choose another job');
  });
  it('hides missing and cancelled tasks but preserves operator withdrawal feedback', () => {
    expect(taskVisible(null)).toBe(false);
    expect(taskVisible({ t: 'participant_task', v: 2, sessionId: 'show', task: null })).toBe(false);
    expect(taskVisible(state('cancelled'))).toBe(false);
    const cancelled = state('pending'); cancelled.task!.status = 'cancelled';
    expect(taskVisible(cancelled)).toBe(false);
    expect(taskVisible(state('withdrawn'))).toBe(true);
  });
});
