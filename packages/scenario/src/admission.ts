import { z } from 'zod';
export const admissionStepSchema = z.object({
  src: z.string().min(1).regex(/^(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[^:?#]+\.mp3$/i).optional(),
  durationMs: z.number().int().min(100).max(3_600_000),
});
export const admissionProgramSchema = z.object({
  groupId: z.string().min(1),
  intro: z.array(admissionStepSchema).max(16),
  loop: z.array(admissionStepSchema).min(1).max(16),
});
export const admissionConfigSchema = z.object({
  assignment: z.enum(['operator', 'self-select']),
  paths: z.array(admissionProgramSchema).min(1).max(32).refine(paths => new Set(paths.map(p => p.groupId)).size === paths.length, 'Duplicate admission group'),
});
export type AdmissionProgram = z.infer<typeof admissionProgramSchema>;
export function admissionPosition(program: AdmissionProgram, anchor: number, now: number) {
  const introDuration = program.intro.reduce((n, s) => n + s.durationMs, 0);
  const loopDuration = program.loop.reduce((n, s) => n + s.durationMs, 0);
  const elapsed = Math.max(0, now - anchor);
  const inIntro = elapsed < introDuration;
  const iteration = inIntro ? 0 : Math.floor((elapsed - introDuration) / loopDuration);
  let offset = inIntro ? elapsed : (elapsed - introDuration) % loopDuration;
  const steps = inIntro ? program.intro : program.loop;
  for (let index = 0; index < steps.length; index++) { const step = steps[index]!; if (offset < step.durationMs) return { section: inIntro ? 'intro' : 'loop', index, iteration, offsetMs: offset, src: step.src ?? null }; offset -= step.durationMs; }
  return null;
}
export function admissionSources(config: z.infer<typeof admissionConfigSchema> | undefined): string[] { return [...new Set((config?.paths ?? []).flatMap(p => [...p.intro, ...p.loop].flatMap(s => s.src ? [s.src] : [])))]; }
