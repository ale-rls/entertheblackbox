import { expect, it } from 'vitest';
import { musicVolumeLabel, parseMusicVolume, stepMusicVolume } from './music-volume';

it('treats missing or malformed stored values as the show default', () => {
  expect(parseMusicVolume(null)).toBeNull();
  expect(parseMusicVolume('')).toBeNull();
  expect(parseMusicVolume('loud')).toBeNull();
  expect(parseMusicVolume('1.5')).toBeNull();
  expect(parseMusicVolume('0')).toBe(0);
  expect(parseMusicVolume('0.7')).toBe(0.7);
});
it('steps in 10% increments from the effective volume, snapping off-grid defaults and clamping at the ends', () => {
  expect(stepMusicVolume(0.2, 1)).toBe(0.3);
  expect(stepMusicVolume(0.25, -1)).toBe(0.2);
  expect(stepMusicVolume(0.04, -1)).toBe(0);
  expect(stepMusicVolume(0, -1)).toBe(0);
  expect(stepMusicVolume(1, 1)).toBe(1);
});
it('labels the effective volume and says when it follows the show', () => {
  expect(musicVolumeLabel(null, 0.2)).toBe('20% (show default)');
  expect(musicVolumeLabel(0.5, 0.2)).toBe('50%');
  expect(musicVolumeLabel(0, 0.2)).toBe('0%');
  expect(musicVolumeLabel(null, null)).toBe('No background music in this show');
});
