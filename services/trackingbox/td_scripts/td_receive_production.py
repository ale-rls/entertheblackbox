"""Production cue receiver. Call start(token), then pump() each TD frame.

Uses only Python's standard library. Network work runs in a daemon thread;
all TouchDesigner operators are accessed by pump() on the main thread.
"""
import json
import queue
import threading
import urllib.request

URL = 'https://bb-frontend.enabler.space/api/cues'
_client = None


def events(lines):
    """Parse SSE records, including UTF-8 and multi-line data."""
    data = []
    for raw in lines:
        line = raw.decode('utf-8').rstrip('\r\n')
        if not line:
            if data:
                yield json.loads('\n'.join(data))
                data = []
        elif line.startswith('data:'):
            data.append(line[5:].removeprefix(' '))


def label_rows(timelines):
    rows = []
    for timeline, event in sorted(timelines.items()):
        phase = event.get('payload', {}).get('phase', {})
        field = phase.get('field', {})
        labels = []
        if field.get('type') == 'two-quadrant':
            axis = field.get('axis', 'x')
            labels = [(axis + '_' + pole, field.get('labels', {}).get(pole + 'Label', ''))
                      for pole in ('min', 'max')]
        elif field.get('type') == 'four-quadrant':
            labels = [(axis + '_' + pole, field.get(axis + 'Axis', {}).get(pole + 'Label', ''))
                      for axis in ('x', 'y') for pole in ('min', 'max')]
        elif field.get('type') == 'polygon-zones':
            labels = [(zone['id'], zone['label']) for zone in field.get('zones', [])]
        for slot, text in labels:
            rows.append([timeline + ':' + slot, timeline, slot, text, event.get('phaseId', '')])
    return rows


class State:
    def __init__(self):
        self.boot = None
        self.sequence = -1
        self.timelines = {}

    def apply(self, event):
        if event.get('version') != 1:
            raise ValueError('Unsupported cue protocol')
        boot, sequence = event['bootId'], event['sequence']
        if event['type'] == 'snapshot':
            self.boot, self.sequence = boot, sequence
            self.timelines = {item['timelineId']: item for item in event['timelines']}
            return None
        if boot != self.boot:
            raise ValueError('Snapshot required after server restart')
        if sequence <= self.sequence:
            return None
        if sequence != self.sequence + 1:
            raise ValueError('Cue gap; reconnect required')
        self.sequence = sequence
        kind = event['type']
        if kind == 'reset':
            self.timelines.clear()
        elif kind == 'phase':
            self.timelines[event['timelineId']] = event
        elif kind == 'result':
            current = self.timelines.get(event['timelineId'])
            if current and current.get('phaseEpoch') == event.get('phaseEpoch'):
                current['payload']['result'] = event['payload']
        elif kind == 'cue':
            return event
        return None


class Receiver:
    def __init__(self, token):
        self.token = token
        self.pending = queue.Queue(maxsize=512)
        self.stopped = threading.Event()
        self.state = State()
        self.status = 'connecting'
        self.thread = threading.Thread(target=self.read, daemon=True)
        self.thread.start()

    def read(self):
        delay = 1
        while not self.stopped.is_set():
            try:
                request = urllib.request.Request(URL, headers={
                    'Authorization': 'Bearer ' + self.token,
                    'Accept': 'text/event-stream',
                    'Accept-Encoding': 'identity',
                })
                with urllib.request.urlopen(request, timeout=25) as response:
                    if response.headers.get_content_type() != 'text/event-stream':
                        raise ValueError('Expected SSE response')
                    self.status = 'connected'
                    delay = 1
                    for event in events(response):
                        if self.stopped.is_set():
                            return
                        try:
                            self.pending.put_nowait(event)
                        except queue.Full:
                            # A stopped TD frame loop must not replay minutes of old cues.
                            while True:
                                try:
                                    self.pending.get_nowait()
                                except queue.Empty:
                                    break
                            raise ValueError('Receiver overflow; resynchronizing')
                self.status = 'reconnecting (stream closed)'
            except Exception as error:
                # Do not expose request headers or credentials in a DAT/log.
                self.status = 'reconnecting (' + type(error).__name__ + ')'
            if self.stopped.wait(delay):
                return
            delay = min(delay * 2, 10)


def start(token=None):
    """Call on TD start. Token may come from a private one-cell DAT."""
    global _client
    stop()
    if token is None:
        token = str(op('display_token')[0, 0])
    if not token or '\n' in token or '\r' in token:
        raise ValueError('Set the production DISPLAY_TOKEN in display_token')
    _client = Receiver(token)


def stop():
    global _client
    client = globals().get('_client')
    if client is not None:
        client.stopped.set()
    _client = None


def _replace(name, headers, rows):
    table = op(name)
    if table is None:
        raise ValueError('Create Table DAT: ' + name)
    table.clear()
    table.appendRow(headers)
    for row in rows:
        table.appendRow(row)


def pump(on_cue=None):
    """Call in Execute DAT onFrameStart; optional on_cue(event) runs here."""
    client = globals().get('_client')
    if client is None:
        return
    changed = False
    for _ in range(512):
        try:
            event = client.pending.get_nowait()
        except queue.Empty:
            break
        try:
            cue = client.state.apply(event)
        except (ValueError, KeyError, TypeError):
            start(client.token)
            return
        changed = True
        if cue is not None and on_cue is not None:
            on_cue(cue)
    if changed:
        _replace('labels', ['key', 'timeline', 'slot', 'text', 'phase_id'],
                 label_rows(client.state.timelines))
        _replace('timelines', ['timeline', 'phase_id', 'payload_json'], [
            [name, event.get('phaseId', ''), json.dumps(event['payload'], ensure_ascii=False)]
            for name, event in sorted(client.state.timelines.items())])
    _replace('cue_status', ['key', 'value'], [
        ['connection', client.status], ['boot_id', client.state.boot or ''],
        ['sequence', client.state.sequence]])
