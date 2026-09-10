"""End-to-end bridge API tests: real app, fake liquidsoap, no icecast."""

import asyncio
from pathlib import Path

import httpx
import pytest

from bridge.app import create_app
from bridge.config import Settings

from .test_liq import FakeLiq


@pytest.fixture
async def env(tmp_path: Path):
    fake = FakeLiq()
    await fake.start()
    (tmp_path / "audio").mkdir()
    (tmp_path / "audio" / "intro.mp3").write_bytes(b"x")
    (tmp_path / "beds" / "forest").mkdir(parents=True)
    (tmp_path / "beds" / "forest" / "loop.mp3").write_bytes(b"x")

    settings = Settings(
        liq_host="127.0.0.1",
        liq_port=fake.port,
        audio_dir=tmp_path / "audio",
        beds_dir=tmp_path / "beds",
        token="secret",
        player_ids=("1", "2", "alpha"),
        public_stream_base="http://venue:8300",
        max_audio_upload_bytes=8,
        # icecast poller will fail harmlessly against nothing; keep it slow
        icecast_port=1,
        poll_interval_s=60.0,
    )
    app = create_app(settings)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://bridge",
        headers={"Authorization": "Bearer secret"},
    ) as client:
        # run lifespan manually so the poller task starts/stops cleanly
        async with app.router.lifespan_context(app):
            yield client, fake
    await fake.stop()


async def test_play_interrupt(env):
    client, fake = env
    fake.responses["int_1.push /audio/intro.mp3"] = "7"
    r = await client.post("/players/1/play", json={"file": "intro.mp3"})
    assert r.status_code == 200
    assert r.json()["rid"] == "7"
    assert "int_1.push /audio/intro.mp3" in fake.commands


async def test_play_queue_mode_uses_narration_queue(env):
    client, fake = env
    fake.responses["nar_alpha.push /audio/intro.mp3"] = "9"
    r = await client.post(
        "/players/alpha/play", json={"file": "intro.mp3", "mode": "queue"}
    )
    assert r.status_code == 200
    assert "nar_alpha.push /audio/intro.mp3" in fake.commands


async def test_play_rejects_unknown_player_and_file(env):
    client, fake = env
    # Arbitrary phone-generated ids are allocated a free pre-built mount.
    fake.responses["int_1.push /audio/intro.mp3"] = "11"
    r = await client.post("/players/seat-random/play", json={"file": "intro.mp3"})
    assert r.status_code == 200
    assert (await client.post("/players/1/play", json={"file": "nope.mp3"})).status_code == 404
    assert (await client.post("/players/1/play", json={"file": "../intro.mp3"})).status_code == 400


async def test_auth_required(env):
    client, _ = env
    r = await client.post(
        "/players/1/play", json={"file": "intro.mp3"}, headers={"Authorization": ""}
    )
    assert r.status_code == 401
    # Health stays unauthenticated for Compose. This fixture has no Icecast,
    # so dependency-aware readiness must be a failing HTTP status.
    health = await client.get("/health", headers={"Authorization": ""})
    assert health.status_code == 503
    assert health.json()["ok"] is False


async def test_bed_switch(env):
    client, fake = env
    r = await client.post("/players/2/bed", json={"bed": "forest"})
    assert r.status_code == 200
    assert "bed_2.uri /beds/forest" in fake.commands
    assert "bed_2.reload" in fake.commands
    assert (await client.post("/players/2/bed", json={"bed": "missing"})).status_code == 404


async def test_status_includes_stream_url_and_flags(env):
    client, fake = env
    fake.responses["int_1.push /audio/intro.mp3"] = "7"
    await client.post("/players/1/play", json={"file": "intro.mp3"})
    r = await client.get("/status")
    body = r.json()
    p1 = next(p for p in body["players"] if p["player_id"] == "1")
    assert p1["active"] is True
    assert p1["stream_url"] == "http://venue:8300/stream/1"


async def test_dynamic_registration_and_public_gateway_url(env):
    client, _ = env
    r = await client.post("/players/seat-abc/register")
    assert r.status_code == 200
    assert r.json()["player_id"] == "seat-abc"
    assert r.json()["stream_url"] == "http://venue:8300/stream/seat-abc"


async def test_reset_and_release_clear_narration_before_reusing_mount(env):
    client, fake = env
    fake.responses["player_1.reset"] = "OK"
    await client.post("/players/seat-abc/register")
    assert (await client.post("/players/seat-abc/reset")).status_code == 200
    assert (await client.delete("/players/seat-abc")).status_code == 200
    replacement = await client.post("/players/seat-def/register")
    assert replacement.json()["stream_id"] == "1"
    assert fake.commands.count("player_1.reset") == 2


async def test_public_stream_cannot_allocate_an_unknown_player(env):
    client, _ = env
    before = (await client.get("/status")).json()["capacity"]
    r = await client.get("/stream/not-registered", headers={"Authorization": ""})
    assert r.status_code == 404
    assert (await client.get("/status")).json()["capacity"] == before


async def test_authenticated_audio_upload_is_immediately_playable(env):
    client, fake = env
    r = await client.put("/audio/live-message.mp3", content=b"ID3new")
    assert r.status_code == 200
    assert r.json()["bytes"] == 6
    fake.responses["int_1.push /audio/live-message.mp3"] = "12"
    played = await client.post("/players/1/play", json={"file": "live-message.mp3"})
    assert played.status_code == 200

    unauthorized = await client.put(
        "/audio/nope.mp3",
        content=b"x",
        headers={"Authorization": ""},
    )
    assert unauthorized.status_code == 401
    too_large = await client.put("/audio/too-large.mp3", content=b"123456789")
    assert too_large.status_code == 413
    assert (
        await client.post("/players/1/play", json={"file": "too-large.mp3"})
    ).status_code == 404


async def test_deactivating_unknown_historical_player_does_not_consume_capacity(env):
    client, _ = env
    before = (await client.get("/status")).json()["capacity"]
    r = await client.put("/players/old-seat/active", json={"active": False})
    assert r.status_code == 200
    assert r.json()["registered"] is False
    assert (await client.get("/status")).json()["capacity"] == before


async def test_metrics_plaintext(env):
    client, _ = env
    r = await client.get("/metrics")
    assert r.status_code == 200
    assert "blackbox_players_active" in r.text
    assert (
        await client.get("/metrics", headers={"Authorization": ""})
    ).status_code == 401
