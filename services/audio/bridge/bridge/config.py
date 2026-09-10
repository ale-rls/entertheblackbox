"""Bridge configuration from environment variables.

Player provisioning mirrors liquidsoap/main.liq: PLAYER_IDS (comma list)
wins if set, otherwise PLAYERS=<count> provisions ids "1".."<count>".
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

PLAYER_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
BED_NAME_RE = PLAYER_ID_RE  # same character contract


def _player_ids() -> list[str]:
    ids_env = os.environ.get("PLAYER_IDS", "").strip()
    if ids_env:
        ids = [p.strip() for p in ids_env.split(",") if p.strip()]
    else:
        ids = [str(i + 1) for i in range(int(os.environ.get("PLAYERS", "100")))]
    for pid in ids:
        if not PLAYER_ID_RE.match(pid):
            raise ValueError(f"player id {pid!r} must match {PLAYER_ID_RE.pattern}")
    return ids


@dataclass(frozen=True)
class Settings:
    liq_host: str = "liquidsoap"
    liq_port: int = 1234
    icecast_host: str = "icecast"
    icecast_port: int = 8000
    icecast_admin_user: str = "admin"
    icecast_admin_password: str = ""
    # where THIS process sees the audio/bed files (for validation)
    audio_dir: Path = Path("/audio")
    beds_dir: Path = Path("/beds")
    # where LIQUIDSOAP sees the same files (for push URIs)
    liq_audio_dir: str = "/audio"
    liq_beds_dir: str = "/beds"
    # public bridge URL phones use for gateway streams, e.g. http://10.0.0.2:8300
    public_stream_base: str = ""
    token: str = ""  # empty = auth disabled (dev only)
    poll_interval_s: float = 5.0
    # claimed player with zero listeners for longer than this => flagged
    flag_after_s: float = 20.0
    # Bound authenticated uploads so a bad caller cannot fill the volume or
    # exhaust bridge memory. ElevenLabs narration files are normally far smaller.
    max_audio_upload_bytes: int = 20 * 1024 * 1024
    enable_docs: bool = True
    player_ids: tuple[str, ...] = field(default_factory=tuple)

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            liq_host=os.environ.get("LIQUIDSOAP_HOST", cls.liq_host),
            liq_port=int(os.environ.get("LIQUIDSOAP_PORT", cls.liq_port)),
            icecast_host=os.environ.get("ICECAST_HOST", cls.icecast_host),
            icecast_port=int(os.environ.get("ICECAST_PORT", cls.icecast_port)),
            icecast_admin_user=os.environ.get("ICECAST_ADMIN_USER", cls.icecast_admin_user),
            icecast_admin_password=os.environ.get("ICECAST_ADMIN_PASSWORD", ""),
            audio_dir=Path(os.environ.get("AUDIO_DIR", str(cls.audio_dir))),
            beds_dir=Path(os.environ.get("BEDS_DIR", str(cls.beds_dir))),
            liq_audio_dir=os.environ.get("LIQ_AUDIO_DIR", cls.liq_audio_dir),
            liq_beds_dir=os.environ.get("LIQ_BEDS_DIR", cls.liq_beds_dir),
            public_stream_base=os.environ.get("PUBLIC_STREAM_BASE", "").rstrip("/"),
            token=os.environ.get("BRIDGE_TOKEN", ""),
            poll_interval_s=float(os.environ.get("POLL_INTERVAL_S", cls.poll_interval_s)),
            flag_after_s=float(os.environ.get("FLAG_AFTER_S", cls.flag_after_s)),
            max_audio_upload_bytes=int(
                float(os.environ.get("MAX_AUDIO_UPLOAD_MB", "20")) * 1024 * 1024
            ),
            enable_docs=os.environ.get("ENABLE_DOCS", "true").lower()
            in {"1", "true", "yes", "on"},
            player_ids=tuple(_player_ids()),
        )
