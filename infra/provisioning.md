# Production provisioning record

> **Pending decision:** this checklist assumes the cloud (Fly.io/Supabase/CDN)
> design. The cloud-vs-on-premises architecture decision is open in issue
> [#37](https://github.com/ale-rls/smartphonecracy-runner/issues/37) — do not
> provision any of these resources until it is resolved.

No production resource is created from this repository without an approved
operator session. Record resource identifiers and secret-manager references
here, never secret values.

## Required operator inputs

- Fly organisation, application name, production region, deploy token, and
  approved domain.
- Paid Supabase project, direct/pooled connection choice, backup/PITR policy,
  and a restricted database credential.
- Object-storage/CDN provider, immutable media origin, purge policy, and domain.
- DNS control, venue opening hours/timezone, notification destinations, and
  named technical/venue alert owners.
- Production display URL, phone join URL, installation/room IDs, admin token,
  grant secrets, and their rotation owner.

## Provisioning checklist

- [ ] Create the Fly app in the venue-nearest region and apply `infra/fly.toml`.
- [ ] Set runtime values with `fly secrets set`; do not put them in CI variables
      except the narrowly scoped deploy token. Confirm one machine remains on.
- [ ] Create the paid Supabase project, apply `infra/migrations/`, restrict
      ingress/roles, enable the approved backup policy, and store `DATABASE_URL`
      only as a Fly secret.
- [ ] Upload hash/version-addressed media to object storage, enable HTTPS and
      CDN caching, verify CORS for the application domain, and retain the prior
      release for rollback.
- [ ] Configure the application/domain certificates and verify HTTPS and WSS.
- [ ] Configure external probes for `/healthz`, `/readyz`, the venue network,
      and the authenticated admin status used for display-heartbeat age.
- [ ] Configure log/event alerts for media retry over 2 minutes, repeated
      reconnects, abort frequency/failure to return idle, database-queue
      degradation, and scenario/deployment validation failure.
- [ ] Configure provider metrics alerts for memory and machine restart spikes.
- [ ] Route urgent alerts to both technical on-call and venue duty contacts.
- [ ] Install `scripts/kiosk/smartphonecracy-kiosk.service` and `kiosk.env` on
      the mini PC; enable it with `systemctl enable --now`.
- [ ] Record all resource IDs, secret references, owners, and renewal dates.

## Alert drill record

Thresholds below are the minimums from the implementation plan. Fill any
director-dependent threshold before activation.

| Failure drill | Expected alert | Threshold | Result/time/owner |
|---|---|---|---|
| Stop application machine | server unavailable | 2 minutes | PENDING |
| Stop kiosk service, server healthy | display heartbeat absent | 2 minutes within opening hours | PENDING |
| Disconnect venue uplink | venue check and heartbeat absent | 2 minutes | PENDING |
| Serve corrupt media | media retry continuous | 2 minutes | PENDING |
| Force repeated aborts | abort frequency/recovery | DIRECTOR VALUE REQUIRED | PENDING |
| Exhaust DB connectivity | write queue degraded/growing | OPERATOR VALUE REQUIRED | PENDING |
| Memory/restart fault injection | memory/restart spike | SOAK BASELINE REQUIRED | PENDING |

For every drill, record alert-open time, both notification deliveries,
acknowledgement time, recovery time, and dashboard link. Do not record visitor
IP addresses. Live drills happen only in a closed-venue window.

## Kiosk verification

Run `systemctl kill -s KILL smartphonecracy-kiosk`, then confirm systemd starts
one replacement browser and the display returns to idle. Inspect privacy-safe
logs with `journalctl -u smartphonecracy-kiosk`; the launcher logs availability
and process failures only. Test boot after power removal, network loss/recovery,
and the `StartLimitBurst` failure state before operational sign-off.
