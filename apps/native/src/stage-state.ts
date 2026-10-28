import type { ClockTiming } from '@entertheblackbox/protocol';
import type { Snapshot } from './cues';
import type { Groups, Voting } from './action-prompt';

export type StageInput = {
  connected: boolean; busy: boolean; status: string; error: string; audioStatus: string;
  paused: boolean; snapshot: Snapshot | null; voting: Voting | null; groups: Groups | null; now: number;
};
export function playbackState(timing: ClockTiming) {
  return {
    playing: timing.media.some(layer => layer.state === 'playing'),
    paused: timing.media.some(layer => layer.state === 'paused') && !timing.media.some(layer => layer.state === 'playing'),
  };
}
/** Presentation priority is independent of the server-owned phase/branch selection. */
export function stageState(s: StageInput) {
  const p = s.snapshot?.phase;
  const active = !!p && s.now >= p.startedAt && (p.deadlineAt === null || s.now < p.deadlineAt) &&
    s.snapshot?.participantState !== 'finished' && s.snapshot?.participantState !== 'unassigned';
  const voting = s.voting?.sessionId === s.snapshot?.sessionId && s.voting?.phaseEpoch === s.snapshot?.phaseEpoch ? s.voting : null;
  const groups = s.groups?.sessionId === s.snapshot?.sessionId && s.groups?.phaseEpoch === s.snapshot?.phaseEpoch ? s.groups : null;
  const admitted = s.connected && s.status === 'Connected';
  const canAct = admitted && active;
  const rating = p && 'rating' in p ? p.rating : null;
  const ratingOpen = !!(canAct && rating && (!rating.windows || rating.windows.some(w => s.now - p!.startedAt >= w.startAtMs && s.now - p!.startedAt < w.endAtMs)));
  const cursorOpen = !!(canAct && p && ((p.kind === 'idle' || p.kind === 'video') || (voting?.method === 'phone-cursor' && !voting.closed)) &&
    (!('showCursors' in p) || p.showCursors !== false));
  const controls = { canAct, cursorOpen, ratingOpen, voting, groups };
  const screen = (title: string, body: string) => ({ ...controls, title, body });
  if (!s.connected) {
    if (s.error) return screen('Something needs attention', 'Check the details below, then try again.');
    if (s.busy) return screen(s.status.includes('app update') ? 'Updating the app' : 'Getting ready', s.status);
    if (s.status.startsWith('Show ended')) return screen('Thank you for being here', 'You can take off your headphones.');
    if (s.status.startsWith('Ready:')) return screen('Audio is ready', 'Joining checks the latest show before you enter.');
    return screen('Welcome inside', 'Put on your headphones. Enter your name when you’re ready.');
  }
  if (s.status.startsWith('Join rejected')) return screen('Unable to join', 'Ask a member of the team for help, or return to setup.');
  if (!admitted) return screen(s.status.includes('retrying') || s.snapshot ? 'Reconnecting' : 'Joining the room',
    s.snapshot ? 'Local audio may continue. New cues and answers need a connection.' : 'Your audio is ready. Waiting for admission.');
  if (s.audioStatus.startsWith('Playback error') || s.audioStatus.startsWith('Missing downloaded') || s.audioStatus.startsWith('Show changed'))
    return screen('Audio needs attention', s.audioStatus);
  if (s.paused) return screen('Your audio is paused', 'The performance is continuing. Resume at the current show position.');
  if (s.snapshot?.participantState === 'finished') return screen('Stay with the room', 'Your part is complete. Follow the main screen.');
  if (s.snapshot?.participantState === 'unassigned') return screen('Waiting for your group', 'The performance will continue here when you’re assigned.');
  if (groups && canAct) return screen('Choose your group', 'Follow the instruction in the room.');
  if (voting) return screen(voting.closed || !active ? 'Voting has closed' : voting.question,
    voting.closed || !active ? 'Look at the main screen for what happens next.' : voting.method === 'physical' ? 'Move to your answer in the room.' : voting.method === 'phone-cursor' ? 'Drag your cursor to your answer on the main screen.' : 'Choose your answer.');
  if (!p || p.kind === 'idle') return screen('You’re in', 'Keep your headphones on. The performance will begin shortly.');
  if (p.kind === 'video' || p.kind === 'video-position-question') return screen('Look at the screen', 'Follow the film on the main screen.');
  if (p.kind === 'group-branch') return screen('Follow your group', 'Listen to the instruction for your assigned group.');
  if (p.kind === 'narration') return screen('Listen closely', p.text ?? 'Stay with the room.');
  return screen('Stay with the room', 'Follow the main screen.');
}
