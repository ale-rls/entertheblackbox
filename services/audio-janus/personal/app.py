"""Independent personal-audio bridge: same cue contract, direct Opus/RTP output."""
import asyncio
import hmac
import logging
import os
import re
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Literal
from bridge.liq import LiquidsoapClient, LiquidsoapError
from bridge.state import Registry
from personal.janus import Janus

log = logging.getLogger('janus-bridge')

class Play(BaseModel):
    file: str
    mode: Literal['interrupt', 'queue'] = 'interrupt'
    offsetSeconds: float = Field(default=0, ge=0, allow_inf_nan=False)
class Music(BaseModel):
    file: str | None = None
    volume: float = Field(default=.2, ge=0, le=1, allow_inf_nan=False)
class Active(BaseModel):
    active: bool
class Bed(BaseModel):
    bed: str


def create_app():
    count = int(os.environ.get('PLAYERS', '30'))
    if not 1 <= count <= 100:
        raise ValueError('PLAYERS must be 1–100')
    token = os.environ['BRIDGE_TOKEN']
    key = os.environ['JANUS_ADMIN_KEY']
    if len(token) < 32 or len(key) < 32:
        raise ValueError('Bridge and Janus management secrets must be at least 32 characters')
    root = Path(os.environ.get('AUDIO_DIR', '/audio'))
    beds = Path(os.environ.get('BEDS_DIR', '/beds'))
    registry = Registry([str(i) for i in range(1, count + 1)], 20)
    janus = Janus(os.environ.get('JANUS_URL', 'http://janus:8088/janus'), key)
    liq = LiquidsoapClient(os.environ.get('LIQUIDSOAP_HOST', 'liquidsoap'), 1234)
    credentials = {}
    lock = asyncio.Lock()
    last_uptime = None
    healthy_at = 0.

    def mount(slot): return 100 + int(slot)
    def port(slot): return 6000 + 2 * int(slot)
    def valid_id(pid):
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', pid):
            raise HTTPException(400, 'Invalid participant id')
    def filename(name):
        if not re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]*\.mp3', name or ''):
            raise HTTPException(400, 'Expected a bare MP3 filename')
        path = root / name
        if path.is_symlink():
            raise HTTPException(400, 'Symlinks are not accepted')
        return path
    def existing(name):
        path = filename(name)
        if not path.is_file(): raise HTTPException(404, 'Audio file not uploaded')
        return path
    async def command(value):
        if (await liq.command(value)).strip() != 'OK':
            raise LiquidsoapError('Mixer command rejected')

    async def ensure(pid):
        valid_id(pid)
        try:
            player = registry.register(pid)
        except OverflowError as exc:
            raise HTTPException(503, str(exc)) from exc
        slot = player.stream_id
        if pid not in credentials:
            # A previous bridge instance may have left a mount alive. Destroy it
            # before reusing this source, closing old listeners before new cues.
            await janus.destroy(mount(slot))
            await liq.reset_player(slot)
            await command(f"player_{slot}.reset_bed")
            credentials[pid] = {'pin': secrets.token_hex(24), 'sourceEpoch': uuid.uuid4().hex}
        if await janus.info(mount(slot)) is None:
            await janus.create(mount(slot), port(slot), credentials[pid]['pin'])
            credentials[pid]['sourceEpoch'] = uuid.uuid4().hex
        return player

    async def poll():
        nonlocal last_uptime, healthy_at
        while True:
            try:
                async with lock:
                    uptime_text = await liq.uptime()
                    parts = re.fullmatch(r'(\d+)d (\d+)h (\d+)m (\d+)s', uptime_text)
                    uptime = sum(int(n) * scale for n, scale in zip(parts.groups(), [86400, 3600, 60, 1])) if parts else float(uptime_text)
                    if last_uptime is not None and uptime < last_uptime:
                        for value in credentials.values(): value['sourceEpoch'] = uuid.uuid4().hex
                    last_uptime = uptime
                    counts = {}
                    for pid in list(registry.players):
                        player = await ensure(pid)
                        info = await janus.info(mount(player.stream_id))
                        counts[player.stream_id] = info.get('viewers', 0)
                    # Verify gateway health even before any participant joins.
                    await janus.message({'request': 'list'})
                    registry.update_listeners(counts)
                    healthy_at = time.monotonic()
            except Exception:
                log.exception('Personal audio health check failed')
            await asyncio.sleep(5)

    @asynccontextmanager
    async def lifespan(app):
        # Revoke every old personal subscription on bridge restart, including
        # slots not yet reclaimed by the show server. Trial mount 1 is separate.
        for slot in registry.stream_ids:
            await janus.destroy(mount(slot))
            await liq.reset_player(slot)
            await command(f"player_{slot}.reset_bed")
        task = asyncio.create_task(poll())
        try: yield
        finally:
            task.cancel()
            try: await task
            except asyncio.CancelledError: pass
            await janus.close()
            await liq.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.registry, app.state.liq, app.state.janus = registry, liq, janus

    async def auth(request: Request):
        if not hmac.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + token):
            raise HTTPException(401, 'Unauthorized')
    protected = [Depends(auth)]

    @app.exception_handler(LiquidsoapError)
    async def mixer_error(_request, _error):
        return JSONResponse({'error': 'Mixer unavailable'}, status_code=503)

    @app.put('/players/{pid}/active', dependencies=protected)
    async def active(pid: str, body: Active):
        async with lock:
            valid_id(pid)
            if not body.active and registry.get(pid) is None: return {'registered': False}
            player = await ensure(pid)
            registry.mark_active(pid, body.active)
            return {**registry.snapshot(pid), 'sourceEpoch': credentials[pid]['sourceEpoch']}

    @app.post('/players/{pid}/register', dependencies=protected)
    async def register(pid: str):
        return await active(pid, Active(active=True))

    @app.get('/players/{pid}/listen', dependencies=protected)
    async def listen(pid: str):
        async with lock:
            valid_id(pid)
            player = registry.get(pid)
            if player is None: raise HTTPException(404, 'Not registered')
            player = await ensure(pid)
            return {'mountpoint': mount(player.stream_id), 'pin': credentials[pid]['pin']}

    @app.post('/players/{pid}/play', dependencies=protected)
    async def play(pid: str, body: Play):
        path = existing(body.file)
        async with lock:
            player = await ensure(pid)
            uri = str(path)
            if body.offsetSeconds: uri = f'annotate:liq_cue_in="{body.offsetSeconds:.3f}":{uri}'
            queue = ('int_' if body.mode == 'interrupt' else 'nar_') + player.stream_id
            rid = await liq.push(queue, uri)
            registry.record_push(pid, body.file, body.mode)
            return {'rid': rid}

    @app.post('/players/{pid}/reset', dependencies=protected)
    async def reset(pid: str):
        async with lock:
            player = await ensure(pid)
            await liq.reset_player(player.stream_id)
            return {'ok': True}

    @app.post('/players/{pid}/skip', dependencies=protected)
    async def skip(pid: str):
        async with lock:
            player = await ensure(pid)
            await liq.skip('out_' + player.stream_id)
            return {'ok': True}

    @app.post('/players/{pid}/bed', dependencies=protected)
    async def bed(pid: str, body: Bed):
        if not re.fullmatch(r'[A-Za-z0-9_-]+', body.bed): raise HTTPException(400, 'Invalid bed')
        path = beds / body.bed
        if not path.is_dir() or path.is_symlink() or not any(path.iterdir()): raise HTTPException(404, 'Unknown bed')
        async with lock:
            player = await ensure(pid)
            await command(f"player_{player.stream_id}.bed {path}")
            registry.record_bed(pid, body.bed)
            return {'ok': True}

    @app.delete('/players/{pid}', dependencies=protected)
    async def release(pid: str):
        async with lock:
            valid_id(pid)
            player = registry.get(pid)
            if player:
                await janus.destroy(mount(player.stream_id))
                await liq.reset_player(player.stream_id)
                await command(f"player_{player.stream_id}.reset_bed")
                registry.release(pid)
                credentials.pop(pid, None)
            return {'ok': True}

    @app.post('/music', dependencies=protected)
    async def music(body: Music):
        path = existing(body.file) if body.file is not None else None
        async with lock:
            if path is None: await command('music.stop')
            else:
                await command(f'music.play {path}')
                await command(f'music.volume {body.volume}')
        return {'ok': True}

    @app.put('/audio/{name}', dependencies=protected)
    async def upload(name: str, request: Request):
        path = filename(name)
        root.mkdir(parents=True, exist_ok=True)
        temporary = root / ('.' + uuid.uuid4().hex + '.upload')
        size = 0
        try:
            with temporary.open('xb') as output:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > 20 * 1024 * 1024: raise HTTPException(413, 'Audio exceeds 20 MiB')
                    output.write(chunk)
            if not size: raise HTTPException(400, 'Empty audio')
            os.replace(temporary, path)
        finally: temporary.unlink(missing_ok=True)
        return {'ok': True}

    @app.get('/status', dependencies=protected)
    async def status():
        return {'players': registry.snapshot_all(), 'capacity': registry.capacity(),
                'poll_age_s': time.time() - registry.last_poll_at if registry.last_poll_at else None}

    @app.get('/health')
    async def health():
        ok = healthy_at > 0 and time.monotonic() - healthy_at < 20
        return JSONResponse({'ok': ok}, status_code=200 if ok else 503)
    return app
