import type { StaffAssignResultMessage, StaffMenuMessage } from '@entertheblackbox/protocol';

/** Tablet staff menu: PIN entry, then the show's staff picks for this tablet. The PIN is kept only while the menu is open. */
export type StaffMenuState = {
  step: 'closed' | 'pin' | 'unlocking' | 'menu' | 'assigning';
  pin: string;
  picks: Array<{ id: string; label: string }>;
  message: string;
  ok: boolean;
};
export const STAFF_CLOSED: StaffMenuState = { step: 'closed', pin: '', picks: [], message: '', ok: false };
export const STAFF_LONG_PRESS_MS = 2500;

export function staffOpen(): StaffMenuState { return { ...STAFF_CLOSED, step: 'pin' }; }
export function staffPinInput(state: StaffMenuState, text: string): StaffMenuState {
  return { ...state, pin: text.replace(/\D/g, '').slice(0, 12), message: '' };
}
export function staffUnlock(state: StaffMenuState): StaffMenuState {
  return state.pin.length >= 4 ? { ...state, step: 'unlocking', message: '' } : { ...state, message: 'Enter the staff PIN.' };
}
export function staffAssign(state: StaffMenuState): StaffMenuState { return { ...state, step: 'assigning', message: '' }; }
export function staffReply(state: StaffMenuState, reply: StaffMenuMessage | StaffAssignResultMessage): StaffMenuState {
  if (state.step === 'closed') return state;
  if (reply.t === 'staff_menu') return reply.ok
    ? { ...state, step: 'menu', picks: reply.picks, message: '', ok: true }
    : { ...state, step: 'pin', pin: '', picks: [], message: reply.message, ok: false };
  return { ...state, step: 'menu', message: reply.message, ok: reply.ok };
}
