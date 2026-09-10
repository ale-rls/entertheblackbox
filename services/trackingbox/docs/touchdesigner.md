# Run with TouchDesigner

The local deployment runs the whole tracking pipeline on the Windows theater PC.
TouchDesigner is the **only** process that opens the USB camera or capture card.
It uses a Video Stream Out TOP to publish the unannotated image as local RTSP;
TrackingBox reads that stream and sends audience state back over WebSocket.

```text
camera -> Video Device In TOP -> TouchDesigner visuals
                         |
                         +-> Video Stream Out TOP (RTSP) -> TrackingBox
                                                         -> /ws positions
                                                         -> /video overlay monitor
```

This avoids the Windows single-owner camera conflict and keeps the original TOP
available to visuals without a network encode/decode round trip. Only the copy
sent to TrackingBox is H.264 encoded.

ReID (OSNet) is part of the venue setup: it recovers a person's GID after a
full occlusion and appearance-checks the tracker when a track id reappears
after a miss. If `torchreid` won't build on a given machine, `--no-reid` still
runs detection + tracking with GIDs persisting across short misses — only
occlusion recovery is lost.

> Looking for the cloud GPU path instead? See [Run on Modal](modal.md).

## Prerequisites

* An NVIDIA GPU with a current driver (`nvidia-smi` to confirm).
* TouchDesigner installed.
* Python 3.10-3.12 installed separately from TouchDesigner. The service runs in
  its own venv, not inside TouchDesigner's Python. Video Stream Out TOP also
  requires Windows and an Nvidia GPU.

## Install

From the monorepo root in a terminal, or by double-clicking the batch file:

```bat
services\trackingbox\scripts\install_windows.bat -Reid
```

Sanity-check anytime:

```bat
services\trackingbox\.venv\Scripts\audience-tracker doctor --require reid
```

## Build the TouchDesigner video path

1. Create a **Video Device In TOP** named `audience_camera` and select the
   physical camera/capture card.
2. Branch that TOP directly into the visualization network. Do not read the
   RTSP stream back into TouchDesigner for the main visuals.
3. Connect the same TOP to a **Video Stream Out TOP** named
   `audience_rtsp_out` with:

   | Parameter | Value |
   |---|---|
   | Mode | `RTSP Server` |
   | Network Port | `8554` |
   | Stream Name | `audience` |
   | Video Codec | `H.264` |
   | Active | `On` |

