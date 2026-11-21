/** Server time from which a scene shows its cursors, or null when they show from its start. */
export function cursorsVisibleFrom(phase: { kind: string; startedAt: number; cursorsFromMs?: number | undefined } | null): number | null {
  if (!phase || phase.kind === "idle" || phase.kind === "group-branch" || !phase.cursorsFromMs) return null;
  return phase.startedAt + phase.cursorsFromMs;
}
