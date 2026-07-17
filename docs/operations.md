# Operations runbook

> Hosting-specific references in this runbook (Fly status, Fly metrics/logs)
> assume the cloud design, which is pending the architecture decision in issue
> [#37](https://github.com/ale-rls/smartphonecracy-runner/issues/37). The staff
> procedures themselves are architecture-neutral.

This runbook is for venue staff and the remote technical operator. Keep a
printed copy beside the venue computer. Visitors must never be present during a
deploy, rollback, or recovery drill.

## Daily opening check

1. Confirm the screen shows the idle/attract experience, not a browser error or
   a reconnecting message.
2. Open the protected admin page through the private VPN. Confirm readiness,
   display connectivity, heartbeat age, participant count, session, and phase
   all look plausible. Never share the admin URL or token with visitors.
3. Confirm `/healthz` and `/readyz` return HTTP 200 and check that no monitoring
   alert remains open.
4. Scan the displayed QR with a test phone, join, and then close the test
   session with the admin control. Confirm the display returns to idle.
5. Check the venue computer, display, Ethernet, and UPS for loose cables or
   warning lights.

At closing, leave the computer powered if overnight monitoring or a soak test
is scheduled. Otherwise follow the venue's approved shutdown policy; do not
unplug a running UPS.

## Staff power-cycle procedure

Use this procedure when the display is frozen or blank and the remote operator
cannot recover it. It requires no SSH access.

1. Tell visitors the installation is temporarily unavailable and stop new
   sessions. A power cycle aborts any active session.
2. Photograph or write down the screen message and the current time.
3. Check that the display has power and that its input is set to the venue
   computer. Reseat the display and Ethernet cables once.
4. Press the venue computer's power button briefly. Wait up to two minutes for
   the idle screen. Do not repeatedly press the button while it is booting.
5. If it does not recover, hold the power button for about ten seconds until it
   turns off, wait ten seconds, then press it once to start it.
6. Wait up to five minutes. Confirm the idle screen appears and perform the QR
   opening check above.
7. If recovery fails, leave the computer powered, note any on-screen error, and
   contact the technical escalation owner. Do not enter BIOS, reinstall the
   browser, expose the admin page publicly, or factory-reset equipment.

## Incident triage

- **Cloud health and readiness both fail:** keep the installation closed. The
  technical operator checks Fly status, application logs, the database, and
  the last deployment. Use [deployment.md](deployment.md) for rollback.
- **Server healthy, display heartbeat missing:** check venue power/network,
  then power-cycle using the procedure above. The kiosk watchdog should restart
  a crashed browser automatically.
- **Both heartbeat and venue checks missing:** treat this as a venue computer,
  power, or network incident. Check the UPS, Ethernet, router, and VPN.
- **Display says reconnecting:** wait two minutes. If cloud health is good and
  it persists, power-cycle the venue computer.
- **Media retry exceeds two minutes:** close the installation and escalate.
  Do not bypass media verification or replace production files by hand.
- **Repeated session aborts or failure to return to idle:** close admission,
  use the admin `idle` control once, and escalate with timestamps and recent
  error records.
- **Database queue degradation:** gameplay may continue briefly, but repeated
  or sustained warnings require technical escalation; do not deploy until the
  queue has recovered.

Record the time, visible symptom, actions taken, recovery time, build version,
and any session/phase identifiers. Do not record participant IP addresses or
other unnecessary personal data.

## Monitoring and alerts

The monitoring owner must maintain three independent views: cloud server,
display heartbeat, and venue network/computer. Route urgent alerts to both the
technical on-call contact and the venue duty contact.

| Signal | Alert condition | First response |
|---|---|---|
| `/healthz` or `/readyz` | unavailable for 2 minutes | Check Fly and application logs; keep venue closed if readiness fails. |
| Display heartbeat | absent for 2 minutes during opening hours while server is healthy | Check venue network/browser; power-cycle if needed. |
| Venue-specific network check | missing with display heartbeat | Check power, UPS, Ethernet, router, and VPN. |
| Display reconnects | repeated above the agreed baseline | Correlate with network, deploy, and restart events. |
| Media download/hash retry | continuous for more than 2 minutes | Close installation and inspect CDN/media integrity. |
| Session aborts | above the director-approved threshold, or any failure to recover to idle | Inspect structured events and recent admin errors. |
| Memory or process restarts | spike above the agreed baseline | Inspect Fly metrics; compare with deploy and soak-test results. |
| Database write queue | sustained degradation or growth | Check Supabase connectivity/capacity and buffered-write health events. |
| Participant retention cleanup | any `retention-cleanup-failed` event, or expired vote rows remain after a successful run | Check database connectivity/function permissions, verify manually, and escalate until deletion succeeds. |
| Deployment validation | scenario validation or image build fails | Block production deployment. |

Thresholds not fixed in the implementation plan must be agreed and recorded in
the monitoring dashboard before launch. Test every alert during the staged
failure drills and record its owner, notification route, and escalation timer.
Use the credential/input checklist and alert drill record in
`infra/provisioning.md`; it intentionally records secret-manager references,
not secret values.

## Participant-data retention check

The production privacy commitment is that participant identifiers and final
positions in `votes` are retained only until the configured installation closing
date plus 90 days. The server enforces this by calling
`delete_expired_participant_data(now())` once at every persistence-enabled boot
and again 24 hours after each completed cleanup. Runs cannot overlap. A database
error is logged as `retention-cleanup-failed` without crashing the running show;
the next boot or daily run retries it.

The technical operator must alert on every `retention-cleanup-failed` event and
confirm that a later `retention-cleanup-succeeded` event appears. That success
event includes `cutoff` and `deletedRows`. After the retention deadline, and
after any cleanup failure, verify with read-only database access:

```sql
select count(*) as expired_votes
from votes
where retained_until <= now();
```

The result must be zero after a successful cleanup. If it is not, keep the
incident open, check application/database logs and the migration/function
permissions, then have an authorized database operator run
`select delete_expired_participant_data(now());`. Repeat the read-only query and
record the timestamp and deleted-row count in the privacy operations log. Do not
export participant rows while diagnosing retention, and do not extend
`INSTALLATION_CLOSES_AT` or edit `retained_until` without an approved policy
change.

## Handoff package check

Before operational ownership transfers, confirm receipt of:

- source repository and automated test suite;
- locked production scenario and media manifest;
- database migrations and environment-variable reference;
- deployment configuration, protected deployment access, and rollback guide;
- venue installation guide and this operations runbook;
- admin credential transfer procedure (through an approved secret manager);
- monitoring dashboard, alert inventory, notification routes, and test record;
- approved retention/privacy document, visitor notice, processor list, and
  deletion procedure; and
- named technical and venue escalation contacts, including out-of-hours rules.

The receiving operator should complete the opening check and one supervised
power-cycle without developer assistance before signing the handoff.
