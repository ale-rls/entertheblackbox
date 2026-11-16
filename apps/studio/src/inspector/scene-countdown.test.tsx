import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { compileStudioGraph, parseRuntimeScenario } from '@entertheblackbox/studio-adapter';
import scenario from '../../../../content/scenarios/dev.json';
import manifest from '../../../../content/media-manifest.json';
import { Inspector } from './Inspector.js';

it('edits a video scene countdown in seconds and keeps it through the adapter', () => {
  const project = parseRuntimeScenario({ ...scenario,
    phases: scenario.phases.map(p => p.id === 'intro-video' ? { ...p, expectedDurationMs: 30000, countdown: { startAtMs: 2000, endAtMs: 27000, pingSeconds: 5 } } : p),
  }, manifest);
  const noop = vi.fn();
  const html = renderToStaticMarkup(<Inspector project={project} selectedId="intro-video" localMedia={[]}
    onRename={noop} onChange={noop} onChooseMedia={noop} onComponentTypeChange={noop}
    onTransitionChange={noop} onQuestionLayoutChange={noop} onTargetAudienceSizeChange={noop} onGroupsChange={noop} />);
  expect(html).toContain('<legend>Countdown</legend>');
  expect(html).toMatch(/Starts after \(seconds\)<\/span><input[^>]*value="2"/);
  expect(html).toMatch(/Length \(seconds\)<\/span><input[^>]*value="25"/);
  expect(html).toMatch(/Ping in the last[^<]*<\/span><input[^>]*value="5"/);
  const compiled = compileStudioGraph(project);
  expect(compiled.scenario.phases.find(p => p.id === 'intro-video')).toMatchObject({ countdown: { startAtMs: 2000, endAtMs: 27000, pingSeconds: 5 } });
});
