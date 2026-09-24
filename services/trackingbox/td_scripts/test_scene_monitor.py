import unittest
from unittest.mock import patch
import scene_monitor as monitor


class SceneMonitorTests(unittest.TestCase):
    def setUp(self):
        self.config = {'timeline': 'ki', 'monitors': {
            'M1': {'mode': 'labels', 'slots': ['y_min']},
            'M2': {'mode': 'labels', 'slots': ['x_min']},
            'M3': {'mode': 'question'},
            'M4': {'mode': 'labels', 'slots': ['x_max']}},
            'scenes': {'scene': {'messages': {'M1': 'Theme A', 'M2': 'Theme B'},
                'timer': {'durationMs': 60000, 'offsetMs': 2000,
                          'monitors': ['M1', 'M2', 'M3', 'M4']}}, 'clear': {}}}
        self.phase = {'id': 'scene', 'kind': 'narration', 'startedAt': 10000}

    def test_full_countdown_hides_zero_and_preserves_theme(self):
        self.assertEqual([monitor.render(self.phase, self.config, 'M1', t)
                          for t in [10000, 12000, 13000, 71500, 72000, 90000]],
                         ['Theme A', 'Theme A\n1:00', 'Theme A\n0:59',
                          'Theme A\n0:01', 'Theme A', 'Theme A'])

    def test_expired_countdown_only_is_blank(self):
        for now in [72000, 90000]:
            self.assertEqual(monitor.render(self.phase, self.config, 'M4', now), '')

    def test_two_minutes_video_and_different_monitor_messages(self):
        self.config['scenes']['scene']['timer']['durationMs'] = 120000
        self.phase['kind'] = 'video'
        self.assertEqual(monitor.render(self.phase, self.config, 'M2', 12000), 'Theme B\n2:00')
        self.assertEqual(monitor.render(self.phase, self.config, 'M4', 12000), '2:00')

    def test_reconnect_does_not_restart_and_next_phase_clears(self):
        self.assertEqual(monitor.render(dict(self.phase), self.config, 'M1', 42000), 'Theme A\n0:30')
        self.assertEqual(monitor.render({'id': 'clear'}, self.config, 'M1', 42000), '')
        self.assertEqual(monitor.render({'id': 'other', 'kind': 'narration'}, self.config, 'M1', 42000), '')

    def test_label_axes_and_polygon_rings(self):
        p = {'field': {'type': 'two-quadrant', 'axis': 'x',
                      'labels': {'minLabel': 'Low', 'maxLabel': 'High'}}}
        self.assertEqual(monitor.render(p, self.config, 'M2', 0), 'Low')
        self.assertEqual(monitor.render(p, self.config, 'M1', 0), '')
        p['field']['axis'] = 'y'
        self.assertEqual(monitor.render(p, self.config, 'M1', 0), 'Low')
        self.assertEqual(monitor.render(p, self.config, 'M2', 0), '')
        p['field'] = {'type': 'polygon-zones', 'zones': [{'id': 'centre', 'label': 'Centre'}]}
        self.config['monitors']['M1']['slots'] = ['centre']
        self.assertEqual(monitor.render(p, self.config, 'M1', 0), 'Centre')

    def test_question_legacy_behavior_and_scene_override(self):
        p = {'id': 'q', 'kind': 'position-question', 'text': 'Question', 'deadlineAt': 10000}
        self.assertEqual(monitor.render(p, self.config, 'M3', 0), 'Question')
        self.assertEqual(monitor.render(p, self.config, 'M3', 5000), '5')
        p['id'] = 'clear'
        self.assertEqual(monitor.render(p, self.config, 'M3', 5000), '')

    def test_static_messages_and_missing_start_do_not_invent_timer(self):
        self.config['scenes']['static'] = {'messages': {'M1': 'Centre / edge'}}
        self.assertEqual(monitor.render({'id': 'static'}, self.config, 'M1', 0), 'Centre / edge')
        self.assertEqual(monitor.render({'id': 'static'}, self.config, 'M2', 0), '')
        self.assertEqual(monitor.render({'id': 'scene'}, self.config, 'M1', 0), 'Theme A')

    def test_four_axis_labels_and_invalid_timer(self):
        phase = {'field': {'type': 'four-quadrant',
                          'xAxis': {'minLabel': 'Left', 'maxLabel': 'Right'},
                          'yAxis': {'minLabel': 'Top', 'maxLabel': 'Bottom'}}}
        self.assertEqual(monitor.render(phase, self.config, 'M1', 0), 'Top')
        self.assertEqual(monitor.render(phase, self.config, 'M4', 0), 'Right')
        self.config['scenes']['scene']['timer']['durationMs'] = -1
        with self.assertRaises(ValueError):
            monitor.render(self.phase, self.config, 'M1', 10000)

    def test_text_reads_only_authoritative_timeline_and_reports_bad_config(self):
        import json
        from types import SimpleNamespace
        from collections import defaultdict
        table = defaultdict(lambda: None, {('ki', 'payload_json'): json.dumps({'phase': self.phase}),
                 ('other', 'payload_json'): json.dumps({'phase': {'id': 'clear'}})})
        ops = {'monitor_config': SimpleNamespace(text=json.dumps(self.config)), 'timelines': table}
        with patch.object(monitor, 'op', ops.get, create=True), patch.object(monitor.time, 'time', return_value=42):
            self.assertEqual(monitor.text('M1', 1), 'Theme A\n0:30')
            table.clear()
            self.assertEqual(monitor.text('M1', 2), '')
            ops['monitor_config'].text = '{'
            self.assertEqual(monitor.text('M1', 3), 'MONITOR CONFIG ERROR')


