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
export async function downloadShow(origin: string, channel: ShowChannel, progress: (text: string) => void): Promise<ShowManifest> {
  ensureRoot();
  const response = await fetch(`${origin}/media/native-shows/channels/${channel}.json?check=${Date.now()}`);
  if (!response.ok) throw new Error(`Show channel unavailable (${response.status}). Publish this channel on the venue server first.`);
  const manifest = await parseManifest(await response.json());
  let index = 0;
  for (const entry of manifest.files) {
    progress(`Verifying audio ${++index}/${manifest.files.length}`);
    const final = localAudio(entry.sha256);
    if (await verified(final, entry)) continue;
    const temporary = new File(root, `${entry.sha256}.download`);
    try {
      await File.downloadFileAsync(mediaUrl(origin, `native-shows/audio/${entry.sha256}.mp3`), temporary, { idempotent: true });
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
