import { describe, expect, it } from 'vitest';
import { optikFace } from './typography';

describe('optikFace', () => {
  it('uses the regular face by default and for medium weights', () => {
    expect(optikFace({}).fontFamily).toBe('Optik');
    expect(optikFace({ fontWeight: '500' }).fontFamily).toBe('Optik');
  });
  it('uses the bold face from 600 up', () => {
    for (const fontWeight of ['600', '700', 'bold', 800] as const) expect(optikFace({ fontWeight }).fontFamily).toBe('Optik-Bold');
  });
  it('uses the italic face for italic text, bold taking precedence', () => {
    expect(optikFace({ fontStyle: 'italic' }).fontFamily).toBe('Optik-Italic');
    expect(optikFace({ fontStyle: 'italic', fontWeight: '700' }).fontFamily).toBe('Optik-Bold');
  });
  it('resets weight and slant so the static face is not synthesized again', () => {
    expect(optikFace({ fontWeight: '700', fontStyle: 'italic' })).toMatchObject({ fontWeight: 'normal', fontStyle: 'normal' });
  });
});
