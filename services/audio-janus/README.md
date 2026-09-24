# Independent Janus phone audio

`/phone-janus/` uses the same phone UI, admission, voting, subtitles and show clock
as `/phone/`, with a separate WebRTC audio controller. `/phone/` continues to use
Icecast. Both routes can participate in the same show. Use one route per phone:
the routes share participant identity, and switching routes releases that
participant's previous audio backend.

The Compose stack starts an independent bridge and Liquidsoap mixer by default. It does not change or connect to the existing `services/audio` deployment.
The new bridge reuses its command/registry Python helpers at image build time.

```
show server → Janus control bridge → independent Liquidsoap mix per participant
                                                      ↓ PCM → Opus/RTP
phone-janus ← WebRTC ← Janus private mount per participant
```

## Deploy from Coolify without terminal commands

Create a **separate Git application** for this repository using the Docker Compose
build pack. Keep the Base Directory at `/` and set Docker Compose Location to
`/services/audio-janus/docker-compose.coolify.yml`. The Janus, web, mixer and
bridge services all start by default; no custom command or profile is needed.
The test tone stays disabled.

In this application's Environment Variables, set:

| Variable | Value |
|---|---|
| `JANUS_PUBLIC_IP` | Public IPv4 address of the host, reachable by phones |
| `JANUS_ADMIN_KEY` | Unique random 32–128 character secret, letters/digits/hyphens |
| `JANUS_BRIDGE_TOKEN` | Different random secret, at least 32 characters |
| `JANUS_LISTENER_PIN` | 8–64 letters/digits for the optional shared test page |
| `JANUS_PLAYERS` | Participant capacity, default `30` |

Use your password manager to generate the secrets. Set the domain for **web** to
`https://janus.example.org` (port 80) and **bridge** to
`https://janus-control.example.org:8090`. The `:8090` suffix selects the internal
container port in Coolify; the resulting public control URL is
`https://janus-control.example.org`. Do not assign domains to Janus or Liquidsoap.
The bridge's control endpoints require the bearer token; do not add that token
to a URL. For an entirely private control plane, use a reachable private network
address instead of assigning the bridge a public domain.

Allow inbound UDP **20000–20200** in the host/cloud firewall using its management
UI. DNS for both domains must point to this host. Click **Deploy**. HTTPS carries
signaling; the UDP ports must also be reachable for audio.

In the **existing show application's** Environment Variables, set:

```dotenv
JANUS_BRIDGE_URL=https://janus-control.example.org
JANUS_BRIDGE_TOKEN=<same secret as the Janus application>
JANUS_PUBLIC_URL=https://janus.example.org
JANUS_ICE_SERVERS=[]
```

The updated `deploy/coolify/docker-compose.yml` passes these optional values to
the show server. Leave them empty to keep Janus disabled. Redeploy the show
application to load the configuration and the `/phone-janus/` client. Existing
Icecast configuration and persistent volumes stay in place. If the resource uses
a manually pasted Compose definition, update that definition from the repository
as well.

Open `/phone-janus/` on a phone and tap **Start headphones**; operate soundcheck
and music from `/admin/`, and inspect `/admin/?view=audio`. Optionally change
`PHONE_JOIN_BASE_URL` to the frontend URL ending in `/phone-janus/` for QR codes.
Service logs and restart/deploy actions are in the separate Coolify application.

