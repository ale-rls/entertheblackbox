# Venue installation guide

Provision and acceptance-test the exact museum mini PC before launch. Minimum
hardware is 16 GB RAM, a 256 GB SSD, wired Ethernet, and preferably a UPS. Use
a museum-supported long-term-support operating system.

## Physical installation

1. Mount the computer with ventilation and service access. Label power,
   display, and network cables and connect it to a surge protector or UPS.
2. Use a dedicated installation network for visitor phones. Document the
   computer and access-point configuration; the live work must not require an
   Internet connection.
3. Connect the display, disable overscan, and verify native resolution, audio,
   and audio-enabled autoplay.
4. Keep the printed power-cycle procedure and escalation contact beside the
   computer without exposing credentials.

## Firmware and operating system

- Enable power-on after AC loss and test it by removing and restoring power.
- Use automatic login for a dedicated unprivileged kiosk account.
- Disable sleep, blanking, lock prompts, notifications, and disruptive updates
  during opening hours.
- Apply OS/browser updates in a controlled maintenance window and repeat the
  opening test afterwards.
- Keep time synchronization enabled and bound diagnostic-log disk usage.
- Set installation-specific admin, display, and QR-signing secrets. Do not use
  the checked-in development defaults at the venue.

## Kiosk browser

Use Chrome or Chromium in kiosk mode with a dedicated profile:

```text
--kiosk
--autoplay-policy=no-user-gesture-required
```

Install `scripts/kiosk/smartphonecracy-kiosk.service` and copy
`scripts/kiosk/kiosk.env.example` to `/etc/smartphonecracy/kiosk.env`, replacing
the example URL with the authenticated local display URL. Install the repository
at `/opt/smartphonecracy`, then enable the service after the local application
server is configured to start at boot.

The browser service restarts Chromium after a crash, prevents duplicate kiosk
instances, and writes diagnostics to the system journal. The local application
server also needs process supervision before venue launch; until its dedicated
unit is added, follow the repository run command during technical testing only.

## Acceptance checklist

- [ ] Hardware, cooling, display/audio, UPS, and cable labels are verified.
- [ ] Power-loss recovery returns automatically to the idle screen.
- [ ] The dedicated kiosk account has no administrative privileges.
- [ ] Sleep, blanking, notifications, and opening-hours updates are disabled.
- [ ] Application and kiosk browser start automatically in the correct order.
- [ ] Production scenario, manifest, and all media validate locally.
- [ ] Audio-enabled video autoplays at the intended resolution.
- [ ] Killing the browser relaunches it and returns the display to idle.
- [ ] Killing the server relaunches it and returns the display to idle.
- [ ] Network interruption and recovery are visible and automatic.
- [ ] Thirty simulated clients and a realistic phone burst pass.
- [ ] Disk, memory, restart, heartbeat, and temperature monitoring work.
- [ ] Venue staff complete the printed power-cycle procedure without SSH.
- [ ] A restorable disk image or configured spare computer is available.

Run at least a seven-day soak on the exact hardware with production media and
repeated automated sessions. Record hardware, OS/browser/application versions,
maximum memory and temperature, restart count, test results, and approver.