class AutomaticAxisTests(unittest.TestCase):
    def setUp(self):
        self.config = {'monitors': {name: {'mode': 'axis-auto', 'slot': slot}
                       for name, slot in zip(['M1', 'M2', 'M3', 'M4'],
                                             ['y_min', 'x_min', 'y_max', 'x_max'])}}
        self.phase = {'id': 'q', 'kind': 'position-question', 'text': 'Question?',
                      'deadlineAt': 10000, 'field': {'type': 'two-quadrant', 'axis': 'x',
                      'labels': {'minLabel': 'Low', 'maxLabel': 'High'}}}

    def outputs(self, now):
        return [monitor.render(self.phase, self.config, m, now)
                for m in ['M1', 'M2', 'M3', 'M4']]

    def test_x_then_y_swap_question_countdown_and_keep_extremes(self):
        for axis, question_slots in [('x', [0, 2]), ('y', [1, 3])]:
            self.phase['field']['axis'] = axis
            for now, text in [(0, 'Question?'), (4999, 'Question?'), (5000, '5'),
                              (6000, '4'), (9000, '1'), (10000, ''), (12000, '')]:
                with self.subTest(axis=axis, now=now):
                    result = self.outputs(now)
                    self.assertEqual([result[i] for i in question_slots], [text, text])
                    self.assertEqual([v for i, v in enumerate(result) if i not in question_slots],
                                     ['Low', 'High'])

    def test_no_deadline_clearing_four_axis_and_scene_override(self):
        self.phase['deadlineAt'] = None
        self.assertEqual(self.outputs(50000), ['Question?', 'Low', 'Question?', 'High'])
        self.phase['kind'] = 'narration'
        self.assertEqual(self.outputs(0), ['', '', '', ''])
        self.phase['kind'] = 'position-question'
        self.phase['field'] = {'type': 'four-quadrant',
                              'xAxis': {'minLabel': 'Left', 'maxLabel': 'Right'},
                              'yAxis': {'minLabel': 'Top', 'maxLabel': 'Bottom'}}
        self.assertEqual(self.outputs(0), ['Top', 'Left', 'Bottom', 'Right'])
        self.phase['field'] = {'type': 'polygon-zones', 'zones': []}
        self.assertEqual(self.outputs(0), ['', '', '', ''])
        self.config['scenes'] = {'q': {'messages': {'M1': 'Theme'}}}
        self.assertEqual(self.outputs(0), ['Theme', '', '', ''])

    def test_invalid_physical_slot_is_an_error(self):
        self.config['monitors']['M1']['slot'] = 'centre'
        with self.assertRaises(ValueError):
            self.outputs(0)


class JoinDisplayTests(unittest.TestCase):
    def test_only_idle_selects_join_video(self):
        for kind in ['idle', 'position-question', 'video', 'narration', 'group-branch', None]:
            self.assertEqual(monitor.join_index({'kind': kind}), int(kind == 'idle'))
        self.assertEqual(monitor.join_index({'kind': 'idle'}, enabled=False), 0)

    def test_main_lobby_is_independent_of_group_and_reset_clears(self):
        import json
        from collections import defaultdict
        from types import SimpleNamespace
        config = {'timeline': 'ki', 'joinDisplay': {'enabled': True, 'timeline': 'main'}}
        table = defaultdict(lambda: None)
        table['main', 'payload_json'] = json.dumps({'phase': {'kind': 'idle'}})
        table['ki', 'payload_json'] = json.dumps({'phase': {'kind': 'position-question'}})
        ops = {'monitor_config': SimpleNamespace(text=json.dumps(config)), 'timelines': table}
        with patch.object(monitor, 'op', ops.get, create=True):
            self.assertEqual(monitor.output_index(1), 1)
            table['main', 'payload_json'] = json.dumps({'phase': {'kind': 'group-branch'}})
            self.assertEqual(monitor.output_index(2), 0)
            table.clear()
            self.assertEqual(monitor.output_index(3), 0)
            # Reconnect snapshot restores the lobby selection.
            table['main', 'payload_json'] = json.dumps({'phase': {'kind': 'idle'}})
            self.assertEqual(monitor.output_index(4), 1)
            ops['monitor_config'].text = '{}'
            self.assertEqual(monitor.output_index(5), 0)
            ops['monitor_config'].text = '{'
            self.assertEqual(monitor.output_index(6), 0)


if __name__ == '__main__':
    unittest.main()