Parameter reference: [TouchDesigner Video Stream Out TOP](https://docs.derivative.ca/Video_Stream_Out_TOP).

The TrackingBox input URL is then:

```text
rtsp://127.0.0.1:8554/audience
```

Keep the RTSP output active before starting or restarting TrackingBox. A Video
Stream Out TOP uses Nvidia hardware encoding on Windows, so watch GPU encoder
load during rehearsal as well as TrackingBox's inference FPS.

TrackingBox drains RTSP video on a dedicated capture thread and keeps only the
newest decoded frame for detection. This prevents slow inference from backing
up the stream and causing decoder errors or read timeouts. When detection runs
slower than the camera, intermediate frames are intentionally skipped.

## Start TrackingBox manually

From the monorepo root, after the RTSP output is active:

```bat
services\trackingbox\scripts\run_windows.bat --config C:\show\venue-config.json
:: defaults to --source rtsp://127.0.0.1:8554/audience
:: pass --no-reid if ReID was not installed
```

In TouchDesigner:

* **Visualization video**: branch directly from `audience_camera`.
* **Optional tracking monitor**: Video Stream In TOP, URL
  `http://localhost:8000/video` (annotated MJPEG).
* **Audience data**: WebSocket DAT, network address `localhost`, port `8000`,
  request `/ws`
* **Callbacks DAT**: `td_scripts/td_receive_state.py`
* **Output table**: Table DAT named `audience`

Enable the WebSocket DAT's auto-reconnect option if it is available in your
TouchDesigner build. The server sends a fresh snapshot on connect and refreshes
that snapshot periodically while the scene is quiet, so reconnects should heal
the table automatically.

The `audience` table columns are:

```text
gid visible cx cy x1 y1 x2 y2 floor_x floor_y floor_valid zone
```

`cx`, `cy`, and `bbox` are camera pixels. `floor_x` and `floor_y` are top-down
floor coordinates when calibration is enabled. `zone` is a configured floor
region when zones are enabled.

Sanity check:

```bat
curl http://localhost:8000/api/stats
curl http://localhost:8000/api/audience
curl http://localhost:8000/api/zones/counts
```

## Launch From TouchDesigner

Create a one-cell Table DAT named `enter_blackbox_root` containing the absolute
path to the monorepo, for example `C:\shows\enter-the-blackbox`. Alternatively,
set `ENTER_BLACKBOX_ROOT` in Windows before starting TouchDesigner.

Create a Table DAT named `tracker_presets`:

```text
name,source,backend,device,port,reid,confidence,image_size,debug,config
TD RTSP,rtsp://127.0.0.1:8554/audience,real,cuda,8000,1,0.15,1280,0,C:\show\venue-config.json
Mock Test,0,mock,auto,8000,0,0.30,960,0,apps\runner\dev\trackingbox.config.json
```

Add `td_scripts/td_launch_tracker.py` to a Text DAT named
`td_launch_tracker`. Then wire Button COMPs to:

```python
mod('td_launch_tracker').launch_selected()
mod('td_launch_tracker').stop()
mod('td_launch_tracker').restart_selected()
```

Optional DATs:

* `selected_preset` - first cell contains the preset name to launch. If omitted,
  the first preset row is used.
* `tracker_status` - receives one-line launch/stop status messages.

The launcher reads these columns:

| Column | Effect |
|---|---|
| `name` | Human-readable preset name. |
| `source` | Tracking input; normally `rtsp://127.0.0.1:8554/audience`. |
| `backend` | `real`, `mock`, or `auto`. |
| `device` | `cuda`, `cpu`, or `auto`. |
| `port` | API/video/WebSocket port. |
| `reid` | `1` enables ReID; `0` adds `--no-reid`. |
| `confidence` | Sets `AT_DETECTOR_CONFIDENCE_THRESHOLD`. |
| `image_size` | Sets `AT_DETECTOR_IMAGE_SIZE`. |
| `debug` | Sets `AT_OVERLAY_DEBUG`. |
| `config` | Absolute config path, or a path relative to the monorepo root. |

## Floor Projection

For top-down instancing, zones, and game logic, use `floor_x` and `floor_y`
instead of the camera pixel center. The service computes those coordinates from
the bottom-center of each bounding box, with optional fisheye correction.

Run the tracker with a local calibrated config:

```bat
services\trackingbox\scripts\run_windows.bat --config C:\show\venue-config.json
```

When calibration is disabled, the table still includes the floor columns, but
`floor_valid` is `0` and both floor values are `0`. After calibration,
`floor_valid` becomes `1`.

Calibration runbook: [Floor Projection Calibration](floor_projection.md).

## Floor Zones

Zones are named regions in the calibrated floor plane. They are configured in
`config.json`, appear per person as `zone`, and are counted at:

```bat
curl http://localhost:8000/api/zones/counts
```

In TouchDesigner, use:

* `td_receive_state.py` for the per-person `zone` column.
* `td_fetch_zone_counts.py` to fill a Table DAT named `zone_counts`.

Zone runbook: [Floor Zones](zones.md).

## Useful Options

| Flag / env | Effect |
|---|---|
| `--no-reid` | Detection + tracking only (fallback when torchreid won't install). |
| `--device cuda` | Force GPU. |
| `--source rtsp://...` | Override the TouchDesigner RTSP URL. |
| `AT_DETECTOR_IMAGE_SIZE=960` | Lower means more FPS; higher helps small/distant people. |
| `AT_DETECTOR_CONFIDENCE_THRESHOLD=0.35` | Detection confidence. |
| `AT_REID_SIMILARITY_THRESHOLD=0.6` | Min similarity to recover a GID after occlusion. |
| `AT_REID_REBIND_VETO_THRESHOLD=0.35` | Below this, a returning track id is treated as a different person. |
| `AT_OVERLAY_DEBUG=true` | Draw confidence under each GID. |

Installing ReID (if not done by the installer):

```bat
services\trackingbox\.venv\Scripts\python -m pip install -e "services\trackingbox[reid]"
```

Then set the preset `reid` column to `1`.

## Troubleshooting

Run `audience-tracker doctor` first; it pinpoints most setup issues.

| Symptom | Likely cause | Fix |
|---|---|---|
| `doctor`: "PyTorch installed but CUDA NOT available" | CPU-only torch wheel | Re-run `services\trackingbox\scripts\install_windows.bat`, or reinstall torch from the CUDA index. |
| Low FPS, GPU idle in Task Manager | Running on CPU torch | Confirm with `doctor`; expect CUDA to be available. |
| Installer: "No suitable Python found" | Python missing or 3.13+ only | Install Python 3.11 and tick "Add to PATH". |
| Video Device In TOP cannot open the camera | Another process owns the device | Stop any direct-camera TrackingBox command and other camera apps; TouchDesigner must be the sole owner. |
| `Could not open video source: 'rtsp://...'` | RTSP output is inactive or its URL differs | Turn on `audience_rtsp_out`, confirm port `8554` and stream name `audience`, then restart TrackingBox. |
| Tracking freezes after a TouchDesigner restart | The RTSP server disappeared | Make `audience_rtsp_out` Active, then restart TrackingBox; the game server reconnects automatically. |
| API responds but tracking is frozen | Pipeline thread died after a persistent fault | `curl http://localhost:8000/health` — `pipeline_running: false` confirms it; check the service logs and restart. |
| Video Stream In TOP stays black | Service down or wrong URL | Check `http://localhost:8000/health`; URL must be `http://localhost:8000/video`. |
| WebSocket DAT will not connect | Wrong address/port or firewall | Use `localhost` / `8000` / `/ws`; allow Python through Windows Firewall. |
| Audience table stops refreshing | WebSocket DAT dropped and did not reconnect | Enable auto-reconnect on the WebSocket DAT, then pulse Active off/on. The server resends a full snapshot after reconnect. |
| `ModuleNotFoundError: No module named 'gdown'` | An older ReID install is missing torchreid's weight downloader | Run `services\trackingbox\.venv\Scripts\python -m pip install gdown`, then start TrackingBox again. |
| `pip install .[reid]` fails | `torchreid` build issue on Windows | Keep `reid` set to `0`, or install `deep-person-reid` from source. |
| Small/distant people missed | Detection input too low-res | Raise `image_size` to `1280`; lower `confidence`. |
| Need more FPS | Model/input too heavy | Lower `image_size`, keep ReID off, ensure CUDA is active. |

TouchDesigner-side script details: [td_scripts/README.md](../td_scripts/README.md).
