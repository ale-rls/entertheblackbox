import AudioScheduler from '@entertheblackbox/expo-audio-scheduler';
import { File, Paths } from 'expo-file-system';
import { countdownWave, type CountdownSound } from './countdown-sound';

const LAYER = 'monitor-countdown';
/** Plays countdown sounds on their own layer so narration and music continue underneath. */
export function playCountdownSound(sound: CountdownSound): Promise<void> {
  const file = new File(Paths.cache, `countdown-${sound}-v1.wav`);
  if (!file.exists) file.write(countdownWave(sound));
  return AudioScheduler.setLayer(LAYER, { uri: file.uri, loop: false, volume: 1 });
}
