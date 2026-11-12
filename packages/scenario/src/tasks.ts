import { z } from 'zod';
const id = z.string().trim().min(1).max(100);
export const taskAudioSchema = z.object({
  src: z.string().regex(/^(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[^:?#]+\.mp3$/i),
  durationMs: z.number().int().positive().max(3_600_000),
});
/** What one response receives: an option's own fields, one rank's override, or the overflow. */
export const taskOutcomeSchema = z.object({
  roleId: id.optional(),
  groupId: id.optional(),
  audio: taskAudioSchema.optional(),
  nextTaskId: id.optional(),
  message: z.string().max(2000).optional(),
});
export type TaskOutcome = z.infer<typeof taskOutcomeSchema>;
export const participantTaskSchema = z.object({
  id, title: z.string().trim().min(1).max(200), question: z.string().trim().min(1).max(2000),
  notificationBody: z.string().trim().min(1).max(200),
  groupIds: z.array(id).default([]),
  // Show-scoped workflows survive scene changes, but are cancelled on show end/restart.
  persistAcrossPhases: z.boolean().optional(),
  audio: taskAudioSchema.optional(),
  durationMs: z.number().int().min(1000).max(3_600_000),
  options: z.array(z.object({ id, label: z.string().trim().min(1).max(200),
    roleId: id.optional(),
    groupId: id.optional(),
    audio: taskAudioSchema.optional(),
    audioByVote: z.object({ questionId: id, clips: z.record(id, taskAudioSchema), fallback: taskAudioSchema }).optional(),
    nextTaskId: id.optional(),
    capacity: z.number().int().positive().max(10000).optional(),
    message: z.string().max(2000).default(''),
    /** The Nth accepted response gets entry N; fields it leaves out fall back to the option's own. */
    rankOutcomes: z.array(taskOutcomeSchema).min(1).max(100).optional(),
    /** Once the option is at capacity, later responses get this instead of choosing again. */
    overflow: taskOutcomeSchema.optional(),
  })).min(1).max(12).refine(a => new Set(a.map(o => o.id)).size === a.length, 'Option IDs must be unique'),
  fullMessage: z.string().max(2000).default('This option is full. Choose another available option.'),
  /** Plays with fullMessage when a chosen option is full and has no overflow. */
  fullAudio: taskAudioSchema.optional(),
});
export type ParticipantTask = z.infer<typeof participantTaskSchema>;
export const taskRecipientSchema = z.object({
  participantId: id, optionId: id.nullable(), sequence: z.number().int().nullable(),
  /** Which outcome an answered option gave: `rank-N` or `overflow`. Absent for the option's own. */
  outcome: z.string().max(40).optional(),
  status: z.enum(['pending', 'answered', 'accepted', 'full', 'expired', 'cancelled', 'withdrawn']),
  message: z.string(), respondedAt: z.number().nullable(),
  audio: taskAudioSchema.extend({ startedAt: z.number() }).optional(),
});
export type TaskRecipient = z.infer<typeof taskRecipientSchema>;
export const taskInstanceSchema = z.object({
  id, sessionId: id, template: participantTaskSchema,
  phaseId: id.nullable(), phaseEpoch: z.number().int().nullable(),
  createdAt: z.number(), deadlineAt: z.number(), status: z.enum(['open','closed','cancelled']),
  recipients: z.array(taskRecipientSchema),
});
export type TaskInstance = z.infer<typeof taskInstanceSchema>;

export const participantRoleSchema = z.object({ id, label: z.string().trim().min(1).max(200), capacity: z.number().int().positive().max(10000).optional(), exclusiveSet: z.string().max(100).optional() });
export type ParticipantRole = z.infer<typeof participantRoleSchema>;
export type RoleAssignment = { participantId: string; roleId: string; source: string; assignedAt: number };

/** Every task recording must be bundled, including alternatives selected by vote history. */
export function taskAudioSources(tasks: readonly ParticipantTask[] = []): string[] {
  return [...new Set(tasks.flatMap(t => [t.audio?.src, t.fullAudio?.src, ...t.options.flatMap(o =>
    [o.audio?.src, o.audioByVote?.fallback.src, ...Object.values(o.audioByVote?.clips ?? {}).map(a => a.src),
      o.overflow?.audio?.src, ...(o.rankOutcomes ?? []).map(r => r.audio?.src)])]).filter((s): s is string => !!s))];
}
