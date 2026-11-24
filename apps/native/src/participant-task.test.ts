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
  it('alerts and holds attention for a group introduction until it ends, and drops it when cancelled', () => {
    const message = state('answered');
    message.task!.status = 'closed';
    message.task!.template = { ...message.task!.template, introduction: true, notificationBody: 'Du bist im Chor' };
    expect(taskAlert(message, 2000)).toEqual({ key: 'task:show:casting', body: 'Du bist im Chor' });
    expect(taskVisible(message, 2000)).toBe(true);
    expect(taskAlert(message, 10000)).toBeNull();
    expect(taskVisible(message, 10000)).toBe(false);
    message.task!.status = 'cancelled';
    expect(taskAlert(message, 2000)).toBeNull();
  });
  it.each(['accepted', 'answered'] as const)('returns to neutral after a server-confirmed %s response without changing audio', status => {
    const message = state(status);
    const before = structuredClone(message);
    expect(taskVisible(message, 2000)).toBe(false);
    expect(taskAlert(message, 2000)).toBeNull();
    expect(message).toEqual(before);
    message.task!.status = 'closed';
    expect(taskVisible(message, 2000)).toBe(false);
  });
  it.each(['pending', 'full'] as const)('keeps %s choices visible and actionable until the deadline', status => {
    const message = state(status);
    expect(taskVisible(message, 2000)).toBe(true);
    expect(taskAlert(message, 2000)).not.toBeNull();
    expect(taskAlert(message, 10000)).toBeNull();
    if (status === 'full') expect(message.task!.recipient.message).toBe('Choose another job');
  });
  it('hides missing and cancelled tasks but preserves operator withdrawal feedback', () => {
    expect(taskVisible(null, 2000)).toBe(false);
    expect(taskVisible({ t: 'participant_task', v: 2, sessionId: 'show', task: null }, 2000)).toBe(false);
    expect(taskVisible(state('cancelled'), 2000)).toBe(false);
    const cancelled = state('pending'); cancelled.task!.status = 'cancelled';
    expect(taskVisible(cancelled, 2000)).toBe(false);
    expect(taskVisible(state('withdrawn'), 2000)).toBe(true);
  });
  it('lets go of a prompt at its deadline, even before the closing update arrives', () => {
    const late = state('pending');
    expect(taskVisible(late, 9999)).toBe(true);
    expect(taskVisible(late, 10000)).toBe(false);
    expect(taskAlert(late, 10000)).toBeNull();
  });
  it('lets a withdrawal on a closed task go, instead of bringing its old question back', () => {
    const withdrawn = state('withdrawn'); withdrawn.task!.status = 'closed';
    expect(taskVisible(withdrawn, 2000)).toBe(false);
  });
  it('never asks a tablet to act on an automatic task, open or completed', () => {
    const open = state('pending'); open.task!.template.autoComplete = true;
    expect(taskAlert(open, 2000)).toBeNull();
    expect(taskVisible(open, 2000)).toBe(false);
    const done = state('answered'); done.task!.template.autoComplete = true; done.task!.status = 'closed';
    expect(taskVisible(done, 2000)).toBe(false);
  });
  it('drops show-mode attention once responses close without an answer', () => {
    const expired = state('expired'); expired.task!.status = 'closed';
    expect(taskVisible(expired, 2000)).toBe(false);
    expect(taskAlert(expired, 2000)).toBeNull();
  });
});
