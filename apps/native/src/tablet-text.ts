import type { Snapshot } from './cues';
/**
 * The scene text this tablet shows: the participant's group text when the scene sets one (an empty
 * group text hides the default), otherwise the scene default. Each scene replaces the last, so a
 * scene without text clears it.
 */
export function tabletTextFromSnapshot(snapshot: Snapshot | null): string | null {
  if (!snapshot) return null;
  const p = snapshot.phase;
  if (p.kind === 'idle' || p.kind === 'group-branch' ||
      snapshot.participantState === 'unassigned' || snapshot.participantState === 'finished') return null;
  const group = snapshot.currentGroup?.id;
  const byGroup = group === undefined ? undefined : p.tabletTextByGroup?.[group];
  return (byGroup ?? p.tabletText)?.trim() || null;
}
