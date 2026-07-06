"""blackbox-icecast bridge — the only API the rest of the system talks to.

REST in, Liquidsoap telnet out; Icecast admin polled for listener state.
See SPEC §4.1 for the endpoint table and §8 for the observability model.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import icecast
from .config import BED_NAME_RE, Settings
from .liq import LiquidsoapClient, LiquidsoapError
from .state import Registry

log = logging.getLogger("bridge")


# -- request models --------------------------------------------------------

class PlayRequest(BaseModel):
    file: str
    mode: Literal["interrupt", "queue"] = "interrupt"


class BedRequest(BaseModel):
    bed: str


class ActiveRequest(BaseModel):
    active: bool


# -- validation ------------------------------------------------------------

def resolve_audio_file(audio_dir: Path, file: str) -> Path:
    """Basename-only file reference inside the mounted audio dir (SPEC §4.1:
    the bridge never accepts arbitrary paths or URLs)."""
    if not file or Path(file).name != file:
        raise HTTPException(400, "file must be a bare filename, no paths")
    path = audio_dir / file
    if not path.is_file():
        raise HTTPException(404, f"unknown audio file: {file}")
    return path


def resolve_bed_dir(beds_dir: Path, bed: str) -> Path:
    if not BED_NAME_RE.match(bed or ""):
        raise HTTPException(400, f"bed name must match {BED_NAME_RE.pattern}")
    path = beds_dir / bed
    if not path.is_dir() or not any(path.iterdir()):
        raise HTTPException(404, f"unknown or empty bed: {bed}")
    return path


# -- app factory -------------------------------------------------------------

def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings.from_env()
    registry = Registry(settings.player_ids, settings.flag_after_s)
    liq = LiquidsoapClient(settings.liq_host, settings.liq_port)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        poller = asyncio.create_task(icecast.poll_forever(settings, registry))
        try:
            yield
        finally:
            poller.cancel()
            await liq.close()

    app = FastAPI(title="blackbox-icecast bridge", lifespan=lifespan)
    app.state.settings = settings
    app.state.registry = registry
    app.state.liq = liq

    # -- auth ---------------------------------------------------------------

    async def require_token(request: Request) -> None:
        if not settings.token:
            return  # dev mode
        header = request.headers.get("authorization", "")
        if header != f"Bearer {settings.token}":
            raise HTTPException(401, "missing or invalid bearer token")

    def known_player(player_id: str) -> str:
        if player_id not in registry.players:
            raise HTTPException(404, f"unknown player: {player_id}")
        return player_id

    # -- control ------------------------------------------------------------

    @app.post("/players/{player_id}/play", dependencies=[Depends(require_token)])
    async def play(player_id: str, body: PlayRequest) -> dict:
        pid = known_player(player_id)
        resolve_audio_file(settings.audio_dir, body.file)
        queue = f"int_{pid}" if body.mode == "interrupt" else f"nar_{pid}"
        uri = f"{settings.liq_audio_dir}/{body.file}"
        try:
            rid = await liq.push(queue, uri)
        except LiquidsoapError as exc:
            raise HTTPException(502, str(exc)) from exc
        registry.record_push(pid, body.file, body.mode)
        log.info("play player=%s file=%s mode=%s rid=%s", pid, body.file, body.mode, rid)
        return {"player_id": pid, "file": body.file, "mode": body.mode, "rid": rid}

    @app.post("/players/{player_id}/bed", dependencies=[Depends(require_token)])
    async def set_bed(player_id: str, body: BedRequest) -> dict:
        pid = known_player(player_id)
        resolve_bed_dir(settings.beds_dir, body.bed)
        try:
            await liq.set_bed(f"bed_{pid}", f"{settings.liq_beds_dir}/{body.bed}")
        except LiquidsoapError as exc:
            raise HTTPException(502, str(exc)) from exc
        registry.record_bed(pid, body.bed)
        log.info("bed player=%s bed=%s", pid, body.bed)
        return {"player_id": pid, "bed": body.bed}

    @app.post("/players/{player_id}/skip", dependencies=[Depends(require_token)])
    async def skip(player_id: str) -> dict:
        pid = known_player(player_id)
        try:
            await liq.skip(f"out_{pid}")
        except LiquidsoapError as exc:
            raise HTTPException(502, str(exc)) from exc
        log.info("skip player=%s", pid)
        return {"player_id": pid, "skipped": True}

    @app.put("/players/{player_id}/active", dependencies=[Depends(require_token)])
    async def set_active(player_id: str, body: ActiveRequest) -> dict:
        pid = known_player(player_id)
        registry.mark_active(pid, body.active)
        return registry.snapshot(pid)

    # -- status ---------------------------------------------------------------

    def _with_urls(snap: dict) -> dict:
        if settings.public_stream_base:
            snap["stream_url"] = (
                f"{settings.public_stream_base}/p/{snap['player_id']}.mp3"
            )
        return snap

    @app.get("/players/{player_id}/status", dependencies=[Depends(require_token)])
    async def player_status(player_id: str) -> dict:
        pid = known_player(player_id)
        snap = _with_urls(registry.snapshot(pid))
        try:
            snap["queued"] = await liq.queue_length(f"nar_{pid}")
        except LiquidsoapError:
            snap["queued"] = None
        return snap

    @app.get("/status", dependencies=[Depends(require_token)])
    async def status() -> dict:
        now = time.time()
        players = [_with_urls(s) for s in registry.snapshot_all(now)]
        return {
            "poll_age_s": (now - registry.last_poll_at) if registry.last_poll_at else None,
            "players": players,
            "flagged": [p["player_id"] for p in players if p["flagged"]],
        }

    @app.get("/health")
    async def health() -> dict:
        now = time.time()
        liq_ok, liq_err = True, None
        try:
            await liq.uptime()
        except Exception as exc:
            liq_ok, liq_err = False, str(exc)
        poll_age = (now - registry.last_poll_at) if registry.last_poll_at else None
        icecast_ok = poll_age is not None and poll_age < settings.poll_interval_s * 3
        return {
            "ok": liq_ok and icecast_ok,
            "liquidsoap": {"ok": liq_ok, "error": liq_err},
            "icecast": {"ok": icecast_ok, "poll_age_s": poll_age},
            "players": len(registry.players),
        }

    @app.get("/metrics", response_class=PlainTextResponse)
    async def metrics() -> str:
        now = time.time()
        snaps = registry.snapshot_all(now)
        lines = [
            "# TYPE blackbox_listeners gauge",
            *(
                f'blackbox_listeners{{player="{s["player_id"]}"}} {s["listeners"]}'
                for s in snaps
            ),
            "# TYPE blackbox_players_active gauge",
            f"blackbox_players_active {sum(1 for s in snaps if s['active'])}",
            "# TYPE blackbox_players_flagged gauge",
            f"blackbox_players_flagged {sum(1 for s in snaps if s['flagged'])}",
        ]
        return "\n".join(lines) + "\n"

    # -- test player page (T1 spike, SPEC §10) --------------------------------

    web_dir = Path(
        os.environ.get("WEB_DIR", Path(__file__).resolve().parent.parent.parent / "web")
    )
    if web_dir.is_dir():
        app.mount("/test", StaticFiles(directory=web_dir, html=True), name="test")

    return app


def main() -> None:  # uvicorn entrypoint helper
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    uvicorn.run(create_app(), host="0.0.0.0", port=8090)


if __name__ == "__main__":
    main()
