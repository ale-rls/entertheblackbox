/** Participant-controlled background-music volume, stored per device. null follows the published show default. */
export const MUSIC_VOLUME_KEY = 'musicVolume';
export const MUSIC_VOLUME_STEP = 0.1;

/** Reads a stored setting; anything missing or malformed means "show default". */
export function parseMusicVolume(stored: string | null): number | null {
  if (stored === null || stored.trim() === '') return null;
  const value = Number(stored);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/** Moves one 10% step from the current effective volume, snapped to the step grid and clamped to 0–100%. */
export function stepMusicVolume(current: number, direction: 1 | -1): number {
  const steps = Math.round(current / MUSIC_VOLUME_STEP) + direction;
  return Math.min(1, Math.max(0, Math.round(steps) / 10));
}

export function musicVolumeLabel(volume: number | null, showDefault: number | null): string {
  const effective = volume ?? showDefault;
  if (effective === null) return 'No background music in this show';
  const percent = `${Math.round(effective * 100)}%`;
  return volume === null ? `${percent} (show default)` : percent;
}
