"""Exercise the live signaling service, including PIN and management boundaries.

JANUS_LISTENER_PIN=... python3 scripts/smoke.py http://localhost:8400
This does not validate audible playback or latency.
"""
import json
import os
import sys
import time
import urllib.request
import uuid

base = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8400").rstrip("/") + "/janus"
pin = os.environ["JANUS_LISTENER_PIN"]


def request(path, payload=None):
    body = None if payload is None else json.dumps({**payload, "transaction": uuid.uuid4().hex}).encode()
    req = urllib.request.Request(base + path, body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=35) as response:
        data = json.load(response)
    if isinstance(data, dict) and data.get("janus") == "error":
        raise RuntimeError(data["error"])
    return data


info = request("/info")
assert set(info["plugins"]) == {"janus.plugin.streaming"}, info["plugins"]
assert set(info["transports"]) == {"janus.transport.http"}, info["transports"]
session = request("", {"janus": "create"})["data"]["id"]
try:
    handle = request(f"/{session}", {"janus": "attach", "plugin": "janus.plugin.streaming"})["data"]["id"]
    path = f"/{session}/{handle}"

    def message(body):
        result = request(path, {"janus": "message", "body": body})
        if result.get("janus") != "ack":
            return result
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            result = request(f"/{session}?rid={time.time_ns()}")
            if result.get("janus") == "event":
                return result
        raise TimeoutError("No plugin response")

    denied = message({"request": "create", "type": "rtp", "id": 99, "audio": True,
                      "audioport": 5999, "audiopt": 111, "audiocodec": "opus"})
    assert denied["plugindata"]["data"].get("error_code"), denied
    denied = message({"request": "watch", "id": 1, "pin": pin + "-wrong"})
    assert denied["plugindata"]["data"].get("error_code"), denied
    allowed = message({"request": "watch", "id": 1, "pin": pin})
    assert allowed["jsep"]["type"] == "offer", allowed
    assert "opus/48000" in allowed["jsep"]["sdp"], allowed
    print("PASS: only Streaming/HTTP loaded; mount creation and wrong PIN denied; valid PIN yields Opus SDP")
finally:
    request(f"/{session}", {"janus": "destroy"})
