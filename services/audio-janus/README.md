# Janus phone audio in the production stack

`/phone-janus/` uses the same phone UI, admission, voting, subtitles and show clock
as `/phone/`, with WebRTC audio. `/phone/` continues to use Icecast. Both routes
participate in the same production show. Use one route per phone: the routes
share participant identity, and switching routes releases that participant's
previous audio backend.

The production entry point is [`deploy/coolify/docker-compose.yml`](../../deploy/coolify/docker-compose.yml).
Janus runs in that existing application and its default Docker network. There
is no separate Janus Compose deployment or cross-application bridge URL.

```
production frontend → janus-bridge:8090 → janus-liquidsoap → Opus/RTP → janus
phone-janus ← WebRTC media from janus
phone-janus ↔ HTTPS signaling through janus-web
```

The Janus mixer and media volumes are independent of the existing Icecast mixer
and volumes. The bridge reuses command/registry Python helpers at image build
time. Production cue selection and group membership come from the same show
server that drives Icecast.

## Deploy using the existing Coolify application

1. Update the existing application's repository checkout to this change. Keep
   Base Directory `/` and Compose Location `/deploy/coolify/docker-compose.yml`.
   If the resource contains manually pasted Compose, replace it with this file.
   Keep the existing domains and persistent volumes.
2. Add the following runtime Environment Variables in that application:

   | Variable | Value |
   |---|---|
   | `JANUS_PUBLIC_URL` | HTTPS domain for `janus-web`, e.g. `https://janus.example.org` |
   | `JANUS_PUBLIC_IP` | Host IPv4 address reachable by audience phones |
   | `JANUS_ADMIN_KEY` | Unique random 32–128 character secret, letters/digits/hyphens |
   | `JANUS_BRIDGE_TOKEN` | Different random secret, at least 32 characters |
   | `JANUS_LISTENER_PIN` | 8–64 letters/digits for the optional shared listener |
   | `JANUS_PLAYERS` | Participant capacity; default `30`, allowed 1–100 |
   | `JANUS_ICE_SERVERS` | Default `[]`; configure TURN if needed |

   Generate the secrets in a password manager. `JANUS_BRIDGE_URL` is already
   fixed to `http://janus-bridge:8090` in Compose; remove any old external override
   from the Coolify environment editor.
3. Assign the domain from `JANUS_PUBLIC_URL` to **janus-web**, container port 80.
   Point its DNS to this host. Do not assign public domains or host TCP ports to
   `janus`, `janus-bridge` or `janus-liquidsoap`. The control bridge stays private.
4. Allow host UDP **20000–20200** through the host/cloud firewall using its UI.
   HTTPS carries signaling; the UDP ports carry the audio and must be reachable.
5. Click **Deploy** in the existing application. No profiles or custom startup
   commands are needed. The deployment builds the phone and Admin clients too.
6. Open `/phone-janus/`, join and tap **Start headphones**. Use
   `/admin/` → **Headphone streams** for music/soundcheck and
   `/admin/?view=audio` for per-phone diagnostics. Optionally set
   `PHONE_JOIN_BASE_URL` to the frontend HTTPS URL ending in `/phone-janus/`
   to direct the show QR codes there.

All four added services (`janus`, `janus-web`, `janus-liquidsoap`, `janus-bridge`)
appear in the same Coolify application for logs and restarts. The existing
Icecast services and volumes retain their names. The frontend's startup does
not wait for Janus health, so a Janus outage does not prevent Icecast startup;
Janus failures appear in audio diagnostics. Required Janus variables must still
be set for Compose to accept the configuration before deployment.

The former separate Janus Compose definitions have been removed. If you already
created a separate Janus application, stop it before deploying this version on
the same host so it releases UDP 20000–20200. Do not delete the production
PocketBase or Icecast volumes.

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
