# Janus phone audio — disabled in production

The experimental `/phone-janus/` code is retained for future development.
Use `/phone/` for the active Icecast setup.

## Production disabled

Janus is disabled in the production Compose stack while connectivity and host
resource issues are investigated. No Janus services build or start. The show
server's Janus configuration is explicitly empty. The code below is retained
for future development, not an active deployment guide.

Use `/phone/` for Icecast and restore `PHONE_JOIN_BASE_URL` to `/phone/` if needed.
Stop any old Janus containers in Coolify; redeployment may leave removed services
as orphans. See the [shutdown instructions](../../deploy/coolify/README.md#janus-disabled).

## Network and capacity

`JANUS_PUBLIC_IP` is advertised instead of the container address. Match UDP port
mappings through NAT. Linux is the deployment target; container-VM networking
on macOS/Windows requires separate reachability validation. Janus HTTP supports
CORS when its domain differs from the phone UI. Use HTTPS for both.

Restrictive networks may need TURN; no TURN server is bundled. Example browser
configuration (use your own tested server and credentials):

```dotenv
JANUS_ICE_SERVERS=[{"urls":"turn:turn.example.org:3478","username":"trial","credential":"configured-turn-credential"}]
```

TURN credentials are sent to authenticated phone clients and must be suitably
scoped. They are separate from private management and bridge secrets.

Each provisioned slot runs its own mix and encoder. `JANUS_PLAYERS=100` is not
evidence the host/Wi-Fi supports 100 participants; measure on venue hardware.
`janus-audio` and `janus-beds` are separate persistent volumes. The default bed
is generated silence.

## Behavior

- Server-side personal narration, group overrides and independent group paths
  reuse `PersonalAudio` cue selection, resets and elapsed-time offsets.
- Late joins and recovery join the current scene rather than replaying its start.
- Background music and rehearsal soundcheck use the existing Admin controls.
  Music commands fan out to configured audio backends; failure is reported.
  Soundcheck targets the participant's chosen backend. Diagnostics label each
  participant's transport and show both backends' combined capacity.
- The phone reuses its media element and retains playback intent across recovery
  and scene suspension. Explicit pause remains paused. Failed connections retry
  with bounded backoff and refresh private mount credentials.
- Synchronized prerecorded soundtrack scenes still use the existing foreground
  Web Audio mode, suspending streaming during those scenes.
- Studio rehearsal URLs can also use `/phone-janus/?rehearsal=<id>`.
- Ending a show or changing audio route destroys the old mount and disconnects
  subscribers before slot reuse. Each allocation gets a fresh PIN. Bridge restart
  revokes old personal mounts; source epochs trigger cue/music restoration.

The controller can only recover while the browser permits it to run. Real-device
locked-screen operation, missed speech, network interruption recovery and
cue-to-ear latency remain **venue acceptance tests**, not guarantees from unit
or desktop browser checks. Background music follows the existing phone scene
activation rules; silent/inactive phases can suspend phone playback.

## Verification and operation

Janus v1.4.2 is pinned to commit `0a24110ae55a172c4293749b763dbb66a138f9ec`.
Only Streaming and HTTP signaling are compiled; admin HTTP is disabled.
The public signaling API does not include per-user rate limiting.

Coolify provides service health and logs. A healthy container does not prove
that a phone can receive UDP media. Use the real phone soundcheck after deploy.
The shared listener at `JANUS_PUBLIC_URL/` is a diagnostic page for shared mount
1; it does not receive personal narration and has no shared audio source by
default. Show participants should use `/phone-janus/`.

Developer checks:

```sh
python3 -m unittest discover -s services/audio-janus/tests
node --check services/audio-janus/web/listener.js
pnpm -r typecheck && pnpm -r test
```

Before show use: compare acoustic median/p95/max delay against Icecast on wired
headphones, test Bluetooth separately, run a full locked-phone show on iOS and
Android, exercise group transfers/late joins/silent gaps/pause/resume/network loss,
and repeat at audience load. A proposed p95 target below 300 ms is not a measured
result. WebRTC can lose or conceal samples during congestion and does not ensure
sample-accurate synchronization between phones.

References: [Janus Streaming](https://janus.conf.meetecho.com/docs/streaming),
[Janus signaling](https://janus.conf.meetecho.com/docs/rest),
[Playback reference](https://github.com/Public-Shorts/playback).
