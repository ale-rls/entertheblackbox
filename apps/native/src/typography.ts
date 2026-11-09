/** Optik ships as three static faces; expo-font registers each under its own family name. */
export const OPTIK_FAMILIES = { regular: 'Optik', bold: 'Optik-Bold', italic: 'Optik-Italic' } as const;

type FontStyle = { fontWeight?: string | number | null; fontStyle?: string | null };

function isBold(weight: FontStyle['fontWeight']): boolean {
  if (weight === 'bold') return true;
  const numeric = typeof weight === 'number' ? weight : Number(weight);
  return Number.isFinite(numeric) && numeric >= 600;
}

/**
 * The Optik face for a text style. Custom families do not synthesize weight or
 * slant reliably on Android, so the matching static face is chosen and the
 * weight reset. Optik has no bold italic; bold wins.
 */
export function optikFace(style: FontStyle): { fontFamily: string; fontWeight: 'normal'; fontStyle: 'normal' } {
  const family = isBold(style.fontWeight) ? OPTIK_FAMILIES.bold : style.fontStyle === 'italic' ? OPTIK_FAMILIES.italic : OPTIK_FAMILIES.regular;
  return { fontFamily: family, fontWeight: 'normal', fontStyle: 'normal' };
}
