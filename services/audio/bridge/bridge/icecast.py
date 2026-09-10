"""Icecast admin poller: per-mount listener counts -> Registry.

Polls /admin/stats (XML) every poll_interval_s. Mount names follow the
liquidsoap contract /p/{player_id}.mp3.
"""

from __future__ import annotations

import asyncio
import logging
import xml.etree.ElementTree as ET

import httpx

from .config import Settings
from .state import Registry

log = logging.getLogger("bridge.icecast")

MOUNT_PREFIX = "/p/"
MOUNT_SUFFIX = ".mp3"


def parse_listener_counts(stats_xml: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    root = ET.fromstring(stats_xml)
    for source in root.iter("source"):
        mount = source.get("mount", "")
        if not (mount.startswith(MOUNT_PREFIX) and mount.endswith(MOUNT_SUFFIX)):
            continue
        pid = mount[len(MOUNT_PREFIX) : -len(MOUNT_SUFFIX)]
        counts[pid] = int(source.findtext("listeners") or 0)
    return counts


async def poll_forever(settings: Settings, registry: Registry) -> None:
    url = f"http://{settings.icecast_host}:{settings.icecast_port}/admin/stats"
    auth = (settings.icecast_admin_user, settings.icecast_admin_password)
    async with httpx.AsyncClient(timeout=5.0) as client:
        while True:
            try:
                resp = await client.get(url, auth=auth)
                resp.raise_for_status()
                registry.update_listeners(parse_listener_counts(resp.text))
            except Exception as exc:  # keep polling through outages
                log.warning("icecast poll failed: %s", exc)
            await asyncio.sleep(settings.poll_interval_s)
