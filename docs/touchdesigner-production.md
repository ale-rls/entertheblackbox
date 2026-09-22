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
   **Frame Start**, name it `cue_execute`, and load
   `services/trackingbox/td_scripts/td_cue_execute.py` as its callbacks.
   The loader executes the full receiver in one shared namespace and retains
   it in operator storage, avoiding missing class/global names in DAT execution.

```python
# Start or restart the receiver in an already open project:
op('cue_execute').module.onStart()
```

Run that command from the component containing the DATs. After editing the
receiver Text DAT, run it again to reload the full source. Do not use the old
`mod('td_receive_production')` callbacks alongside this loader.
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

Optional one-shot cues: call `namespace['pump'](on_cue=my_callback)` from the frame callback.
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

For a monitor that displays the question title and switches to a final
five-second countdown, see [Question title and countdown monitor](touchdesigner-question-monitor.md).

## Studio device preview

Studio’s **Preview on devices** panel provides a separate SSE URL and bearer
token for a draft rehearsal. Point the receiver to both values from that panel,
then trigger the phase again. The event format is identical to production;
preview has its own boot ID, sequence, and timeline snapshots. Keep the normal
production receiver on `/api/cues` with the production display token. Preview
ends explicitly, after two hours without a Studio phase trigger, or on restart.
