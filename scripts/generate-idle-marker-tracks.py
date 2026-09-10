#!/usr/bin/env python3
"""Generate per-video QR marker tracks for the display attract playlist.

Requires OpenCV and NumPy. The videos contain a high-contrast black square
marker inside a white frame. We detect its outer quadrilateral, infer corners
that briefly leave the top of frame, reject missing detections by interpolation,
and apply light temporal smoothing before emitting TypeScript data.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "apps/display/src/assets"
OUTPUT = ROOT / "apps/display/src/idle/markerTracks.generated.ts"
THRESHOLD = 80
MIN_CONTOUR_AREA = 1_000
MARKER_INSET_SCALE = 0.96
CLIPPED_SIDE_RATIO = 0.95
SMOOTH_RADIUS = 1


def order_quad(points: np.ndarray) -> np.ndarray:
    """Return corners as top-left, top-right, bottom-right, bottom-left."""
    points = np.asarray(points, dtype=np.float64)
    sums = points.sum(axis=1)
    differences = np.diff(points, axis=1).reshape(-1)
    return np.array(
        [
            points[np.argmin(sums)],
            points[np.argmin(differences)],
            points[np.argmax(sums)],
            points[np.argmax(differences)],
        ]
    )


def marker_candidates(frame: np.ndarray) -> list[tuple[float, np.ndarray]]:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    mask = cv2.threshold(gray, THRESHOLD, 255, cv2.THRESH_BINARY_INV)[1]
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates: list[tuple[float, np.ndarray]] = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < MIN_CONTOUR_AREA:
            continue
        hull = cv2.convexHull(contour)
        perimeter = cv2.arcLength(hull, True)
        approximate = cv2.approxPolyDP(hull, 0.02 * perimeter, True)
        if len(approximate) != 4 or not cv2.isContourConvex(approximate):
            continue
        quad = order_quad(approximate.reshape(-1, 2))
        sides = [np.linalg.norm(quad[(index + 1) % 4] - quad[index]) for index in range(4)]
        if min(sides) < 20 or max(sides) / min(sides) > 3:
            continue
        candidates.append((area, quad))
    return candidates


def infer_top_clipped_quad(quad: np.ndarray) -> np.ndarray:
    if min(quad[0, 1], quad[1, 1]) > 1:
        return quad

    top_left, top_right, bottom_right, bottom_left = quad
    left_down = bottom_left - top_left
    right_down = bottom_right - top_right
    left_down /= max(np.linalg.norm(left_down), 1)
    right_down /= max(np.linalg.norm(right_down), 1)
    down = left_down + right_down
    down /= max(np.linalg.norm(down), 1)
    top_width = np.linalg.norm(top_right - top_left)
    bottom_width = np.linalg.norm(bottom_right - bottom_left)
    side_length = (top_width + bottom_width) / 2 * CLIPPED_SIDE_RATIO
    return np.array(
        [
            bottom_left - down * side_length,
            bottom_right - down * side_length,
            bottom_right,
            bottom_left,
        ]
    )


def inset_quad(quad: np.ndarray) -> np.ndarray:
    center = quad.mean(axis=0)
    return center + (quad - center) * MARKER_INSET_SCALE


def interpolate_missing(frames: np.ndarray) -> np.ndarray:
    indices = np.arange(len(frames))
    for coordinate in range(frames.shape[1]):
        valid = np.isfinite(frames[:, coordinate])
        if not valid.any():
            raise RuntimeError(f"marker coordinate {coordinate} was never detected")
        frames[:, coordinate] = np.interp(indices, indices[valid], frames[valid, coordinate])
    return frames


def smooth(frames: np.ndarray) -> np.ndarray:
    return np.array(
        [
            frames[max(0, index - SMOOTH_RADIUS) : min(len(frames), index + SMOOTH_RADIUS + 1)].mean(axis=0)
            for index in range(len(frames))
        ]
    )


def track_video(path: Path) -> dict[str, object]:
    capture = cv2.VideoCapture(str(path))
    fps = capture.get(cv2.CAP_PROP_FPS)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frames: list[np.ndarray] = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        candidates = marker_candidates(frame)
        if not candidates:
            frames.append(np.full(8, np.nan))
            continue
        quad = max(candidates, key=lambda item: item[0])[1]
        frames.append(inset_quad(infer_top_clipped_quad(quad)).reshape(-1))
    capture.release()
    if not frames:
        raise RuntimeError(f"{path.name}: video contains no frames")
    processed = smooth(interpolate_missing(np.array(frames)))
    rounded = np.round(processed, 1).tolist()
    return {
        "fps": round(fps, 6),
        "width": width,
        "height": height,
        "frames": rounded,
    }


def typescript(track_data: dict[str, dict[str, object]]) -> str:
    entries = []
    for filename, track in track_data.items():
        frames = ",\n".join(f"      {json.dumps(frame, separators=(',', ':'))}" for frame in track["frames"])
        entries.append(
            f'  "{filename}": {{\n'
            f'    fps: {track["fps"]}, width: {track["width"]}, height: {track["height"]},\n'
            f"    frames: [\n{frames}\n    ],\n"
            "  },"
        )
    body = "\n".join(entries)
    return (
        "// Generated by scripts/generate-idle-marker-tracks.py. Do not edit by hand.\n"
        'import type { MarkerTrack } from "./markerTrack.js";\n\n'
        "export const GENERATED_MARKER_TRACKS: Readonly<Record<string, MarkerTrack>> = {\n"
        f"{body}\n"
        "};\n"
    )


def main() -> None:
    videos = sorted(ASSETS.glob("1.0_25_*.mp4"))
    legacy_video = ASSETS / "idle-attract.mp4"
    if legacy_video.exists():
        videos.append(legacy_video)
    tracks = {path.name: track_video(path) for path in videos}
    OUTPUT.write_text(typescript(tracks), encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)} with {len(tracks)} tracks")


if __name__ == "__main__":
    main()
