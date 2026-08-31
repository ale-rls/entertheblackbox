# E2E + reliability suite (STEP-023)

Run with `pnpm test:e2e` from the repo root. The script builds the real
display/phone/admin bundles, then drives them with Playwright against real
server processes (spawned per test — tests kill and restart them). Serial by
design; expect ~2 minutes.

## Automated coverage (plan §16)

| Acceptance item | Spec |
| --- | --- |
| Full scenario: join → lobby → video → both question kinds → idle | `full-flow.spec.ts` |
| Stable parameter-free join URL and named join form | `full-flow.spec.ts` |
| Server kill mid-session: display self-reconnects, idle attract returns, fresh phone can join | `reliability.spec.ts` |
| Display kill mid-session: abort to idle after display-disconnect timeout, replacement display recovers | `reliability.spec.ts` |
| Second display replaces the first; old kiosk shows a prominent notice | `reliability.spec.ts` |
| Stale bundle (version mismatch) receives reload and reconnects — display and phone | `reload-clock.spec.ts` |
| Countdown correct under ±device clock skew (server-corrected time) | `reload-clock.spec.ts` |
| Media failure: visible retry state, self-recovery once media is restored | `media-retry.spec.ts` |

The stale-bundle tests pin the server's `BUILD_VERSION` away from the
`0.0.0-dev` baked into the bundles; all other tests pin them equal (see
`helpers/server.ts`) so the STEP-031 reload path doesn't fire spuriously.

## Manual Phase 7 items (not automatable here — see STEP-025)

- 30-client load test on venue hardware (`pnpm simulate-clients`, STEP-020).
- 48 h soak on the exact production mini PC with production media.
- Venue acceptance test: kiosk boot flags, watchdog, power-cycle procedure.
- Real iOS/Android trackpad sensitivity tuning on physical phones.
- Alert drills (media-retry > 2 min, abort frequency, restart spikes — STEP-024).
