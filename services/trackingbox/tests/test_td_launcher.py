"""TouchDesigner launcher command construction without a TouchDesigner runtime."""

from __future__ import annotations

import os
import runpy
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "td_scripts" / "td_launch_tracker.py"


def _command(preset: dict[str, str]) -> list[str]:
    launcher = runpy.run_path(str(SCRIPT))
    return launcher["_command_from_preset"](
        preset,
        os.path.normpath("/show/enter-the-blackbox"),
        os.path.normpath("/show/enter-the-blackbox/services/trackingbox/.venv/tracker"),
    )


def test_default_source_is_touchdesigner_rtsp() -> None:
    command = _command({})

    source_index = command.index("--source")
    assert command[source_index + 1] == "rtsp://127.0.0.1:8554/audience"
    assert "--no-reid" in command


def test_preset_passes_venue_config_and_reid() -> None:
    command = _command(
        {
            "config": "apps/runner/dev/trackingbox.config.json",
            "reid": "1",
        }
    )

    config_index = command.index("--config")
    assert command[config_index + 1] == os.path.normpath(
        "/show/enter-the-blackbox/apps/runner/dev/trackingbox.config.json"
    )
    assert "--no-reid" not in command
