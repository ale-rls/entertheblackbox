import unittest
from question_monitor import display_text


class QuestionMonitorTests(unittest.TestCase):
    def test_countdown_boundaries_and_result_hold(self):
        phase = {'kind': 'position-question', 'text': 'Question?', 'deadlineAt': 25000}
        times = [0, 19999, 20000, 21000, 24000, 25000, 30000]
        self.assertEqual([display_text(phase, t) for t in times],
                         ['Question?', 'Question?', '5', '4', '1', '0', '0'])

    def test_reconnect_uses_current_deadline(self):
        phase = {'kind': 'position-question', 'text': 'Restored', 'deadlineAt': 25000}
        self.assertEqual(display_text(phase, 22000), '3')

    def test_missing_deadline_and_non_question(self):
        self.assertEqual(display_text({'kind': 'position-question', 'text': 'Title'}, 0), 'Title')
        self.assertEqual(display_text({'kind': 'video', 'title': 'Video'}, 0), '')
        self.assertEqual(display_text({}, 0), '')


if __name__ == '__main__':
    unittest.main()
