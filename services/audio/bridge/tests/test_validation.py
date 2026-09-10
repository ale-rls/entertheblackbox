from pathlib import Path

import pytest
from fastapi import HTTPException

from bridge.app import resolve_audio_file, resolve_bed_dir


@pytest.fixture
def audio_dir(tmp_path: Path) -> Path:
    (tmp_path / "intro.mp3").write_bytes(b"x")
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "hidden.mp3").write_bytes(b"x")
    return tmp_path


def test_accepts_existing_basename(audio_dir):
    assert resolve_audio_file(audio_dir, "intro.mp3") == audio_dir / "intro.mp3"


@pytest.mark.parametrize(
    "bad", ["../intro.mp3", "sub/hidden.mp3", "/etc/passwd", "", "a/../intro.mp3"]
)
def test_rejects_paths(audio_dir, bad):
    with pytest.raises(HTTPException) as exc:
        resolve_audio_file(audio_dir, bad)
    assert exc.value.status_code == 400


def test_rejects_missing_file(audio_dir):
    with pytest.raises(HTTPException) as exc:
        resolve_audio_file(audio_dir, "nope.mp3")
    assert exc.value.status_code == 404


def test_bed_validation(tmp_path):
    bed = tmp_path / "forest"
    bed.mkdir()
    (bed / "loop.mp3").write_bytes(b"x")
    (tmp_path / "empty").mkdir()

    assert resolve_bed_dir(tmp_path, "forest") == bed
    for bad, code in [("../forest", 400), ("no such", 400), ("empty", 404), ("missing", 404)]:
        with pytest.raises(HTTPException) as exc:
            resolve_bed_dir(tmp_path, bad)
        assert exc.value.status_code == code
