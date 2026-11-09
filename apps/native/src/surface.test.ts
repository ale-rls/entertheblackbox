import { describe, expect, it } from 'vitest';
import type { SurfaceMessage } from '@entertheblackbox/protocol';
import { applySurface, contrastText, expireSurface, initialSurface, MAX_SURFACE_DELAY_MS, surfaceDelay, visibleSurface } from './surface';

const msg = (part: Partial<SurfaceMessage>): SurfaceMessage => ({ t: 'surface', v: 2, mode: 'set', color: '#ff0000', applyAt: 0, seq: 1, ...part });

describe('surface scheduling', () => {
  it('waits until the shared applyAt, applies late or uncalibrated messages at once, and caps bad estimates', () => {
    expect(surfaceDelay(1_060, 1_000, true)).toBe(60);
    expect(surfaceDelay(900, 1_000, true)).toBe(0);
    expect(surfaceDelay(1_060, 1_000, false)).toBe(0);
    expect(surfaceDelay(99_000, 1_000, true)).toBe(MAX_SURFACE_DELAY_MS);
  });
  it('sets the base, overlays flashes, releases, and ignores stale sequence numbers', () => {
    let view = applySurface(initialSurface, msg({ mode: 'set', color: '#112233', seq: 1 }), 0);
    expect(visibleSurface(view)).toEqual({ color: '#112233' });
    view = applySurface(view, msg({ mode: 'flash', color: '#ffffff', seq: 3, label: 'T07' }), 0);
    expect(visibleSurface(view)).toEqual({ color: '#ffffff', label: 'T07' });
    expect(applySurface(view, msg({ mode: 'release', seq: 2 }), 0)).toBe(view);
    view = applySurface(view, msg({ mode: 'release', seq: 4 }), 0);
    expect(visibleSurface(view)).toEqual({ color: '#112233' });
  });
  it('expires a timed flash but holds a sustained one until release', () => {
    const timed = applySurface(initialSurface, msg({ mode: 'flash', color: '#00ff00', seq: 1, holdMs: 250 }), 1_000);
    expect(expireSurface(timed, 1_249).flash).not.toBeNull();
    expect(expireSurface(timed, 1_250).flash).toBeNull();
    const held = applySurface(initialSurface, msg({ mode: 'flash', color: '#00ff00', seq: 1 }), 1_000);
    expect(expireSurface(held, 1_000_000).flash).not.toBeNull();
  });
  it('picks legible text for light and dark surfaces', () => {
    expect(contrastText('#ffffff')).toBe('#000000');
    expect(contrastText('#ffff00')).toBe('#000000');
    expect(contrastText('#000000')).toBe('#ffffff');
    expect(contrastText('#0000ff')).toBe('#ffffff');
  });
});
