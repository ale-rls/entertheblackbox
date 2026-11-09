import type { AdmissionProgram } from '@entertheblackbox/scenario';
export function admissionLayers(program: AdmissionProgram, anchor: number) {
  const layers: { id: string; src: string; startAt: number; endAt: number; repeatEveryMs?: number }[] = [];
  let at = anchor;
  program.intro.forEach((step, i) => { if (step.src) layers.push({ id: `admission-intro-${i}`, src: step.src, startAt: at, endAt: at + step.durationMs }); at += step.durationMs; });
  const period = program.loop.reduce((n, s) => n + s.durationMs, 0);
  program.loop.forEach((step, i) => { if (step.src) layers.push({ id: `admission-loop-${i}`, src: step.src, startAt: at, endAt: at + step.durationMs, repeatEveryMs: period }); at += step.durationMs; });
  return layers;
}
