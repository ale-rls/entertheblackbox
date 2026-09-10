"""OpenCVFrameSource resilience: live sources retry and reopen on failed reads;
file sources still report end-of-stream. Uses a scripted stand-in for cv2 so it
runs on machines without OpenCV.
"""

from __future__ import annotations

import os
import sys
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import pytest  # noqa: E402

np = pytest.importorskip("numpy")

from audience_tracker.ingestion.frame_source import OpenCVFrameSource  # noqa: E402

IMG = np.zeros((4, 4, 3), dtype=np.uint8)


class FakeCapture:
    """Scriptable cv2.VideoCapture: read() pops an image or None (= failure)."""

    def __init__(self, reads, opened=True):
        self._reads = list(reads)
        self._opened = opened
        self.released = False

    def isOpened(self):
        return self._opened

    def set(self, prop, value):
        pass

    def read(self):
        if not self._reads:
            return False, None
        item = self._reads.pop(0)
        return (True, item) if item is not None else (False, None)

    def release(self):
        self.released = True


def fake_cv2(captures):
    """cv2 stub whose VideoCapture() hands out the pre-scripted captures."""
    mod = types.ModuleType("cv2")
    mod.CAP_PROP_FRAME_WIDTH = 3
    mod.CAP_PROP_FRAME_HEIGHT = 4
    mod.CAP_PROP_FPS = 5
    mod.CAP_FFMPEG = 1900
    mod.CAP_PROP_OPEN_TIMEOUT_MSEC = 53
    mod.CAP_PROP_READ_TIMEOUT_MSEC = 54
    mod.calls = []
    pending = list(captures)
    def capture(*args):
        mod.calls.append(args)
        return pending.pop(0)
    mod.VideoCapture = capture
    return mod


def make_source(monkeypatch, captures, src):
    monkeypatch.setitem(sys.modules, "cv2", fake_cv2(captures))
    monkeypatch.setattr(OpenCVFrameSource, "_RETRY_DELAY_S", 0.0)
    monkeypatch.setattr(OpenCVFrameSource, "_REOPEN_AFTER", 3)
    return OpenCVFrameSource(src)


def test_live_camera_read_failure_is_transient(monkeypatch):
    src = make_source(monkeypatch, [FakeCapture([IMG, None, IMG])], "0")
    assert src.next_frame().frame_id == 0
    assert src.next_frame() is None        # transient failure, no frame
    assert src.exhausted is False          # ...but NOT end-of-stream
    assert src.next_frame().frame_id == 1  # next read recovers


def test_live_camera_reopens_after_repeated_failures(monkeypatch):
    dead = FakeCapture([None] * 3)
    fresh = FakeCapture([IMG])
    src = make_source(monkeypatch, [dead, fresh], "0")
    for _ in range(3):
        assert src.next_frame() is None
    assert dead.released is True           # reopened after _REOPEN_AFTER failures
    assert src.next_frame() is not None    # the new capture delivers
    assert src.exhausted is False


def test_live_rtsp_can_start_before_publisher_and_reconnect(monkeypatch):
    missing = FakeCapture([], opened=False)
    live = FakeCapture([IMG])
    src = make_source(monkeypatch, [missing, live], "rtsp://127.0.0.1:8554/audience")

    assert src.next_frame() is None
    assert missing.released is True
    assert src.next_frame() is not None
    assert src.exhausted is False
    cv2 = sys.modules["cv2"]
    assert cv2.calls[0][1:] == (cv2.CAP_FFMPEG, [
        cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 4000,
        cv2.CAP_PROP_READ_TIMEOUT_MSEC, 4000,
    ])


def test_rtsp_stall_reopens_on_first_failed_read(monkeypatch):
    stalled = FakeCapture([IMG, None])
    fresh = FakeCapture([IMG])
    src = make_source(monkeypatch, [stalled, fresh], "rtsp://localhost/audience")
    assert src.next_frame().frame_id == 0
    assert src.next_frame() is None
    assert stalled.released
    assert src.next_frame().frame_id == 1


def test_missing_file_still_fails_at_startup(monkeypatch):
    monkeypatch.setitem(sys.modules, "cv2", fake_cv2([FakeCapture([], opened=False)]))
    with pytest.raises(RuntimeError, match="Could not open video source"):
        OpenCVFrameSource("missing.mp4")


def test_file_source_read_failure_means_eof(monkeypatch):
    src = make_source(monkeypatch, [FakeCapture([IMG, None])], "clip.mp4")
    assert src.next_frame() is not None
    assert src.next_frame() is None
    assert src.exhausted is True


def test_http_url_defaults_to_finite(monkeypatch):
    # http(s) can host a finite clip: EOF must terminate, not replay forever.
    src = make_source(monkeypatch, [FakeCapture([IMG, None])], "http://host/clip.mp4")
    assert src.next_frame() is not None
    assert src.next_frame() is None
    assert src.exhausted is True


def test_explicit_live_overrides_heuristic(monkeypatch):
    monkeypatch.setitem(sys.modules, "cv2", fake_cv2([FakeCapture([None, IMG])]))
    monkeypatch.setattr(OpenCVFrameSource, "_RETRY_DELAY_S", 0.0)
    src = OpenCVFrameSource("http://host/mjpeg", live=True)  # e.g. MJPEG camera
    assert src.next_frame() is None
    assert src.exhausted is False
    assert src.next_frame() is not None
