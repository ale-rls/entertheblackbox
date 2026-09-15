# Production monitor labels

The server already pushes complete question fields, including labels, through
`https://bb-frontend.enabler.space/api/cues`. Redeploying this server source
registers that endpoint automatically. Set `DISPLAY_TOKEN` in the deployment;
use that same value in TouchDesigner. This is a persistent HTTP SSE connection.
It needs no Python packages and does not occupy the browser display slot.

## TouchDesigner setup

1. Load `services/trackingbox/td_scripts/td_receive_production.py` into a Text DAT
   named `td_receive_production` in your component.
2. Create a private Text DAT named `display_token`, containing only the production
   `DISPLAY_TOKEN`. Keep it out of git.
3. Create Table DATs named `labels`, `timelines`, and `cue_status` beside it.
4. Create an Execute DAT in the same component. Enable **Start**, **Exit**, and
   **Frame Start**, and use these callbacks:

```python
def onStart():
    mod('td_receive_production').start()

def onFrameStart(frame):
    mod('td_receive_production').pump()

def onExit():
    mod('td_receive_production').stop()
```

For an already open project run `mod('td_receive_production').start()` once.
Network reads run in a background thread; only the frame callback updates DATs.

The labels table contains `key, timeline, slot, text, phase_id`.
For a horizontal spectrum on timeline `ki`, use these Python expressions in
the Text TOPs driving the two monitors:

```python
# Start monitor (for example M2)
str(op('labels')['ki:x_min', 'text']) if op('labels')['ki:x_min', 'text'] is not None else ''
# End monitor (for example M4)
str(op('labels')['ki:x_max', 'text']) if op('labels')['ki:x_max', 'text'] is not None else ''
```

Replace `ki` with the timeline shown in the table (`main` for the shared show).
Vertical spectra use `y_min`/`y_max`; cross questions expose all four slots;
polygon fields use their zone IDs. Match these slots to the physical monitor
placement. A phase without labels clears that timeline's labels.

Optional one-shot cues: call `pump(on_cue=my_callback)` from the frame callback.
The callback receives the full event; its cue name is `event['payload']['cue']`.
Reconnect snapshots restore state without replaying one-shot cues. Missed
one-shot cues during an outage are not replayed. The status DAT reports the
connection, server boot ID and sequence. Existing labels are held during an
outage and replaced on reconnect, including after a deployment.

The server writes each phase immediately; TouchDesigner applies it on the next
frame after receipt. Internet latency and proxy buffering affect actual timing.
Ensure the reverse proxy streams `/api/cues` without buffering/compression.
The receiver requests identity encoding. This feed carries labels and show
cues, not body positions. Do not attach an extra `display_join` client to `/ws`
for labels: it replaces the active browser display.

Check the endpoint using a locally configured token:

```sh
curl -N -H "Authorization: Bearer $DISPLAY_TOKEN" -H 'Accept-Encoding: identity' https://bb-frontend.enabler.space/api/cues
```

Expect an immediate `data:` snapshot, phase events when the show advances,
and heartbeat comments every 15 seconds. A 401 means the token is missing or
incorrect. Reconnect after redeploy should produce a new boot ID.
