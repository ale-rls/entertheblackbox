"""Load into a Text DAT named question_monitor beside timelines."""
import json
import math
import time


def display_text(phase, now_ms, countdown_seconds=5):
    if phase.get('kind') != 'position-question':
        return ''
    deadline = phase.get('deadlineAt')
    if deadline is not None:
        remaining = max(0, math.ceil((deadline - now_ms) / 1000))
        if remaining <= countdown_seconds:
            return str(remaining) if remaining > 0 else ''
    return phase.get('text', '')


def text(timeline='ki', frame=None):
    # The Text TOP passes absTime.frame to force evaluation every frame.
    table = op('timelines')
    if table is None:
        return ''
    cell = table[timeline, 'payload_json']
    if cell is None:
        return ''
    try:
        phase = json.loads(str(cell)).get('phase', {})
        return display_text(phase, time.time() * 1000)
    except (ValueError, TypeError):
        return ''
