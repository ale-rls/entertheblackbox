import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { Scenario } from '@entertheblackbox/scenario';
import type { ShowManifest } from '@entertheblackbox/show-content';

/** Audit the same immutable bytes phones download, including every group override. */
export async function nativeAudioCoverage(scenario: Scenario, manifest: ShowManifest, mediaDir: string) {
  const results = new Map<string, Promise<string>>();
  const check = (src: string) => {
    if (!results.has(src)) results.set(src, (async () => {
      const file = manifest.files.find(file => file.src === src);
      if (!file) return 'Missing from phone download';
      const path = resolve(mediaDir, 'native-shows/audio', `${file.sha256}.mp3`);
      if (!path.startsWith(resolve(mediaDir) + sep)) return 'Invalid path';
      try {
        const bytes = await readFile(path);
        return bytes.length === file.bytes && createHash('sha256').update(bytes).digest('hex') === file.sha256
          ? 'Verified' : 'Corrupt file';
      } catch { return 'Missing file'; }
    })());
    return results.get(src)!;
  };
  const groups = scenario.groups?.length ? scenario.groups : [{ id: '', label: 'All participants' }];
  const rows = await Promise.all(scenario.phases.filter(p => p.kind !== 'idle').flatMap(phase => groups.map(async group => {
    const src = phase.kind === 'group-branch' ? phase.branches.find(b => b.groupId === group.id)?.phoneAudioSrc
      : phase.phoneAudioByGroup?.[group.id] ?? phase.phoneAudioSrc;
    return { phaseId: phase.id, group: group.label, src: src ?? null, state: src ? await check(src) : 'No audio assigned' };
  })));
  return { scenarioVersion: scenario.version, checkedAt: Date.now(), rows,
    background: manifest.backgroundMusic ? await check(manifest.backgroundMusic.src) : 'No background music' };
}
