import type { SurfaceMessage } from '@entertheblackbox/protocol';

/** What the show-mode surface currently shows. `seq` guards against late or reordered messages. */
export type SurfaceView = {
  base: string;
  flash: { color: string; label?: string; endsAt: number | null } | null;
  seq: number;
};
export const initialSurface: SurfaceView = { base: '#000000', flash: null, seq: 0 };

/** Never wait longer than this for a scheduled change; protects against a bad clock estimate. */
export const MAX_SURFACE_DELAY_MS = 1_000;

/** Local delay before applying a message, from the shared server clock. Uncalibrated clocks apply at once. */
export function surfaceDelay(applyAt: number, serverNow: number, calibrated: boolean): number {
  if (!calibrated || !Number.isFinite(applyAt) || !Number.isFinite(serverNow)) return 0;
  return Math.min(MAX_SURFACE_DELAY_MS, Math.max(0, applyAt - serverNow));
}

export function applySurface(view: SurfaceView, message: SurfaceMessage, localNow: number): SurfaceView {
  if (message.seq <= view.seq) return view;
  if (message.mode === 'set') return { ...view, base: message.color, seq: message.seq };
  if (message.mode === 'release') return { ...view, flash: null, seq: message.seq };
  return { ...view, seq: message.seq, flash: {
    color: message.color,
    ...(message.label ? { label: message.label } : {}),
    endsAt: message.holdMs === undefined ? null : localNow + message.holdMs,
  } };
}

/** Drop a timed flash once it has run out. */
export function expireSurface(view: SurfaceView, localNow: number): SurfaceView {
  return view.flash?.endsAt != null && view.flash.endsAt <= localNow ? { ...view, flash: null } : view;
}

export function visibleSurface(view: SurfaceView): { color: string; label?: string } {
  return view.flash ? { color: view.flash.color, ...(view.flash.label ? { label: view.flash.label } : {}) } : { color: view.base };
}

/** Pick black or white text for legibility on an arbitrary surface colour. */
export function contrastText(hex: string): '#000000' | '#ffffff' {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return '#ffffff';
  const [r, g, b] = match.slice(1).map(part => parseInt(part, 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.25 ? '#000000' : '#ffffff';
}
