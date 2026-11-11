import AudioScheduler from '@entertheblackbox/expo-audio-scheduler';
import { File, Paths } from 'expo-file-system';
import { ActionAlerts } from './action-prompt';

const LAYER = 'action-attention';
/** A soft-edged two-note cue, generated locally: no show media or network dependency. */
export function attentionWave(): Uint8Array {
  const rate = 22050, duration = .64, count = Math.round(rate * duration);
  const bytes = new Uint8Array(44 + count * 2), view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  tag(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const t = i / rate, local = t < .3 ? t : t - .34;
    const envelope = local >= 0 && local < .3 ? Math.min(1, local / .02, (.3 - local) / .08) : 0;
    view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * (t < .3 ? 660 : 880) * local) * envelope * .22 * 32767), true);
  }
  return bytes;
}

/** Uses a separate layer so narration/music continue; once per action across reconnects. */
export function createForegroundAttention(failed: () => void) {
  return new ActionAlerts(async () => {
    const file = new File(Paths.cache, 'action-attention-v1.wav');
    if (!file.exists) file.write(attentionWave());
    await AudioScheduler.setLayer(LAYER, { uri: file.uri, loop: false, volume: 1 });
    return LAYER;
  }, async () => { await AudioScheduler.clearLayer(LAYER); }, failed);
}
