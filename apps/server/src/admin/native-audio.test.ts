import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { nativeAudioCoverage } from './native-audio.js';
import type { Scenario } from '@entertheblackbox/scenario';
it('distinguishes absent assignments, unpublished sources, missing bytes and corrupt bytes for each group', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'native-coverage-'));
  try {
    const bytes = Buffer.from('audio'); const sha256 = createHash('sha256').update(bytes).digest('hex');
    await mkdir(join(dir, 'native-shows/audio'), { recursive: true });
    const path = join(dir, 'native-shows/audio', `${sha256}.mp3`);
    const scenario = { version: 'one', groups: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], phases: [
      { id: 'first', kind: 'narration', phoneAudioSrc: 'voice.mp3', phoneAudioByGroup: { b: 'unknown.mp3' } },
      { id: 'second', kind: 'narration' },
    ] } as unknown as Scenario;
    const manifest = { format: 1 as const, revision: 'a'.repeat(64), scenarioVersion: 'one', files: [{ src: 'voice.mp3', sha256, bytes: bytes.length }] };
    expect((await nativeAudioCoverage(scenario, manifest, dir)).rows.map(r => r.state)).toEqual(['Missing file', 'Missing from phone download', 'No audio assigned', 'No audio assigned']);
    await writeFile(path, 'wrong');
    expect((await nativeAudioCoverage(scenario, manifest, dir)).rows[0]!.state).toBe('Corrupt file');
    await writeFile(path, bytes);
    expect((await nativeAudioCoverage(scenario, manifest, dir)).rows[0]!.state).toBe('Verified');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
