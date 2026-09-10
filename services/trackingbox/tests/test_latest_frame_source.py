"""A slow detector must not stop capture or accumulate stale live video."""

import threading

import pytest

from audience_tracker.ingestion.frame_source import LatestFrameSource, QueueFrameSource
from audience_tracker.models import Frame


def test_slow_consumer_gets_latest_frame_and_end_of_stream():
    upstream = QueueFrameSource(maxsize=20)
    for fid in range(10):
        upstream.push(Frame(image=None, timestamp=float(fid), frame_id=fid, width=1, height=1))
    upstream.release()
    source = LatestFrameSource(upstream)
    source._thread.join(timeout=2)
    assert not source._thread.is_alive()
    assert source.next_frame(timeout=0).frame_id == 9
    assert source.next_frame(timeout=0) is None
    assert source.exhausted
    source.release()


def test_capture_exception_reaches_consumer():
    class Broken:
        released = False

        def next_frame(self, timeout=None):
            raise ValueError("decoder failure")

        def release(self):
            self.released = True

    upstream = Broken()
    source = LatestFrameSource(upstream)
    source._thread.join(timeout=2)
    with pytest.raises(RuntimeError, match="Live video capture failed"):
        source.next_frame(timeout=0)
    assert upstream.released


def test_release_does_not_race_blocked_capture_read():
    class Blocking:
        exhausted = False

        def __init__(self):
            self.entered = threading.Event()
            self.unblock = threading.Event()
            self.released = threading.Event()

        def next_frame(self, timeout=None):
            self.entered.set()
            self.unblock.wait(timeout=5)
            return None

        def release(self):
            self.released.set()

    upstream = Blocking()
    source = LatestFrameSource(upstream)
    try:
        assert upstream.entered.wait(timeout=2)
        source.release()
        assert not upstream.released.is_set()
    finally:
        upstream.unblock.set()
        source._thread.join(timeout=2)
    assert upstream.released.is_set()
    assert not source._thread.is_alive()
