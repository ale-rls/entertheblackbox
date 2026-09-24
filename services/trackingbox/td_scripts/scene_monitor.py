"""Text DAT scene_monitor: phase-driven text for four physical monitors."""
import json
import math
import time


def _labels(phase):
    field = phase.get('field', {})
    kind = field.get('type')
    if kind == 'two-quadrant':
        axis = field.get('axis', 'x')
        return {axis + '_' + pole: field.get('labels', {}).get(pole + 'Label', '')
                for pole in ('min', 'max')}
    if kind == 'four-quadrant':
        return {axis + '_' + pole: field.get(axis + 'Axis', {}).get(pole + 'Label', '')
                for axis in ('x', 'y') for pole in ('min', 'max')}
    if kind == 'polygon-zones':
        return {zone['id']: zone['label'] for zone in field.get('zones', [])}
    return {}


def render(phase, config, monitor, now_ms):
    """Pure renderer. Timers use server phase start, never local cue receipt."""
    scene = config.get('scenes', {}).get(phase.get('id'))
    if scene is not None:
        message = scene.get('messages', {}).get(monitor, '')
        timer = scene.get('timer')
        if timer is None or monitor not in timer.get('monitors', []):
            return message
        start = phase.get('startedAt')
        if not isinstance(start, (int, float)) or not math.isfinite(start):
            return message
        offset = timer.get('offsetMs', 0)
        duration = timer['durationMs']
        if duration <= 0 or offset < 0:
            raise ValueError('Timer duration must be positive and offset nonnegative')
        if now_ms < start + offset:
            return message
        remaining = max(0, math.ceil((start + offset + duration - now_ms) / 1000))
        if remaining == 0:
            return message
        clock = '{}:{:02d}'.format(remaining // 60, remaining % 60)
        return message + '\n' + clock if message else clock

    setting = config.get('monitors', {}).get(monitor, {})
    mode = setting.get('mode', 'blank')
    if mode == 'axis-auto':
        slot = setting.get('slot')
        if slot not in ('x_min', 'x_max', 'y_min', 'y_max'):
            raise ValueError('axis-auto requires one physical axis slot')
        if phase.get('kind') != 'position-question':
            return ''
        field = phase.get('field', {})
        if field.get('type') == 'two-quadrant':
            if slot[0] == field.get('axis', 'x'):
                return _labels(phase).get(slot, '')
            mode = 'question'
        elif field.get('type') == 'four-quadrant':
            # Both axes vote: all four monitors retain their endpoint labels.
            return _labels(phase).get(slot, '')
        else:
            # Polygon/circle fields need explicit scene or zone assignments.
            return ''
    if mode == 'question':
        if phase.get('kind') != 'position-question':
            return ''
        deadline = phase.get('deadlineAt')
        if deadline is not None:
            remaining = max(0, math.ceil((deadline - now_ms) / 1000))
            if remaining <= 5:
                return str(remaining) if remaining > 0 else ''
        return phase.get('text', '')
    if mode == 'labels':
        labels = _labels(phase)
        return '\n'.join(labels[slot] for slot in setting.get('slots', []) if labels.get(slot))
    if mode == 'blank':
        return ''
    raise ValueError('Unknown monitor mode: ' + str(mode))


def text(monitor, frame=None):
    """Use module.text('M1', absTime.frame) in a Text TOP expression."""
    try:
        config = json.loads(op('monitor_config').text)
        table = op('timelines')
        cell = table[config['timeline'], 'payload_json'] if table is not None else None
        if cell is None:
            return ''
        phase = json.loads(str(cell)).get('phase', {})
        return render(phase, config, monitor, time.time() * 1000)
    except (AttributeError, KeyError, ValueError, TypeError, OverflowError):
        # Visible diagnostic instead of silently retaining a previous scene.
        return 'MONITOR CONFIG ERROR'


def join_index(phase, enabled=True):
    """Switch TOP: input 0 is monitor text; input 1 is the live join screen."""
    return int(enabled and phase.get('kind') == 'idle')


def output_index(frame=None):
    """Read the main lobby phase independently of the group text timeline."""
    try:
        config = json.loads(op('monitor_config').text)
        lobby = config.get('joinDisplay', {})
        if not lobby.get('enabled', False):
            return 0
        table = op('timelines')
        cell = table[lobby.get('timeline', 'main'), 'payload_json'] if table is not None else None
        if cell is None:
            return 0
        return join_index(json.loads(str(cell)).get('phase', {}))
    except (AttributeError, KeyError, ValueError, TypeError):
        return 0
