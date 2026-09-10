"""blackbox-icecast bridge — the only API the rest of the system talks to.

REST in, Liquidsoap telnet out; Icecast admin polled for listener state.
See SPEC §4.1 for the endpoint table and §8 for the observability model.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import icecast
from .config import BED_NAME_RE, PLAYER_ID_RE, Settings
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

    app = FastAPI(
        title="blackbox-icecast bridge",
        lifespan=lifespan,
        docs_url="/docs" if settings.enable_docs else None,
        redoc_url="/redoc" if settings.enable_docs else None,
        openapi_url="/openapi.json" if settings.enable_docs else None,
    )
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

    def validate_player_id(player_id: str) -> None:
        if not PLAYER_ID_RE.match(player_id):
            raise HTTPException(400, f"player id must match {PLAYER_ID_RE.pattern}")

    def assigned_player(player_id: str):
        validate_player_id(player_id)
        try:
            return registry.register(player_id)
        except OverflowError as exc:
            raise HTTPException(503, str(exc)) from exc

    # -- control ------------------------------------------------------------

    @app.post("/players/{player_id}/play", dependencies=[Depends(require_token)])
    async def play(player_id: str, body: PlayRequest) -> dict:
        resolve_audio_file(settings.audio_dir, body.file)
        player = assigned_player(player_id)
        pid = player.player_id
        queue = (
            f"int_{player.stream_id}"
            if body.mode == "interrupt"
            else f"nar_{player.stream_id}"
        )
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
        resolve_bed_dir(settings.beds_dir, body.bed)
        player = assigned_player(player_id)
        pid = player.player_id
        try:
            await liq.set_bed(
                f"bed_{player.stream_id}", f"{settings.liq_beds_dir}/{body.bed}"
            )
        except LiquidsoapError as exc:
            raise HTTPException(502, str(exc)) from exc
        registry.record_bed(pid, body.bed)
        log.info("bed player=%s bed=%s", pid, body.bed)
        return {"player_id": pid, "bed": body.bed}

    @app.post("/players/{player_id}/skip", dependencies=[Depends(require_token)])
    async def skip(player_id: str) -> dict:
        player = assigned_player(player_id)
        pid = player.player_id
        try:
            await liq.skip(f"out_{player.stream_id}")
        except LiquidsoapError as exc:
            raise HTTPException(502, str(exc)) from exc
        log.info("skip player=%s", pid)
        return {"player_id": pid, "skipped": True}

    @app.put("/players/{player_id}/active", dependencies=[Depends(require_token)])
    async def set_active(player_id: str, body: ActiveRequest) -> dict:
        validate_player_id(player_id)
        player = registry.get(player_id)
        # Startup reconciliation includes historical/left player records. Do
        # not let an inactive record consume one of the finite encoder slots.
        if not body.active and player is None:
            return {"player_id": player_id, "active": False, "registered": False}
        pid = (player or assigned_player(player_id)).player_id
        registry.mark_active(pid, body.active)
        return _with_urls(registry.snapshot(pid))

    @app.post("/players/{player_id}/register", dependencies=[Depends(require_token)])
    async def register(player_id: str) -> dict:
        """Allocate a stable pre-provisioned mount to an arbitrary player id."""
        player = assigned_player(player_id)
        return _with_urls(registry.snapshot(player.player_id))

    @app.put("/audio/{file}", dependencies=[Depends(require_token)])
    async def upload_audio(file: str, request: Request) -> dict:
        """Store an MP3 sent by the private venue runner.

        Coolify hosts the delivery stack on a different machine, so it cannot
        mount the runner's local content directory. The authenticated upload
        keeps that deployment boundary explicit and writes atomically into the
        volume Liquidsoap reads.
        """
        if not file or Path(file).name != file or Path(file).suffix.lower() != ".mp3":
            raise HTTPException(400, "file must be a bare .mp3 filename")
        settings.audio_dir.mkdir(parents=True, exist_ok=True)
        target = settings.audio_dir / file
        temporary = settings.audio_dir / f".{file}.{uuid.uuid4().hex}.upload"
        size = 0
        try:
            with temporary.open("wb") as output:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > settings.max_audio_upload_bytes:
                        raise HTTPException(
                            413,
                            f"audio exceeds {settings.max_audio_upload_bytes} byte upload limit",
                        )
                    output.write(chunk)
            if size == 0:
                raise HTTPException(400, "audio upload is empty")
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        log.info("audio uploaded file=%s bytes=%d", file, size)
        return {"ok": True, "file": file, "bytes": size}

    # -- status ---------------------------------------------------------------

    def _with_urls(snap: dict) -> dict:
        if settings.public_stream_base:
            snap["stream_url"] = (
                f"{settings.public_stream_base}/stream/{snap['player_id']}"
            )
        return snap

    @app.get("/stream/{player_id}")
    async def player_stream(player_id: str) -> StreamingResponse:
        """Public phone entrypoint: proxy an authenticated runner registration.

        The bearer token is intentionally not required here; it contains no
        control capability and is the URL placed in the phone's audio element.
        Proxying (instead of redirecting) ensures a bridge restart closes the
        phone connection too. Its watchdog retries while the runner's periodic
        registration reconciliation restores the remote mapping.
        """
        validate_player_id(player_id)
        player = registry.get(player_id)
        if player is None:
            # Public requests must never allocate finite encoder capacity.
            raise HTTPException(404, f"personal stream is not registered: {player_id}")
        upstream = httpx.AsyncClient(timeout=httpx.Timeout(None, connect=5.0))
        request = upstream.build_request(
            "GET",
            f"http://{settings.icecast_host}:{settings.icecast_port}/p/{player.stream_id}.mp3",
        )
        try:
            response = await upstream.send(request, stream=True)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            await upstream.aclose()
            raise HTTPException(502, f"personal stream unavailable: {exc}") from exc

        async def chunks():
            try:
                async for chunk in response.aiter_raw():
                    yield chunk
            finally:
                await response.aclose()
                await upstream.aclose()

        return StreamingResponse(
            chunks(),
            media_type=response.headers.get("content-type", "audio/mpeg"),
            headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
        )

    @app.get("/players/{player_id}/status", dependencies=[Depends(require_token)])
    async def player_status(player_id: str) -> dict:
        player = registry.get(player_id)
        if player is None:
            raise HTTPException(404, f"unknown player: {player_id}")
        pid = player.player_id
        snap = _with_urls(registry.snapshot(pid))
        try:
            snap["queued"] = await liq.queue_length(f"nar_{player.stream_id}")
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
            "capacity": registry.capacity(),
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
            "capacity": registry.capacity(),
        }

    @app.get(
        "/metrics",
        response_class=PlainTextResponse,
        dependencies=[Depends(require_token)],
    )
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
