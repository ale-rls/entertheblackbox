import { beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const storage = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), keys: new Map<string, string>(), downloads: new Map<string, string>() }));
vi.mock('expo-file-system', () => {
  class Directory { uri: string; constructor(...parts: any[]) { this.uri = parts.map(p => p.uri ?? p).join('/'); } create() {} }
  class File {
    uri: string; constructor(...parts: any[]) { this.uri = parts.map(p => p.uri ?? p).join('/'); }
    get exists() { return storage.files.has(this.uri); } get size() { return storage.files.get(this.uri)?.length ?? 0; }
    async bytes() { return storage.files.get(this.uri)!; } async text() { return new TextDecoder().decode(await this.bytes()); }
    write(text: string) { storage.files.set(this.uri, new TextEncoder().encode(text)); }
    delete() { storage.files.delete(this.uri); }
    move(destination: File) { storage.files.set(destination.uri, storage.files.get(this.uri)!); this.delete(); this.uri = destination.uri; }
    static async downloadFileAsync(url: string, file: File) { const data = storage.downloads.get(url); if (!data) throw new Error('Network lost'); file.write(data); return file; }
  }
  return { Directory, File, Paths: { document: 'documents' } };
});
vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digest: async (_: unknown, data: Uint8Array) => { const b = createHash('sha256').update(data).digest(); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
  digestStringAsync: async (_: unknown, data: string) => createHash('sha256').update(data).digest('hex') }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async (key: string) => storage.keys.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { storage.keys.set(key, value); } }));
import { downloadShow, loadShow, localAudio } from './content';
import { manifestPayload } from '@entertheblackbox/show-content';
const origin = 'https://venue.test';
function release(text: string) {
  const sha256 = createHash('sha256').update(text).digest('hex');
  storage.downloads.set(`${origin}/media/native-shows/audio/${sha256}.mp3`, text);
  const data = { format: 1 as const, scenarioVersion: 'one', files: [{ src: 'voice.mp3', sha256, bytes: text.length }] };
  return { ...data, revision: createHash('sha256').update(manifestPayload(data)).digest('hex') };
}
beforeEach(() => { storage.files.clear(); storage.keys.clear(); storage.downloads.clear(); vi.unstubAllGlobals(); });
it('retains verified audio after moving the temporary download and restores it offline', async () => {
  const manifest = release('old audio'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => manifest }));
  await downloadShow(origin, 'rehearsal', () => {});
  expect(localAudio(manifest.files[0]!.sha256).exists).toBe(true);
  expect(await loadShow(origin, 'rehearsal')).toEqual(manifest);
  expect(await loadShow(origin, 'production')).toBeNull();
});
it('keeps the previous show selected after a corrupt replacement download', async () => {
  const a = release('old audio'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => a }));
  await downloadShow(origin, 'rehearsal', () => {});
  const b = release('new audio'); storage.downloads.set(`${origin}/media/native-shows/audio/${b.files[0]!.sha256}.mp3`, 'bad audio');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => b }));
  await expect(downloadShow(origin, 'rehearsal', () => {})).rejects.toThrow('verification failed');
  expect(await loadShow(origin, 'rehearsal')).toEqual(a);
});
it('detects corruption on device before allowing the saved show', async () => {
  const a = release('old audio'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => a }));
  await downloadShow(origin, 'rehearsal', () => {}); localAudio(a.files[0]!.sha256).write('corrupted');
  expect(await loadShow(origin, 'rehearsal')).toBeNull();
});

it('rejects a manifest whose revision does not match its contents', async () => {
  const manifest = { ...release('audio'), revision: '0'.repeat(64) };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => manifest }));
  await expect(downloadShow(origin, 'rehearsal', () => {})).rejects.toThrow('manifest integrity');
  expect(await loadShow(origin, 'rehearsal')).toBeNull();
});
