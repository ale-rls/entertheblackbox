import { describe, expect, it } from 'vitest';
import { STAFF_CLOSED, staffAssign, staffOpen, staffPinInput, staffReply, staffUnlock } from './staff-menu';

describe('staff menu state', () => {
  it('unlocks with a PIN, shows picks and reports the assignment', () => {
    let s = staffPinInput(staffOpen(), '24a68');
    expect(s.pin).toBe('2468');
    s = staffUnlock(s); expect(s.step).toBe('unlocking');
    s = staffReply(s, { t: 'staff_menu', v: 2, ok: true, message: '', picks: [{ id: 'vector', label: 'VECTOR' }] });
    expect(s).toMatchObject({ step: 'menu', picks: [{ id: 'vector' }] });
    s = staffReply(staffAssign(s), { t: 'staff_assign_result', v: 2, ok: true, message: 'Assigned: VECTOR' });
    expect(s).toMatchObject({ step: 'menu', ok: true, message: 'Assigned: VECTOR' });
  });

  it('clears a wrong PIN, refuses short PINs and ignores replies once closed', () => {
    expect(staffUnlock(staffPinInput(staffOpen(), '12')).message).toBe('Enter the staff PIN.');
    const wrong = staffReply(staffUnlock(staffPinInput(staffOpen(), '1111')), { t: 'staff_menu', v: 2, ok: false, message: 'Wrong PIN.', picks: [] });
    expect(wrong).toMatchObject({ step: 'pin', pin: '', message: 'Wrong PIN.' });
    expect(staffReply(STAFF_CLOSED, { t: 'staff_assign_result', v: 2, ok: true, message: 'x' })).toBe(STAFF_CLOSED);
  });
});
