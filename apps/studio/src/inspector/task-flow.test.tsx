import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { parseRuntimeScenario } from '@entertheblackbox/studio-adapter';
import scenario from '../../../../content/scenarios/dev.json';
import manifest from '../../../../content/media-manifest.json';
import { Inspector } from './Inspector.js';

it('exposes a video task and its persistent personal routes, including cyclic follow-ups', () => {
  const project = parseRuntimeScenario({ ...scenario,
    phases: scenario.phases.map(p => p.id === 'intro-video' ? { ...p, taskId: 'choice' } : p),
    participantTasks: [{ id: 'choice', title: 'Choose work', question: 'Which work?', notificationBody: 'Choose',
      groupIds: ['ki'], durationMs: 60000, persistAcrossPhases: true,
      audio: { src: 'intro.mp3', durationMs: 1000 },
      options: [{ id: 'crew', label: 'Crew', groupId: 'crew', roleId: 'crew-role', capacity: 5,
        audio: { src: 'crew.mp3', durationMs: 2000 }, nextTaskId: 'choice' }] }],
  }, manifest);
  const noop = vi.fn();
  const html = renderToStaticMarkup(<Inspector project={project} selectedId="intro-video" localMedia={[]}
    onRename={noop} onChange={noop} onChooseMedia={noop} onComponentTypeChange={noop}
    onTransitionChange={noop} onQuestionLayoutChange={noop} onTargetAudienceSizeChange={noop} onGroupsChange={noop} />);
  expect(html).toContain('Participant task and operator gate');
  expect(html).toContain('value="choice" selected=""');
  expect(html).toContain('Task flow choice');
  expect(html).toContain('Continues across scenes.');
  expect(html).toContain('Introduction audio: intro.mp3');
  expect(html).toContain('Assign group: crew');
  expect(html).toContain('Maximum accepted: 5');
  expect(html).toContain('Outcome audio: crew.mp3');
  expect(html).toContain('Returns to task: Choose work (choice)');
});
