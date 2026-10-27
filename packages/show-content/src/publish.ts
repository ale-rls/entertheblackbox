import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scenarioSchema } from '@entertheblackbox/scenario';
import { channelSchema, mediaPathSchema, manifestPayload, showManifestSchema, type ShowManifest } from './index.js';

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export async function publishShow(scenarioFile: string, mediaDirectory: string, channel: string): Promise<ShowManifest> {
  const selectedChannel = channelSchema.parse(channel);
  const scenario = scenarioSchema.parse(JSON.parse(await readFile(scenarioFile, 'utf8')));
  const mediaRoot = await realpath(mediaDirectory);
  const sources = [...new Set(scenario.phases.flatMap(phase => {
    if (phase.kind === 'idle') return [];
    if (phase.kind === 'group-branch') return phase.branches.flatMap(b => b.phoneAudioSrc ? [b.phoneAudioSrc] : []);
    return [...(phase.phoneAudioSrc ? [phase.phoneAudioSrc] : []), ...Object.values(phase.phoneAudioByGroup ?? {})];
  }))].sort();
  const files: ShowManifest['files'] = [];
  // Immutable content-addressed files prevent an edited source corrupting an older show release.
  for (const src of sources) {
    mediaPathSchema.parse(src);
    const source = await realpath(resolve(mediaRoot, src));
    const rel = relative(mediaRoot, source);
    if (rel.startsWith(`..${sep}`) || rel === '..') throw new Error(`Media escapes root: ${src}`);
    const bytes = await readFile(source);
    const sha256 = hash(bytes);
    files.push({ src, sha256, bytes: bytes.length });
    const destination = resolve(mediaRoot, 'native-shows', 'audio', `${sha256}.mp3`);
    await mkdir(dirname(destination), { recursive: true });
    try { await writeFile(destination, bytes, { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (hash(await readFile(destination)) !== sha256) throw new Error(`Stored audio is corrupt: ${src}`);
  }
  const data = { format: 1 as const, scenarioVersion: scenario.version, files };
  const manifest = showManifestSchema.parse({ ...data, revision: hash(manifestPayload(data)) });
  const base = resolve(mediaRoot, 'native-shows');
  await mkdir(resolve(base, 'releases'), { recursive: true });
  await mkdir(resolve(base, 'channels'), { recursive: true });
  const body = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(resolve(base, 'releases', `${manifest.revision}.json`), body);
  const target = resolve(base, 'channels', `${selectedChannel}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, body);
  await rename(temporary, target); // Promote only after every asset is present.
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , scenario, media, channel] = process.argv;
  if (!scenario || !media || !channel) throw new Error('Usage: publish.ts <scenario.json> <media-directory> <rehearsal|production>');
  const result = await publishShow(scenario, media, channel);
  console.log(`Published ${result.files.length} audio files; ${channel} → ${result.revision}`);
}
