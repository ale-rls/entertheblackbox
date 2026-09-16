import unittest
from pathlib import Path
from unittest.mock import Mock, patch
import td_receive_production as consumer
from td_receive_production import State, events, label_rows


def event(kind, sequence, **extra):
    return dict(version=1, bootId='boot', sequence=sequence, type=kind,
                timelineId='ki', phaseId='q', phaseEpoch=2, payload={}, **extra)


class CueTests(unittest.TestCase):
    def test_execute_loader_retains_class_and_state_between_callbacks(self):
        root = Path(__file__).parent
        source = Mock(text=(root / 'td_receive_production.py').read_text(), path='/receiver')
        storage = {}
        owner = Mock()
        owner.fetch.side_effect = lambda key, default=None, **kwargs: storage.get(key, default)
        owner.store.side_effect = lambda key, value: storage.update({key: value})
        component = Mock()
        component.op.return_value = { (0, 0): 'test-token' }
        env = {'me': owner, 'parent': lambda: component, 'op': lambda name: source}
        exec((root / 'td_cue_execute.py').read_text(), env, env)
        with patch('threading.Thread.start'):
            env['onStart']()
            first = storage['cue_namespace']['_client']
            self.assertIsInstance(first, storage['cue_namespace']['Receiver'])
            env['onStart']()
            self.assertTrue(first.stopped.is_set())
        env['onExit']()
        env['onFrameStart'](1)
        self.assertIsNone(storage['cue_namespace'])

    def test_callbacks_with_missing_client_global(self):
        consumer.__dict__.pop('_client', None)
        consumer.pump()
        consumer.stop()
        self.assertIsNone(consumer._client)
        consumer.__dict__.pop('_client', None)
        receiver = Mock()
        with patch.object(consumer, 'Receiver', return_value=receiver):
            consumer.start('test-token')
        self.assertIs(consumer._client, receiver)
        consumer.stop()
        receiver.stopped.set.assert_called_once()

    def test_sse_unicode_and_heartbeat(self):
        self.assertEqual(list(events([b': heartbeat\n', b'\n',
            'data: {"text": "Nähe"}\r\n'.encode(), b'\r\n'])), [{'text': 'Nähe'}])

    def test_reconnect_restores_labels_without_replaying_cues(self):
        state = State()
        phase = event('phase', 1)
        phase['payload'] = {'phase': {'field': {'type': 'two-quadrant', 'axis': 'x',
            'labels': {'minLabel': 'Low', 'maxLabel': 'High'}}}}
        snapshot = event('snapshot', 2, timelines=[phase])
        self.assertIsNone(state.apply(snapshot))
        self.assertEqual(label_rows(state.timelines)[0], ['ki:x_min', 'ki', 'x_min', 'Low', 'q'])
        cue = event('cue', 3)
        self.assertEqual(state.apply(cue), cue)
        self.assertIsNone(state.apply(cue))
        state.apply(event('snapshot', 0, timelines=[] ) | {'bootId': 'new-boot'})
        self.assertEqual(label_rows(state.timelines), [])

    def test_reset_and_gap(self):
        state = State()
        state.apply(event('snapshot', 0, timelines=[]))
        state.apply(event('phase', 1))
        state.apply(event('reset', 2))
        self.assertEqual(state.timelines, {})
        with self.assertRaises(ValueError):
            state.apply(event('phase', 4))


if __name__ == '__main__':
    unittest.main()
