import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { compileStudioGraph, parseRuntimeScenario } from '@entertheblackbox/studio-adapter';
import scenario from '../../../../content/scenarios/dev.json';
import manifest from '../../../../content/media-manifest.json';
import { Inspector } from './Inspector.js';

it('edits tablet light cues on a video scene and keeps them through the adapter', () => {
  const surfaceCues = [
    { atMs: 1500, action: 'start', effect: { kind: 'gradient', color: '#ff8800', color2: '#0044ff', periodMs: 1200, brightness: 0.6 } },
    { atMs: 4000, action: 'stop' },
  ];
  const project = parseRuntimeScenario({ ...scenario,
    phases: scenario.phases.map(p => p.id === 'intro-video' ? { ...p, surfaceCues } : p),
  }, manifest);
  const noop = vi.fn();
  const html = renderToStaticMarkup(<Inspector project={project} selectedId="intro-video" localMedia={[]}
    onRename={noop} onChange={noop} onChooseMedia={noop} onComponentTypeChange={noop}
    onTransitionChange={noop} onQuestionLayoutChange={noop} onTargetAudienceSizeChange={noop} onGroupsChange={noop} />);
  expect(html).toContain('<legend>Tablet lights</legend>');
  expect(html).toMatch(/At \(seconds from scene start\)<\/span><input[^>]*value="1.5"/);
  expect(html).toContain('value="gradient" selected=""');
  expect(html).toContain('value="#0044ff"');
  expect(html).toMatch(/Brightness \(%\)<\/span><input[^>]*value="60"/);
  expect(html).toContain('value="stop" selected=""');
  const compiled = compileStudioGraph(project);
  expect(compiled.scenario.phases.find(p => p.id === 'intro-video')).toMatchObject({ surfaceCues });
});
