# Local installation operations runbook

This runbook is for museum floor staff and the technical operator. Keep a
printed copy beside the installation computer. Recovery drills and software
changes happen outside visitor hours.

The installation computer serves the display, phone client, admin interface,
scenario, and media on the venue network. An interrupted session may be
discarded and returned to idle; preserving a broken live session is not an
operational goal.

## Daily opening check

1. Confirm the screen shows the idle/attract experience, not a browser error or
   reconnecting message.
2. Open the protected admin page and confirm readiness, display connectivity,
   heartbeat age, participant count, session, and phase look plausible. Never
   share the admin token with visitors.
3. Confirm local `/healthz` and `/readyz` return HTTP 200.
4. Scan the displayed QR with a test phone, join, and close the test session
   with the admin control. Confirm the display returns to idle.
5. Check the installation computer, display, local network equipment, and UPS
   for loose cables or warning lights.

## Join-rate network check

The current limit is 30 join attempts per source IP per 60 seconds. During
acceptance, test a doors-open burst at the full 30-phone capacity, including
reconnects. Re-test if the network topology changes or if many phones appear to
the server behind one shared address.

## Staff power-cycle procedure

1. Tell visitors the installation is temporarily unavailable and stop new
   sessions. A power cycle aborts any active session.
2. Record the screen message and current time.
3. Check display power/input and reseat the display and network cables once.
4. Press the computer power button briefly and wait up to two minutes for idle.
5. If it does not recover, hold the power button for about ten seconds, wait ten
   seconds, and press it once to start it.
6. Wait up to five minutes, confirm idle appears, and repeat the QR opening
   check.
7. If recovery fails, leave the computer powered, record the visible error, and
   contact the technical operator. Do not enter BIOS, reinstall software, or
   factory-reset equipment.

## Incident triage

- **Health and readiness both fail:** keep the installation closed. Check the
  local server process, logs, scenario, media manifest, disk, and last change.
- **Server healthy, display heartbeat missing:** restart the kiosk browser, then
  power-cycle if it does not recover.
- **Display says reconnecting:** verify the local server and network, wait two
  minutes, then power-cycle if it persists.
- **Media retry exceeds two minutes:** close the installation and verify the
  locked media files and manifest. Do not replace files during opening hours.
- **Repeated session aborts:** use the admin `idle` control once and escalate
  with timestamps and the visible phase/session identifiers.
- **Disk, memory, or temperature warning:** close the installation before the
  computer becomes unstable and contact the technical operator.

Do not record participant IP addresses or unnecessary visitor data.

## Monitoring

Monitor the local server process, display heartbeat, free disk space, memory,
temperature, and process restarts. Alerts should reach both the technical
operator and museum duty contact.

| Signal | Alert condition | First response |
|---|---|---|
| `/healthz` or `/readyz` | unavailable for 2 minutes | Check the local server and logs; keep the installation closed. |
| Display heartbeat | absent for 2 minutes while server is healthy | Restart the kiosk browser, then power-cycle if needed. |
| Media verification | retrying for more than 2 minutes | Verify local media and manifest integrity. |
| Disk space | below the agreed reserve | Rotate diagnostics and investigate unexpected growth. |
| Memory or restarts | sustained growth or repeated restart | Compare with the hardware soak baseline. |
| Temperature | above the hardware-approved range | Check ventilation and close the installation if needed. |

## Handoff package

The museum should receive:

- source repository and automated tests;
- locked scenario, manifest, and production media;
- installation configuration and credential-transfer procedure;
- venue installation guide and this runbook;
- restorable system image or configured spare computer;
- monitoring destinations and named escalation contacts; and
- recorded hardware, OS, browser, and application versions.

The receiving operator should complete the opening check and one supervised
power cycle without developer assistance before sign-off.
