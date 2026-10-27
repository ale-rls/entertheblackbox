import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishShow } from './publish.js';
import { mediaPathSchema, serverOrigin, showManifestSchema } from './index.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'native-show-')); roots.push(root);
  const scenario = JSON.parse(await readFile(new URL('../../../content/scenarios/dev.json', import.meta.url), 'utf8'));
  scenario.phases.push({ kind: 'narration', id: 'voice', text: 'Test', durationMs: 1000, next: 'idle', phoneAudioSrc: 'one.mp3', phoneAudioByGroup: { blue: 'two.mp3' } });
  await writeFile(join(root, 'scenario.json'), JSON.stringify(scenario));
  await writeFile(join(root, 'one.mp3'), 'test audio one'); await writeFile(join(root, 'two.mp3'), 'test audio two');
  return root;
}
describe('show publishing', () => {
  it('publishes all group variants and retains immutable audio across channel updates', async () => {
    const root = await fixture();
    const a = await publishShow(join(root, 'scenario.json'), root, 'rehearsal');
    expect(a.files.map(f => f.src)).toEqual(['one.mp3', 'two.mp3']);
    const original = a.files[0]!;
    await writeFile(join(root, 'one.mp3'), 'replacement');
    const b = await publishShow(join(root, 'scenario.json'), root, 'rehearsal');
    expect(b.revision).not.toBe(a.revision);
    expect(await readFile(join(root, 'native-shows/audio', `${original.sha256}.mp3`), 'utf8')).toBe('test audio one');
    expect(JSON.parse(await readFile(join(root, 'native-shows/channels/rehearsal.json'), 'utf8')).revision).toBe(b.revision);
    expect(showManifestSchema.parse(JSON.parse(await readFile(join(root, 'native-shows/releases', `${a.revision}.json`), 'utf8')))).toEqual(a);
  });
  it('does not promote an incomplete release', async () => {
    const root = await fixture();
    const a = await publishShow(join(root, 'scenario.json'), root, 'production');
    await rm(join(root, 'two.mp3'));
    await expect(publishShow(join(root, 'scenario.json'), root, 'production')).rejects.toThrow();
    expect(JSON.parse(await readFile(join(root, 'native-shows/channels/production.json'), 'utf8')).revision).toBe(a.revision);
  });
  it('rejects symlinks outside the media directory', async () => {
    const root = await fixture(); await rm(join(root, 'one.mp3'));
    await symlink('/etc/hosts', join(root, 'one.mp3'));
    await expect(publishShow(join(root, 'scenario.json'), root, 'production')).rejects.toThrow('escapes root');
  });
  it.each(['../x.mp3', '/x.mp3', 'a/../../x.mp3', 'https://x/a.mp3', '%2e%2e/x.mp3', 'a\\x.mp3'])('rejects unsafe path %s', path => {
    expect(mediaPathSchema.safeParse(path).success).toBe(false);
  });
  it('accepts only an origin without credentials, paths, or query data', () => {
    expect(serverOrigin('http://192.168.1.5:3000/')).toBe('http://192.168.1.5:3000');
    for (const value of ['ftp://host', 'https://user:secret@host', 'https://host/phone', 'https://host/?x=1']) expect(() => serverOrigin(value)).toThrow();
  });
});
it('publishes and hashes background music configuration and preserves the channel on a missing bed', async () => {
  const root = await fixture();
  await writeFile(join(root, 'bed.mp3'), 'audible music');
  const first = await publishShow(join(root, 'scenario.json'), root, 'rehearsal', { src: 'bed.mp3', volume: 0.2 });
  expect(first.backgroundMusic).toEqual({ src: 'bed.mp3', volume: 0.2 });
  expect(first.files.map(f => f.src)).toContain('bed.mp3');
  const second = await publishShow(join(root, 'scenario.json'), root, 'rehearsal', { src: 'bed.mp3', volume: 0.3 });
  expect(second.revision).not.toBe(first.revision);
  await expect(publishShow(join(root, 'scenario.json'), root, 'rehearsal', { src: 'absent.mp3', volume: 0.2 })).rejects.toThrow();
  expect(JSON.parse(await readFile(join(root, 'native-shows/channels/rehearsal.json'), 'utf8')).revision).toBe(second.revision);
  expect(showManifestSchema.safeParse({ ...first, backgroundMusic: { src: 'absent.mp3', volume: 0.2 } }).success).toBe(false);
  expect(showManifestSchema.safeParse({ ...first, backgroundMusic: { src: 'bed.mp3', volume: 0 } }).success).toBe(false);
});