See [Coolify's Docker Compose documentation](https://coolify.io/docs/applications/builds/docker-compose)
for domain and environment configuration.

## Run the personal backend from a terminal

On a Linux venue host with Docker Compose:

```sh
cd services/audio-janus
cp .env.example .env
# Set JANUS_PUBLIC_IP to the host IPv4 address reachable by phones.
# Generate different JANUS_ADMIN_KEY and JANUS_BRIDGE_TOKEN secrets:
openssl rand -hex 32
openssl rand -hex 32
# Set JANUS_LISTENER_PIN for the optional standalone test page.
docker compose up --build -d
curl http://localhost:8500/health
```

The default is 30 provisioned mixes, configurable with `JANUS_PLAYERS` (1–100).
Provisioning 100 is not evidence that your host/Wi-Fi can sustain 100 participants;
measure on the venue hardware. Audio uploads and beds use independent named
volumes. The mixer generates a default silent bed inside its image.

Set these environment variables on the **show server**, then restart it:

```dotenv
JANUS_BRIDGE_URL=http://127.0.0.1:8500
JANUS_BRIDGE_TOKEN=<same secret as the Janus bridge>
JANUS_PUBLIC_URL=https://janus-audio.example.org
JANUS_ICE_SERVERS=[]
```

The bridge URL must be reachable from the show server. `127.0.0.1` applies only
when it runs on the same host outside a container. For separate containers/hosts,
use a private reachable address and configure `JANUS_BRIDGE_BIND` accordingly.
Use a private control address where available, or the authenticated HTTPS
control endpoint described in the Coolify setup. Existing `AUDIO_*` variables continue configuring
Icecast independently; neither set is required when the other is configured.

Rebuild the phone and admin clients after installing this change:

```sh
pnpm --filter @entertheblackbox/phone build
pnpm --filter @entertheblackbox/admin build
```

Open `https://<show-host>/phone-janus/`, join normally and tap **Start headphones**.
Private mount credentials are obtained using the existing signed participant
lease; participants do not enter the standalone listener PIN. For show QR codes
to target this route, set `PHONE_JOIN_BASE_URL` to its HTTPS URL ending in
`/phone-janus/`. The default `/phone/` route remains available.

## Network and HTTPS

Proxy the Janus web service on port 8400 through trusted HTTPS at
`JANUS_PUBLIC_URL`, including `/janus`, with response buffering off and long
request timeouts (at least 90 seconds). The service binds HTTP to loopback by
default. Set `JANUS_WEB_BIND` appropriately if the reverse proxy is elsewhere.

Allow phones to reach host UDP ports **20000–20200**, with matching ports through
NAT. `JANUS_PUBLIC_IP` is advertised to browsers instead of the container address.
An HTTPS proxy carries signaling, not WebRTC media. Linux is the deployment target;
macOS/Windows container-VM networking needs its own reachability validation.

When phone UI and Janus use different origins, Janus HTTP's CORS support handles
signaling. An HTTPS phone page must use an HTTPS Janus URL. On localhost, HTTP is
suitable for a desktop test. Restrictive Wi-Fi/internet paths may require TURN;
no TURN server is bundled. Supply tested browser ICE configuration when needed:

```dotenv
JANUS_ICE_SERVERS=[{"urls":"turn:turn.example.org:3478","username":"trial","credential":"configured-turn-credential"}]
```

These TURN credentials are necessarily sent to authenticated phone clients.
Use suitably scoped credentials; they are separate from the private bridge and
Janus management secrets.

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

## Independent shared-feed test

The original standalone listener at `JANUS_PUBLIC_URL/` remains available. It
subscribes to shared mount 1 using `JANUS_LISTENER_PIN`; personal mounts start at
101 and have separate credentials.

```sh
docker compose --profile test-tone up --build -d
```

The pulse source tests connectivity, not latency. To feed a real file, stop the
tone and run FFmpeg on the host:

```sh
docker compose --profile test-tone stop tone
ffmpeg -re -stream_loop -1 -i /absolute/path/to/rehearsal.wav \
  -vn -ar 48000 -ac 2 -c:a libopus -b:a 64k -frame_duration 20 \
  -payload_type 111 -f rtp 'rtp://127.0.0.1:9900?pkt_size=1200'
```

The ingest port is loopback-only. Personal mixer RTP stays on the internal
Compose network and is not fed from Icecast. Keep show media outside git.

## Verification and operation

Janus v1.4.2 is pinned to commit `0a24110ae55a172c4293749b763dbb66a138f9ec`.
Only Streaming and HTTP signaling are compiled; admin HTTP is disabled. The normal
Janus API remains exposed for WebRTC signaling. This is a venue deployment, not
a hardened internet service with per-user rate limiting.

```sh
python3 -m unittest discover -s services/audio-janus/tests
node --check services/audio-janus/web/listener.js
# In services/audio-janus, with .env configured:
docker compose config --quiet
JANUS_LISTENER_PIN=your-pin python3 scripts/smoke.py http://localhost:8400
docker compose logs -f janus liquidsoap bridge
# Stop the stack and optional test tone without deleting the media volumes:
docker compose --profile test-tone down
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
