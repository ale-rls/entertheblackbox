# Venue installation guide

Provision and acceptance-test the exact production mini PC before launch and
use it for the final soak test. Minimum hardware is 16 GB RAM, a 256 GB SSD,
wired Ethernet, and preferably a UPS. Use Ubuntu LTS or ChromeOS Flex.

## Physical installation

1. Mount the computer with ventilation and service access. Label its power,
   display, and Ethernet cables and connect it to a surge protector or UPS.
2. Use wired Ethernet. Reserve/document its network identity and verify the
   venue firewall permits HTTPS/WSS to the application, CDN/object storage,
   monitoring, time synchronization, and the private VPN.
3. Connect the display, select the correct input, disable overscan, and verify
   native resolution, audio, and an audio-enabled autoplay test.
4. Place the printed power-cycle procedure and escalation contact beside the
   computer without exposing credentials.

## Firmware and operating system

- Enable **power on after AC loss** in BIOS/UEFI and test it by removing and
  restoring upstream power during a scheduled drill.
- Set automatic login for a dedicated unprivileged kiosk account. Do not use an
  administrator account for the browser session.
- Disable sleep, suspend, screen blanking, lock-screen prompts, notifications,
  update pop-ups during opening hours, and any display power-saving timer.
- Enable automatic security updates in a controlled maintenance window and
  automatic time synchronization. Re-test the kiosk after OS/browser updates.
- Install the private VPN (for example, Tailscale), restrict membership to
  approved operators, require MFA, and keep admin access private. The public
  display and phone routes must not depend on VPN access.

## Kiosk browser and boot sequence

Configure the browser to launch only after networking is online, using the
production display URL under `/display/`. Use Chrome or Chromium kiosk mode
with a dedicated profile and at least these flags:

```text
--kiosk
--autoplay-policy=no-user-gesture-required
```

Do not add flags that disable TLS checks, browser security, or certificate
validation. Confirm the browser has no toolbars, cursor, context menu, password
prompts, first-run dialogs, or session-restore bubble during normal operation.

Install `scripts/kiosk/smartphonecracy-kiosk.service` and copy
`scripts/kiosk/kiosk.env.example` to `/etc/smartphonecracy/kiosk.env`, replacing
the example URL. Install the repository at `/opt/smartphonecracy`, then run
`systemctl daemon-reload && systemctl enable --now smartphonecracy-kiosk`.
The unit and launcher:

- wait for usable network connectivity before starting the browser;
- restart Chrome/Chromium after a crash or hang without creating competing
  kiosk instances;
- start automatically after login/boot and use bounded restart backoff;
- write local diagnostic logs without visitor data; and
- remain compatible with the server's authenticated second-display replacement
  behavior.

Systemd owns bounded-backoff restart behavior; the launcher also uses `flock`
to prevent competing instances. Diagnostic output is available through
`journalctl -u smartphonecracy-kiosk`. Verify the unit name, log access,
restart limits, and operator commands in `infra/provisioning.md`.

## Acceptance checklist

- [ ] Hardware meets 16 GB RAM / 256 GB SSD minimum and has adequate cooling.
- [ ] Wired Ethernet, display/audio, UPS, and cable labels are verified.
- [ ] BIOS/UEFI power-after-loss recovery is enabled and tested.
- [ ] Dedicated kiosk account logs in automatically without admin privileges.
- [ ] Sleep, blanking, lock screen, notifications, and disruptive updates are
      disabled or scheduled outside opening hours.
- [ ] System clock synchronizes correctly.
- [ ] Private VPN works for approved operators with MFA; admin is not public.
- [ ] Browser launches `/display/` after network readiness with kiosk and
      autoplay flags; HTTPS/WSS certificate validation remains enabled.
- [ ] Audio-enabled video autoplays and all production media verify locally.
- [ ] Killing Chrome causes the watchdog to relaunch it and return to idle.
- [ ] Removing/restoring power returns automatically to the idle screen without
      developer intervention.
- [ ] Disconnecting/reconnecting Ethernet shows a clear reconnecting state and
      recovers automatically.
- [ ] During a test session, disconnecting the venue computer's network without
      closing the browser makes the server end the headless session after about 30
      seconds; restoring the network returns the display to idle.
- [ ] A test phone joins by QR and the admin status reports a fresh display
      heartbeat.
- [ ] Venue staff complete the printed power-cycle procedure without SSH.
- [ ] Monitoring sees cloud health, display heartbeat, and venue-network checks.

After provisioning, run the complete venue acceptance test and the final
48-hour soak on this computer with the locked production scenario and full
production media volume. Record browser/OS versions, hardware serial/model,
configuration date, test results, and the person approving the installation.
