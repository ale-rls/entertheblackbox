# TouchDesigner integration scripts

Drop-in Python for wiring TouchDesigner to a local `audience-tracker serve`
process. Full setup is in the runbook:
[Run with TouchDesigner](../docs/touchdesigner.md).

These run inside TouchDesigner's Python, so they are templates/components and are
not imported by the Python package.

| File | Purpose |
|---|---|
| `td_launch_tracker.py` | Reads a preset Table DAT and launches/stops the local tracker service. |
| `td_receive_state.py` | WebSocket callbacks that keep the `audience` table in sync. |
| `td_fetch_zone_counts.py` | Polls `/api/zones/counts` into a `zone_counts` table. |

TouchDesigner owns the camera. Branch its Video Device In TOP directly into the
visuals and into a Video Stream Out TOP configured as an RTSP Server on port
`8554`, stream name `audience`, using H.264. TrackingBox reads
`rtsp://127.0.0.1:8554/audience`; TouchDesigner consumes its state with:

* **WebSocket DAT**: `ws://localhost:8000/ws`
* **Callbacks DAT**: `td_receive_state.py`
* **Zone counts**: call `mod('td_fetch_zone_counts').poll()`

The optional annotated diagnostic feed remains available at
`http://localhost:8000/video`.

`td_launch_tracker.py` expects a Table DAT named `tracker_presets`. Add one row
per camera/server preset:

```text
name,source,backend,device,port,reid,confidence,image_size,debug,config
TD RTSP,rtsp://127.0.0.1:8554/audience,real,cuda,8000,1,0.15,1280,0,C:\show\venue-config.json
Mock Test,0,mock,auto,8000,0,0.30,960,0,apps\runner\dev\trackingbox.config.json
```

Create a one-cell DAT named `enter_blackbox_root` with the monorepo's absolute
Windows path, or set `ENTER_BLACKBOX_ROOT` before launching TouchDesigner.

Optional helper DATs:

* `selected_preset` - first cell contains the preset name to launch. If omitted,
  the first preset row is used.
* `tracker_status` - receives one-line launch/stop status messages.

Button callbacks:

```python
mod('td_launch_tracker').launch_selected()
mod('td_launch_tracker').stop()
mod('td_launch_tracker').restart_selected()
```

Only GIDs cross the boundary; tracker ids never leave the service.

For top-down floor positions, calibrate the venue camera and use `floor_x` /
`floor_y` instead of `cx` / `cy`. See
[Floor Projection Calibration](../docs/floor_projection.md).

For named floor regions and counts, see [Floor Zones](../docs/zones.md).
