"""In-memory per-player status registry.

Feeds the operator's "is this player actually receiving audio?" view
(SPEC §8). Listener counts come from the Icecast admin poller; activity
comes from bridge commands (a player is considered *active* once someone
pushes audio to them, or via the explicit /active endpoint).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class PlayerState:
    player_id: str
    stream_id: str
    active: bool = False
    activated_at: float | None = None
    listeners: int = 0
    last_listener_at: float | None = None
    last_file: str | None = None
    last_mode: str | None = None
    last_push_at: float | None = None
    bed: str = "default"


@dataclass
class Registry:
    flag_after_s: float
    players: dict[str, PlayerState] = field(default_factory=dict)
    last_poll_at: float | None = None

    def __init__(self, player_ids: tuple[str, ...] | list[str], flag_after_s: float) -> None:
        self.flag_after_s = flag_after_s
        # Liquidsoap still creates a fixed number of mounts at boot, but the
        # public player ids are dynamic (the phone app creates seat-<random>).
        # Assign those ids to free mount slots on first use.  The mapping is
        # stable for the lifetime of the bridge and the runner re-registers
        # every persisted player after a bridge/server restart.
        self.stream_ids = tuple(player_ids)
        self.players = {}
        self._by_stream: dict[str, str] = {}
        self.last_poll_at = None

    def register(self, pid: str) -> PlayerState:
        existing = self.players.get(pid)
        if existing is not None:
            return existing

        # Prefer a same-named mount for fixed-id installations, otherwise
        # allocate the first free slot in configured order.
        preferred = pid if pid in self.stream_ids and pid not in self._by_stream else None
        stream_id = preferred or next(
            (slot for slot in self.stream_ids if slot not in self._by_stream), None
        )
        if stream_id is None:
            raise OverflowError("no personal audio stream slots available")
        state = PlayerState(player_id=pid, stream_id=stream_id)
        self.players[pid] = state
        self._by_stream[stream_id] = pid
        return state

    def get(self, pid: str) -> PlayerState | None:
        return self.players.get(pid)

    def assigned_for_stream(self, stream_id: str) -> PlayerState | None:
        pid = self._by_stream.get(stream_id)
        return self.players.get(pid) if pid is not None else None

    def mark_active(self, pid: str, active: bool, now: float | None = None) -> None:
        p = self.register(pid)
        if active and not p.active:
            p.activated_at = now if now is not None else time.time()
        p.active = active
        if not active:
            p.activated_at = None

    def record_push(self, pid: str, file: str, mode: str, now: float | None = None) -> None:
        now = now if now is not None else time.time()
        p = self.register(pid)
        p.last_file = file
        p.last_mode = mode
        p.last_push_at = now
        self.mark_active(pid, True, now=now)

    def record_bed(self, pid: str, bed: str) -> None:
        self.register(pid).bed = bed

    def update_listeners(self, counts: dict[str, int], now: float | None = None) -> None:
        now = now if now is not None else time.time()
        self.last_poll_at = now
        for p in self.players.values():
            p.listeners = counts.get(p.stream_id, 0)
            if p.listeners > 0:
                p.last_listener_at = now

    def flagged(self, p: PlayerState, now: float) -> bool:
        """Active player with no listener for > flag_after_s (SPEC §8)."""
        if not p.active or p.listeners > 0:
            return False
        since = max(
            p.last_listener_at or 0.0,
            p.activated_at or 0.0,
        )
        return since > 0 and (now - since) > self.flag_after_s

    def snapshot(self, pid: str, now: float | None = None) -> dict:
        now = now if now is not None else time.time()
        p = self.players[pid]
        return {
            "player_id": p.player_id,
            "stream_id": p.stream_id,
            "active": p.active,
            "connected": p.listeners > 0,
            "listeners": p.listeners,
            "flagged": self.flagged(p, now),
            "last_listener_at": p.last_listener_at,
            "last_file": p.last_file,
            "last_mode": p.last_mode,
            "last_push_at": p.last_push_at,
            "bed": p.bed,
        }

    def snapshot_all(self, now: float | None = None) -> list[dict]:
        now = now if now is not None else time.time()
        return [self.snapshot(pid, now) for pid in self.players]

    def capacity(self) -> dict[str, int]:
        return {
            "total": len(self.stream_ids),
            "assigned": len(self.players),
            "available": len(self.stream_ids) - len(self.players),
        }
