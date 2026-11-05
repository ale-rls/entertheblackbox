# Coolify production deployment

The production stack runs `frontend` (server, display/monitors, Studio and Admin),
`realtime`, and `pocketbase`. Participant devices use the native iOS/Android app
with downloaded audio. Browser participant clients and Icecast/Liquidsoap/Janus
services are retired.

## Deploy

1. Use the repository root as the Compose project directory and
   `deploy/coolify/docker-compose.yml` as the Compose file.
2. Configure variables from `.env.example`: public HTTPS PocketBase/frontend,
   WSS relay, installation identity, distinct display/join secrets and existing
   PocketBase credentials. `PHONE_JOIN_BASE_URL` still ends in `/phone/`; that
   address now displays native-app joining instructions for printed QR codes.
3. Assign public domains to frontend (port 80), realtime (9001) and PocketBase
   (8090). Keep existing PocketBase and native-shows volumes.
4. Deploy, then check `/healthz`, `/readyz`, `/admin/` and `/studio/` on frontend.
5. Publish the matching native show channel and run the corresponding server
   scenario. Channel publishing alone does not activate a scenario.
6. Open the main display and [four monitor pages](../../docs/monitor-displays.md).
   Wait for verified downloads on every screen and native participant device.
   Rehearse with the actual devices and network.

## Migration from streaming delivery

Stop/remove old `icecast`, `liquidsoap`, `bridge`, and any Janus containers through
Coolify when deploying the new stack. Remove their domains and unused secrets.
Do not delete existing volumes as part of this change: historical audio volumes
remain declared for preservation, but no running service mounts them. The server
ignores legacy streaming environment variables, including stale saved values.
The default production build no longer builds or serves `apps/phone`.

The native-shows volume is mounted at `/app/content/media/native-shows`. Back it
up with PocketBase. It contains immutable downloaded-audio releases and atomic
rehearsal/production channel pointers; it must survive container replacement.
See [native player setup and acceptance](../../docs/native-player.md).

Display tokens are baked into the display build and must match server runtime.
After rebuilding, refresh displays so their service-worker shell is current.
Production uses HTTPS/WSS. No container health check proves audible native
playback or physical monitor synchronization; those require a venue rehearsal.
