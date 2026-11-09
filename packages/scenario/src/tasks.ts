import { z } from 'zod';
const id = z.string().trim().min(1).max(100);
export const participantTaskSchema = z.object({
  id, title: z.string().trim().min(1).max(200), question: z.string().trim().min(1).max(2000),
  notificationBody: z.string().trim().min(1).max(200),
  groupIds: z.array(id).default([]),
  durationMs: z.number().int().min(1000).max(3_600_000),
  options: z.array(z.object({ id, label: z.string().trim().min(1).max(200),
    roleId: id.optional(),
    capacity: z.number().int().positive().max(10000).optional(),
    message: z.string().max(2000).default(''),
  })).min(1).max(12).refine(a => new Set(a.map(o => o.id)).size === a.length, 'Option IDs must be unique'),
  fullMessage: z.string().max(2000).default('This option is full. Choose another available option.'),
});
export type ParticipantTask = z.infer<typeof participantTaskSchema>;
export const taskRecipientSchema = z.object({
  participantId: id, optionId: id.nullable(), sequence: z.number().int().nullable(),
  status: z.enum(['pending', 'answered', 'accepted', 'full', 'expired', 'cancelled', 'withdrawn']),
  message: z.string(), respondedAt: z.number().nullable(),
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
