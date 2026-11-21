import { anyMonitorCountdown } from '@entertheblackbox/scenario';
import type { Snapshot } from './cues';

/**
 * Audible monitor countdown: the app ticks once for each of the last
 * COUNTDOWN_TICK_SECONDS numbers the M1–M4 monitors count down and plays a
 * distinct tone when the count reaches zero.
 * Pure parts live here; App samples the server clock and plays the sound.
 */
export type CountdownSound = 'tick' | 'end';
export type CountdownSample = { at: number; seconds: number | null };

/** The KI side and the groups that come from it hear the countdown; cursor-voting (theater) groups do not. */
export function countdownAudible(s: Snapshot | null): boolean {
  if (!s || s.participantState === 'finished' || s.participantState === 'unassigned') return false;
  return s.currentGroup?.votingMethod !== 'phone-cursor';
}

/** The number the monitors show for this participant's scene, or null. */
export function countdownSeconds(s: Snapshot | null, now: number): number | null {
  return countdownAudible(s) ? anyMonitorCountdown(s!.phase, now) : null;
}

/** Only the last numbers tick, so a minute-long countdown is not a minute of beeping. */
export const COUNTDOWN_TICK_SECONDS = 5;

/** A sample gap longer than this (app suspended, clock jump) never produces an end tone. */
const END_GAP_MS = 1_500;

/** Which sound a new sample calls for: a tick for each new number, the end tone when 1 runs out. */
export function countdownSound(previous: CountdownSample | null, next: CountdownSample): CountdownSound | null {
  if (next.seconds !== null) return next.seconds !== previous?.seconds && next.seconds <= COUNTDOWN_TICK_SECONDS ? 'tick' : null;
  return previous?.seconds === 1 && next.at - previous.at < END_GAP_MS ? 'end' : null;
}

export class CountdownTicker {
  private previous: CountdownSample | null = null;
  constructor(private play: (sound: CountdownSound) => void) {}
  sample(at: number, seconds: number | null) {
    const sound = countdownSound(this.previous, { at, seconds });
    this.previous = { at, seconds };
    if (sound) this.play(sound);
  }
  reset() { this.previous = null; }
}

/** Short mono 16-bit PCM WAV of enveloped sine tones, generated locally: no show media or network. */
export function countdownWave(sound: CountdownSound): Uint8Array {
  const rate = 22050;
  // Tick: a short, dry blip. End: a longer, higher two-step tone that clearly says "now".
  const tones = sound === 'tick'
    ? [{ hz: 1000, start: 0, length: .07 }]
    : [{ hz: 880, start: 0, length: .16 }, { hz: 1320, start: .18, length: .42 }];
  const duration = Math.max(...tones.map(t => t.start + t.length));
  const count = Math.round(rate * duration);
  const bytes = new Uint8Array(44 + count * 2), view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  tag(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    let sample = 0;
    for (const tone of tones) {
      const local = t - tone.start;
      if (local < 0 || local >= tone.length) continue;
      const envelope = Math.min(1, local / .005, (tone.length - local) / Math.min(.05, tone.length / 2));
      sample += Math.sin(2 * Math.PI * tone.hz * local) * envelope;
    }
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * .3 * 32767), true);
  }
  return bytes;
}
