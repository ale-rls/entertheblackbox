import { describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ setLayer: vi.fn(async () => {}), clearLayer: vi.fn(async () => {}), write: vi.fn() }));
vi.mock('@entertheblackbox/expo-audio-scheduler', () => ({ default: api }));
vi.mock('expo-file-system', () => ({ Paths: { cache: 'cache' }, File: class { exists = false; uri = 'file:///cue.wav'; write = api.write; } }));
import { attentionWave, createForegroundAttention } from './foreground-attention';
describe('foreground action sound', () => {
  it('mixes once per action and clears on answer/background/expiry without stopping show audio', async () => {
    api.setLayer.mockClear(); api.clearLayer.mockClear();
    const alerts = createForegroundAttention(vi.fn());
    const prompt = { key: 'task:one', body: 'Choose' };
    alerts.update(prompt); alerts.update(prompt); await alerts.settled();
    expect(api.setLayer).toHaveBeenCalledTimes(1);
    expect(api.setLayer).toHaveBeenCalledWith('action-attention', { uri: 'file:///cue.wav', loop: false, volume: 1 });
    alerts.update(null); await alerts.settled();
    expect(api.clearLayer).toHaveBeenCalledTimes(1);
    expect(api.clearLayer).toHaveBeenCalledWith('action-attention');
    alerts.update(prompt); await alerts.settled();
    expect(api.setLayer).toHaveBeenCalledTimes(1);
    alerts.update({ key: 'task:two', body: 'Again' }); await alerts.settled();
    expect(api.setLayer).toHaveBeenCalledTimes(2);
  });
  it('creates a bounded PCM cue with silent edges and no downloaded media', () => {
    const bytes = attentionWave(), view = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(view.getUint32(40, true)).toBe(bytes.length - 44);
    expect(view.getUint32(24, true)).toBe(22050);
    expect(view.getInt16(44, true)).toBe(0);
    expect(Math.abs(view.getInt16(bytes.length - 2, true))).toBeLessThan(10);
    let peak = 0;
    for (let i = 44; i < bytes.length; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
    expect(peak).toBeGreaterThan(5000); expect(peak).toBeLessThan(8000);
  });
});
