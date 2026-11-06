import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { mediaUrl, manifestPayload, showManifestSchema, type ShowManifest, type ShowChannel } from '@entertheblackbox/show-content';

async function parseManifest(value: unknown): Promise<ShowManifest> {
  const manifest = showManifestSchema.parse(value);
  const revision = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, manifestPayload(manifest));
  if (revision !== manifest.revision) throw new Error('Show manifest integrity check failed');
  return manifest;
}

const root = new Directory(Paths.document, 'shows');
function ensureRoot() { root.create({ intermediates: true, idempotent: true }); }
export const localAudio = (sha256: string) => new File(root, `${sha256}.mp3`);
async function digest(file: File): Promise<string> {
  const bytes = await file.bytes();
  const result = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return Array.from(new Uint8Array(result)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function verified(file: File, expected: ShowManifest['files'][number]) {
  return file.exists && file.size === expected.bytes && await digest(file) === expected.sha256;
}
async function selectionKey(origin: string, channel: ShowChannel) {
  return 'show.' + await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${origin}:${channel}`);
}
export async function loadShow(origin: string, channel: ShowChannel): Promise<ShowManifest | null> {
  ensureRoot();
  const revision = await SecureStore.getItemAsync(await selectionKey(origin, channel));
  if (!revision || !/^[a-f0-9]{64}$/.test(revision)) return null;
  const file = new File(root, `${revision}.json`);
  if (!file.exists) return null;
  const manifest = await parseManifest(JSON.parse(await file.text()));
  for (const entry of manifest.files) if (!await verified(localAudio(entry.sha256), entry)) return null;
  return manifest;
}
// Expo wraps Android transport errors in a JS Error containing the native cause.
const interrupted = /timeout|timed out|network (?:request failed|lost|error|is unreachable)|SSLProtocolException|SocketException|UnknownHostException|ConnectException|unexpected end of stream|connection (?:reset|closed|refused|lost)|internet connection appears to be offline/i;
async function transfer<T>(label: string, progress: (text: string) => void, read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      console.warn(`Show download: ${label}, attempt ${attempt}`, error);
      if (!interrupted.test(String(error))) {
        progress('Download stopped');
        throw new Error(`Could not download ${label}. Ask the operator to check the published show and available device storage.`);
      }
      if (attempt === 4) {
        progress('Download paused');
        throw new Error(`Could not finish downloading ${label}. Check your connection and try again. Completed audio files are saved.`);
      }
      progress(`Connection interrupted. Retrying ${label} (attempt ${attempt + 1} of 4)…`);
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }
}
export async function downloadShow(origin: string, channel: ShowChannel, progress: (text: string) => void): Promise<ShowManifest> {
  ensureRoot();
  const response = await transfer('the show list', progress, () => fetch(`${origin}/media/native-shows/channels/${channel}.json?check=${Date.now()}`));
  if (!response.ok) throw new Error(`Show channel unavailable (${response.status}). Publish this channel on the venue server first.`);
  const manifest = await parseManifest(await response.json());
  let index = 0;
  for (const entry of manifest.files) {
    progress(`Verifying audio ${++index}/${manifest.files.length}`);
    const final = localAudio(entry.sha256);
    if (await verified(final, entry)) continue;
    const temporary = new File(root, `${entry.sha256}.download`);
    try {
      const label = `audio file ${index} of ${manifest.files.length}`;
      await transfer(label, progress, async () => {
        if (temporary.exists) temporary.delete();
        progress(`Downloading ${label}`);
        await File.downloadFileAsync(mediaUrl(origin, `native-shows/audio/${entry.sha256}.mp3`), temporary, { idempotent: true });
      });
      if (!await verified(temporary, entry)) throw new Error(`Audio verification failed: ${entry.src}`);
      if (final.exists) final.delete();
      temporary.move(final);
    } catch (error) { if (temporary.exists) temporary.delete(); throw error; }
  }
  // Existing installed show remains selected until every replacement asset verifies.
  const destination = new File(root, `${manifest.revision}.json`);
  destination.write(JSON.stringify(manifest));
  await SecureStore.setItemAsync(await selectionKey(origin, channel), manifest.revision);
  return manifest;
}

// ------------------------------------------------------------- video wall slices

const wallRoot = new Directory(Paths.document, 'wall');
/**
 * Download and verify this tablet's video wall slice (size and SHA-256), kept
 * by hash so a re-load of the same clip is instant. Other slices are deleted
 * to free storage once the new one verifies.
 */
export async function downloadWallSlice(origin: string, slice: { url: string; bytes: number; sha256: string }): Promise<string> {
  wallRoot.create({ intermediates: true, idempotent: true });
  const final = new File(wallRoot, `${slice.sha256}.mp4`);
  const expected = { bytes: slice.bytes, sha256: slice.sha256 } as ShowManifest['files'][number];
  if (!await verified(final, expected)) {
    const temporary = new File(wallRoot, `${slice.sha256}.download`);
    try {
      await transfer('the video wall slice', () => {}, async () => {
        if (temporary.exists) temporary.delete();
        await File.downloadFileAsync(`${origin}${slice.url}`, temporary, { idempotent: true });
      });
      if (!await verified(temporary, expected)) throw new Error('Video wall slice verification failed. Check the uploaded file in the media library.');
      if (final.exists) final.delete();
      temporary.move(final);
    } catch (error) { if (temporary.exists) temporary.delete(); throw error; }
  }
  for (const entry of wallRoot.list()) if (entry instanceof File && entry.name !== final.name && !entry.name.endsWith('.download')) entry.delete();
  return final.uri;
}
