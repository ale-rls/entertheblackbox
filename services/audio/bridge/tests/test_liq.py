"""LiquidsoapClient against a fake telnet server."""

import asyncio

import pytest

from bridge.liq import LiquidsoapClient, LiquidsoapError


class FakeLiq:
    """Answers like liquidsoap's telnet server: lines then END."""

    def __init__(self):
        self.commands: list[str] = []
        self.responses: dict[str, str] = {}
        self.server = None
        self.port = None
        self._writers: list[asyncio.StreamWriter] = []

    async def start(self, port: int = 0):
        self.server = await asyncio.start_server(self._handle, "127.0.0.1", port)
        self.port = self.server.sockets[0].getsockname()[1]

    async def _handle(self, reader, writer):
        self._writers.append(writer)
        try:
            while True:
                raw = await reader.readline()
                if not raw:
                    break
                cmd = raw.decode().strip()
                self.commands.append(cmd)
                body = self.responses.get(cmd, "")
                payload = (body + "\r\n" if body else "") + "END\r\n"
                writer.write(payload.encode())
                await writer.drain()
        except (ConnectionError, asyncio.CancelledError):
            pass
        finally:
            writer.close()

    async def stop(self):
        if self.server is None:
            return
        # close live connections first: since py3.12 wait_closed() waits for
        # handlers, which would otherwise block on their next readline()
        for w in self._writers:
            w.close()
        self.server.close()
        await self.server.wait_closed()
        self.server = None


@pytest.fixture
async def fake():
    f = FakeLiq()
    await f.start()
    yield f
    await f.stop()


async def test_push_returns_rid(fake):
    fake.responses["nar_7.push /audio/intro.mp3"] = "42"
    client = LiquidsoapClient("127.0.0.1", fake.port)
    assert await client.push("nar_7", "/audio/intro.mp3") == "42"
    await client.close()


async def test_push_error_on_garbage(fake):
    fake.responses["nar_7.push /audio/x.mp3"] = "No such command"
    client = LiquidsoapClient("127.0.0.1", fake.port)
    with pytest.raises(LiquidsoapError):
        await client.push("nar_7", "/audio/x.mp3")
    await client.close()


async def test_queue_length(fake):
    fake.responses["nar_1.queue"] = "12 13 14"
    client = LiquidsoapClient("127.0.0.1", fake.port)
    assert await client.queue_length("nar_1") == 3
    fake.responses["nar_2.queue"] = ""
    assert await client.queue_length("nar_2") == 0
    await client.close()


async def test_set_bed_sends_uri_then_reload(fake):
    client = LiquidsoapClient("127.0.0.1", fake.port)
    await client.set_bed("bed_3", "/beds/forest")
    assert fake.commands == ["bed_3.uri /beds/forest", "bed_3.reload"]
    await client.close()


async def test_reset_player_clears_pending_and_current_narration(fake):
    fake.responses["player_3.reset"] = "OK"
    client = LiquidsoapClient("127.0.0.1", fake.port)
    await client.reset_player("3")
    assert fake.commands == ["player_3.reset"]
    await client.close()


async def test_reconnects_after_server_restart(fake):
    client = LiquidsoapClient("127.0.0.1", fake.port)
    await client.command("uptime")
    # simulate liquidsoap restart: drop all connections, come back on same port
    port = fake.port
    await fake.stop()
    fake2 = FakeLiq()
    fake2.responses["uptime"] = "0d 0h"
    await fake2.start(port)
    try:
        assert await client.command("uptime") == "0d 0h"
    finally:
        await client.close()
        await fake2.stop()


async def test_rejects_multiline_command():
    client = LiquidsoapClient("127.0.0.1", 1)
    with pytest.raises(ValueError):
        await client.command("evil\nsecond")
