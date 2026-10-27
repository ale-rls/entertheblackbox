import { z } from 'zod';

export const channelSchema = z.enum(['rehearsal', 'production']);
export const mediaPathSchema = z.string().min(1).max(512).refine(value =>
  !/[\\:?#%\x00-\x1f]/.test(value) && !value.startsWith('/') &&
  value.split('/').every(part => part !== '' && part !== '.' && part !== '..') && /\.mp3$/i.test(value),
  'Expected a relative MP3 path');
export const backgroundMusicSchema = z.object({ src: mediaPathSchema, volume: z.number().positive().max(1) });
export type BackgroundMusic = z.infer<typeof backgroundMusicSchema>;
export const showManifestSchema = z.object({
  format: z.literal(1),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  scenarioVersion: z.string().min(1),
  backgroundMusic: backgroundMusicSchema.optional(),
  files: z.array(z.object({
    src: mediaPathSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    // Keep verification memory bounded on older phones; split longer recordings.
    bytes: z.number().int().positive().max(64 * 1024 * 1024),
  })).max(2000),
}).superRefine((value, ctx) => {
  if (value.backgroundMusic && !value.files.some(f => f.src === value.backgroundMusic!.src))
    ctx.addIssue({ code: 'custom', message: 'Background music must be included in downloaded files' });
  if (new Set(value.files.map(f => f.src)).size !== value.files.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate media paths' });
});
export type ShowManifest = z.infer<typeof showManifestSchema>;
export type ShowChannel = z.infer<typeof channelSchema>;
export function mediaUrl(origin: string, src: string): string {
  return `${origin}/media/${src.split('/').map(encodeURIComponent).join('/')}`;
}
export function serverOrigin(input: string): string {
  const url = new URL(input.trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) throw new Error('Enter a server origin, such as https://show.example.org');
  return url.origin;
}

/** Stable content identity, excluding the revision itself. */
export function manifestPayload(manifest: Pick<ShowManifest, 'format' | 'scenarioVersion' | 'files' | 'backgroundMusic'>): string {
  return JSON.stringify({ format: manifest.format, scenarioVersion: manifest.scenarioVersion,
    files: manifest.files.map(({ src, sha256, bytes }) => ({ src, sha256, bytes })),
    ...(manifest.backgroundMusic ? { backgroundMusic: { src: manifest.backgroundMusic.src, volume: manifest.backgroundMusic.volume } } : {}) });
}
