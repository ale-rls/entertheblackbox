"""Run inside the bridge container against the real audio stack (CI only)."""
import os
from pathlib import Path

import httpx

with httpx.Client(
    base_url="http://127.0.0.1:8090",
    headers={"Authorization": f"Bearer {os.environ['BRIDGE_TOKEN']}"},
    timeout=20,
) as client:
    def request(method, path, **kwargs):
        response = client.request(method, path, **kwargs)
        response.raise_for_status()
        return response.json()

    assert request("GET", "/health")["ok"]
    request("PUT", "/audio/smoke.mp3", content=Path("/beds/default/bed.mp3").read_bytes())
    try:
        request("POST", "/music", json={"file": "smoke.mp3", "volume": 0.2})
        request("POST", "/players/smoke/register")
        request("POST", "/players/smoke/play", json={"file": "smoke.mp3"})
        request("POST", "/music", json={"file": "smoke.mp3", "volume": 0.4})
        with client.stream("GET", "/stream/smoke") as stream:
            stream.raise_for_status()
            assert next(stream.iter_bytes()), "Stream produced no audio bytes"
        request("POST", "/music", json={"file": None})
        assert request("GET", "/health")["ok"]
    finally:
        request("POST", "/music", json={"file": None})
        request("DELETE", "/players/smoke")
print("Audio startup, music controls, narration and stream delivery passed")
