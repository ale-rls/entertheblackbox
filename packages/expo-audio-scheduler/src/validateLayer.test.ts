import { expect, it } from 'vitest';
import { validateLayer } from './validateLayer';

it('accepts the free-running loop and the clock-anchored clip', () => {
  expect(() => validateLayer({ uri: 'file:///bed.mp3', loop: true, volume: 0.2 })).not.toThrow();
  expect(() => validateLayer({ uri: 'file:///cue.mp3', startAt: 1000, endAt: 11000 })).not.toThrow();
  expect(() => validateLayer({ uri: 'file:///cue.mp3', startAt: 1000, endAt: null })).not.toThrow();
});

it('rejects combinations the native schedulers do not implement', () => {
  expect(() => validateLayer({ uri: 'file:///a.mp3', loop: true, startAt: 1000 })).toThrow('play once');
  expect(() => validateLayer({ uri: 'file:///a.mp3', endAt: 1000 })).toThrow('endAt needs startAt');
  expect(() => validateLayer({ uri: 'file:///a.mp3', volume: 1.5 })).toThrow('volume');
});

it('requires repeat periods to contain a finite positive anchored window', () => {
  expect(() => validateLayer({uri:'file://loop.mp3',startAt:1000,endAt:2000,repeatEveryMs:1000})).not.toThrow();
  for (const period of [0,999,Infinity,NaN]) expect(() => validateLayer({uri:'file://loop.mp3',startAt:1000,endAt:2000,repeatEveryMs:period})).toThrow();
  expect(() => validateLayer({uri:'file://loop.mp3',repeatEveryMs:1000})).toThrow();
});
