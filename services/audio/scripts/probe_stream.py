#!/usr/bin/env python3
"""Measure an already registered MP3 stream without a browser playback buffer.

Run against both the public bridge URL and the corresponding internal Icecast
mount to distinguish source starvation from ingress buffering. Does not register
participants, inject narration, change configuration, or save show audio.
"""
import argparse
import json
import time
import urllib.error
import urllib.request


def probe(url: str, seconds: float, bitrate: int) -> int:
    started = time.monotonic()
    total = 0
    last = started
    reported = started
    max_gap = 0.0
    try:
        with urllib.request.urlopen(url, timeout=15) as response:
            print(json.dumps({"event": "open", "status": response.status,
                              "content_type": response.headers.get("Content-Type")}), flush=True)
            while time.monotonic() - started < seconds:
                chunk = response.read1(16384)
                now = time.monotonic()
                gap = now - last
                max_gap = max(max_gap, gap)
                if not chunk:
                    print(json.dumps({"event": "unexpected_eof", "elapsed_s": round(now-started, 3),
                                      "bytes": total, "idle_s": round(gap, 3)}), flush=True)
                    return 1
                total += len(chunk)
                last = now
                if now - reported >= 5:
                    elapsed = now - started
                    encoded = total * 8 / bitrate
                    print(json.dumps({"event": "progress", "elapsed_s": round(elapsed, 3),
                                      "bytes": total, "encoded_s": round(encoded, 3),
                                      "encoded_minus_wall_s": round(encoded-elapsed, 3),
                                      "max_read_gap_s": round(max_gap, 3)}), flush=True)
                    reported = now
    except (OSError, urllib.error.URLError) as error:
        print(json.dumps({"event": "error", "type": type(error).__name__,
                          "elapsed_s": round(time.monotonic()-started, 3), "bytes": total}), flush=True)
        return 1
    print(json.dumps({"event": "duration_complete", "bytes": total}), flush=True)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="Existing registered bridge stream or internal Icecast mount URL")
    parser.add_argument("--seconds", type=float, default=180)
    parser.add_argument("--bitrate", type=int, default=128000, help="Encoded CBR bits per second")
    args = parser.parse_args()
    if args.seconds <= 0 or args.bitrate <= 0:
        parser.error("seconds and bitrate must be positive")
    raise SystemExit(probe(args.url, args.seconds, args.bitrate))
