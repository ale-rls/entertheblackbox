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
  /**
   * Set only by the server on a group introduction (see groupIntroductionSchema): there is nothing to choose,
   * the result arrives with it, and the tablet alerts until the introduction ends. Never authored.
   */
  introduction: z.boolean().optional(),
  // Show-scoped workflows survive scene changes, but are cancelled on show end/restart.
  persistAcrossPhases: z.boolean().optional(),
  audio: taskAudioSchema.optional(),
  autoComplete: z.boolean().optional(),
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
}).refine(task => {
  if (!task.autoComplete) return true;
  const [option] = task.options;
  return !task.persistAcrossPhases && task.options.length === 1 && !!option &&
    option.capacity === undefined && !option.roleId && !option.groupId && !option.nextTaskId &&
    !option.audio && !option.audioByVote && !option.rankOutcomes && !option.overflow;
}, {
  path: ['autoComplete'],
  message: 'Automatic completion requires one unlimited bookkeeping option without routing, outcome recordings, or persistence across scenes.',
});
export type ParticipantTask = z.infer<typeof participantTaskSchema>;
export const taskRecipientSchema = z.object({
  participantId: id, optionId: id.nullable(), sequence: z.number().int().nullable(),
  /** Which outcome an answered option gave: `rank-N` or `overflow`. Absent for the option's own. */
  outcome: z.string().max(40).optional(),
  /** The role the applied outcome named, whether it was granted now or already held: a withdrawal of that role reaches this answer. */
  grantedRoleId: id.optional(),
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

/**
 * Played to a participant whenever they are moved into the group: by the operator, Assign rest or a staff pick.
 * Moving them again plays the new group's introduction; moving them to a group without one stops it.
 */
export const groupIntroductionSchema = z.object({
  /** Lock-screen notification and "your turn" banner. */
  notificationBody: z.string().trim().min(1).max(200),
  /** Shown on the tablet while the introduction runs. */
  text: z.string().trim().min(1).max(2000),
  audio: taskAudioSchema.optional(),
});
export type GroupIntroduction = z.infer<typeof groupIntroductionSchema>;
/** How long a tablet alerts and shows an introduction without a recording. */
export const GROUP_INTRODUCTION_TEXT_MS = 15_000;
/**
 * Admin → Devices "Assign rest": draws everyone still in `fromGroupId` into the `fill` groups
 * (in order, each held between min and max at about `share` of the drawn pool), the rest into `restGroupId`.
 * `leadGroupIds` are the hand-picked parts; Admin warns while one is empty.
 */
export const assignRestSchema = z.object({
  fromGroupId: id,
  leadGroupIds: z.array(id).max(20).default([]),
  fill: z.array(z.object({
    groupId: id,
    min: z.number().int().nonnegative().max(1000).default(0),
    max: z.number().int().positive().max(1000),
    share: z.number().positive().max(1),
  }).refine(f => f.min <= f.max, { message: 'min must not exceed max', path: ['min'] })).max(10).default([]),
  restGroupId: id,
});
export type AssignRest = z.infer<typeof assignRestSchema>;
/** Introduction recordings belong in the native bundle like task recordings. */
export function groupIntroductionAudioSources(groups: readonly { introduction?: GroupIntroduction | undefined }[] = []): string[] {
  return [...new Set(groups.flatMap(g => g.introduction?.audio ? [g.introduction.audio.src] : []))];
}

export const participantRoleSchema = z.object({ id, label: z.string().trim().min(1).max(200), capacity: z.number().int().positive().max(10000).optional(), exclusiveSet: z.string().max(100).optional() });
export type ParticipantRole = z.infer<typeof participantRoleSchema>;
/**
 * A pick in the staff menu on the tablet (unlocked with the venue's staff PIN).
 * It assigns a role, a group, or both to whoever is holding that tablet.
 */
export const staffAssignmentSchema = z.object({ id, label: z.string().trim().min(1).max(200), roleId: id.optional(), groupId: id.optional() })
  .refine(p => p.roleId !== undefined || p.groupId !== undefined, 'A staff pick needs a role or a group');
export type StaffAssignment = z.infer<typeof staffAssignmentSchema>;
export type RoleAssignment = { participantId: string; roleId: string; source: string; assignedAt: number };

/** Every task recording must be bundled, including alternatives selected by vote history. */
export function taskAudioSources(tasks: readonly ParticipantTask[] = []): string[] {
  return [...new Set(tasks.flatMap(t => [t.audio?.src, t.fullAudio?.src, ...t.options.flatMap(o =>
    [o.audio?.src, o.audioByVote?.fallback.src, ...Object.values(o.audioByVote?.clips ?? {}).map(a => a.src),
      o.overflow?.audio?.src, ...(o.rankOutcomes ?? []).map(r => r.audio?.src)])]).filter((s): s is string => !!s))];
}
