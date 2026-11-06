/**
 * Relative trackpad for curtain-light votes. The native app reports where
 * the finger is on its control; here each touch moves the cursor by how far
 * the finger travels, starting from wherever the cursor already is. That
 * lets a cursor enter at a neutral point and be steered from there.
 *
 * A new touch is either flagged by the app (`touch: "start"`) or inferred
 * from a pause in samples. Re-anchoring after a pause while the finger is
 * still down is harmless: the anchor is the finger's current position, so
 * the cursor does not jump.
 */
export const TOUCH_PAUSE_MS = 150;

type Anchor = { fingerX: number; fingerY: number; cursorX: number; cursorY: number; lastAt: number };

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

export class RelativeTrackpad {
  private readonly anchors = new Map<string, Anchor>();

  constructor(private readonly gain = 1) {}

  reset(): void {
    this.anchors.clear();
  }

  forget(participantId: string): void {
    this.anchors.delete(participantId);
  }

  /** Begin a touch: future samples move relative to this finger and cursor position. */
  anchor(participantId: string, fingerX: number, fingerY: number, cursor: { x: number; y: number }, now: number): void {
    this.anchors.set(participantId, { fingerX, fingerY, cursorX: cursor.x, cursorY: cursor.y, lastAt: now });
  }

  /** Where the cursor goes for this finger sample. */
  move(
    participantId: string,
    fingerX: number,
    fingerY: number,
    cursor: { x: number; y: number },
    now: number,
    touchStart: boolean,
  ): { x: number; y: number } {
    const anchor = this.anchors.get(participantId);
    if (touchStart || anchor === undefined || now - anchor.lastAt > TOUCH_PAUSE_MS) {
      this.anchor(participantId, fingerX, fingerY, cursor, now);
      return { x: cursor.x, y: cursor.y };
    }
    anchor.lastAt = now;
    return {
      x: clamp(anchor.cursorX + (fingerX - anchor.fingerX) * this.gain),
      y: clamp(anchor.cursorY + (fingerY - anchor.fingerY) * this.gain),
    };
  }
}
