"""Minimal async client for the Liquidsoap telnet server.

One persistent connection, commands serialized behind a lock (the telnet
protocol is strictly request/response, terminated by an ``END`` line).
Reconnects once per command on a dead socket.
"""

from __future__ import annotations

import asyncio
import logging

log = logging.getLogger("bridge.liq")


class LiquidsoapError(RuntimeError):
    pass


class LiquidsoapClient:
    def __init__(self, host: str, port: int, timeout: float = 5.0) -> None:
        self._host = host
        self._port = port
        self._timeout = timeout
        self._lock = asyncio.Lock()
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None

    async def _connect(self) -> None:
        self._reader, self._writer = await asyncio.wait_for(
            asyncio.open_connection(self._host, self._port), self._timeout
        )

    async def _reset(self) -> None:
        if self._writer is not None:
            self._writer.close()
        self._reader = self._writer = None

    async def command(self, cmd: str) -> str:
        """Send one command, return the response body (without END)."""
        if "\n" in cmd or "\r" in cmd:
            raise ValueError("command must be a single line")
        async with self._lock:
            last_exc: Exception | None = None
            for _attempt in range(2):
                try:
                    if self._writer is None:
                        await self._connect()
                    assert self._reader is not None and self._writer is not None
                    self._writer.write(cmd.encode() + b"\n")
                    await asyncio.wait_for(self._writer.drain(), self._timeout)
                    lines: list[str] = []
                    while True:
                        raw = await asyncio.wait_for(
                            self._reader.readline(), self._timeout
                        )
                        if not raw:
                            raise ConnectionError("liquidsoap closed the connection")
                        line = raw.decode(errors="replace").rstrip("\r\n")
                        if line == "END":
                            return "\n".join(lines)
                        lines.append(line)
                except (OSError, asyncio.TimeoutError, ConnectionError) as exc:
                    last_exc = exc
                    await self._reset()
            raise LiquidsoapError(
                f"liquidsoap command failed: {cmd!r}: {last_exc}"
            ) from last_exc

    async def close(self) -> None:
        await self._reset()

    # -- typed helpers ----------------------------------------------------

    async def push(self, queue_id: str, uri: str) -> str:
        """Push a file onto a request.queue; returns the request id."""
        out = (await self.command(f"{queue_id}.push {uri}")).strip()
        if not out.isdigit():
            raise LiquidsoapError(f"unexpected push response: {out!r}")
        return out

    async def queue_length(self, queue_id: str) -> int:
        out = (await self.command(f"{queue_id}.queue")).strip()
        return len(out.split()) if out else 0

    async def skip(self, output_id: str) -> None:
        await self.command(f"{output_id}.skip")

    async def set_bed(self, playlist_id: str, uri: str) -> None:
        await self.command(f"{playlist_id}.uri {uri}")
        await self.command(f"{playlist_id}.reload")

    async def reset_player(self, stream_id: str) -> None:
        result = (await self.command(f"player_{stream_id}.reset")).strip()
        if result != "OK":
            raise LiquidsoapError(f"unexpected reset response: {result!r}")

    async def uptime(self) -> str:
        return (await self.command("uptime")).strip()
