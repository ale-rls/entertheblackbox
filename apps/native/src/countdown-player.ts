import AudioScheduler from '@entertheblackbox/expo-audio-scheduler';
import { File, Paths } from 'expo-file-system';
import { countdownWave, type CountdownSound } from './countdown-sound';
import { decodeBase64, PING_MP3_BASE64 } from './ping-sound';

const LAYER = 'monitor-countdown';
/**
 * Plays countdown sounds on their own layer so narration and music continue underneath. A tick is
 * the main display's own ping, so the headphones sound like the room; the end tone stays generated.
 */
export function playCountdownSound(sound: CountdownSound): Promise<void> {
  const file = sound === 'tick'
    ? new File(Paths.cache, 'countdown-ping-v1.mp3')
    : new File(Paths.cache, `countdown-${sound}-v1.wav`);
  if (!file.exists) file.write(sound === 'tick' ? decodeBase64(PING_MP3_BASE64) : countdownWave(sound));
  return AudioScheduler.setLayer(LAYER, { uri: file.uri, loop: false, volume: 1 });
}
