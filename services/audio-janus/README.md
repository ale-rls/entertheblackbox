# Isolated Janus audio trial

An opt-in shared audio backend for comparing WebRTC delivery with the existing
Icecast/Liquidsoap setup. Nothing in `services/audio`, the show apps, or the
production Compose stacks depends on this directory. Start and stop this stack
separately. Its Compose project is `blackbox-janus` and its ports/volumes are
independent; it does not ingest an existing Icecast stream.

```
external source → Opus/RTP → Janus Streaming → WebRTC → test listener
                                      ↑
                          optional generated pulse source
```

This first version serves **one shared feed**, not participant-specific narration.
There is no Admin selector, participant registration, show cue integration or
automatic fallback to Icecast. The listener is a rehearsal tool, not a replacement
for `/phone/`. A later personal-mix backend needs its own source/mount allocation
and the existing bridge's control semantics, plus application integration.

## Run on a Linux venue host with Docker Compose

```sh
cd services/audio-janus
cp .env.example .env
# Edit JANUS_PUBLIC_IP and JANUS_LISTENER_PIN before starting.
docker compose --profile test-tone up --build -d
curl http://localhost:8400/janus/info
```

The build pins Janus v1.4.2 to upstream commit
`0a24110ae55a172c4293749b763dbb66a138f9ec`. OS packages are installed from Debian
Bookworm repositories. Image builds need internet access; the listener has no CDN
or runtime internet dependency on a venue LAN.

`JANUS_PUBLIC_IP` must be the host IPv4 address that phones can reach. It is
advertised in ICE candidates instead of the private container address. Open UDP
20000–20200 to phones and preserve those port numbers through NAT. Do not run two
copies on the same host with this fixed media port range. Container VM networking
on macOS/Windows requires separate reachability verification; Linux is the target.

Open `http://localhost:8400/` on the host, enter the PIN and Connect. For phones,
put the web service behind a **trusted HTTPS** reverse proxy, forwarding the whole
path including `/janus`, disabling response buffering and allowing long requests
(at least 90 seconds). The default HTTP binding is loopback. If the reverse proxy
runs elsewhere, set `JANUS_WEB_BIND` to an appropriate host address and restrict
access to that proxy. Signaling passing through HTTPS does not tunnel WebRTC media;
the separate UDP range must be reachable too.

A test pulse should sound once per second. Start with low headphone volume.
The pulse verifies delivery; it does **not** measure cue-to-ear latency by itself.

```sh
docker compose logs -f janus web tone
docker compose --profile test-tone down
```

## Feed real audio

Stop the generated source first: only one RTP producer should feed mount 1.
Run FFmpeg on the same Linux host as Docker, using your own local audio file:

```sh
docker compose --profile test-tone stop tone
ffmpeg -re -stream_loop -1 -i /absolute/path/to/rehearsal.wav \
  -vn -ar 48000 -ac 2 -c:a libopus -b:a 64k -frame_duration 20 \
  -payload_type 111 -f rtp 'rtp://127.0.0.1:9900?pkt_size=1200'
```

Use the configured `JANUS_INPUT_PORT` if changed from 9900. RTP ingest is bound
only to host loopback. For live input, use the source device's FFmpeg/GStreamer
capture input and keep Opus/48 kHz/payload type 111. No PipeWire or VLC dependency
is required for this stack. Media stays outside git.

The future Liquidsoap adapter must output a fresh mix directly as Opus/RTP,
before HTTP buffering. This trial deliberately does not change the running
Liquidsoap instance or claim an adapter already exists.

## Access and network scope

The listener PIN is shared rehearsal access, not individual authorization. Janus's
Streaming management key is random per boot and is not delivered to browsers.
Only the Streaming plugin and HTTP transport are intended to run; the Janus admin
HTTP API is disabled. The web proxy exposes the normal Janus signaling API, so
this is a controlled venue trial, not a hardened public audience gateway.

No TURN service is included. The supplied listener uses direct ICE connectivity
with no STUN/TURN servers. For remote listeners, restrictive Wi-Fi or internet
hosting, add and validate a TURN deployment plus browser ICE configuration before
calling that topology supported. An HTTPS proxy alone is insufficient.

## Acceptance before show integration

Compare with Icecast under the same source, devices, network and audience load:

1. Record a source-time marker and actual wired headphone output on a common
   recording clock. Measure median, p95 and maximum end-to-end delay, separately
   from connection startup. A proposed realtime target is p95 below 300 ms;
   it is not a measured result or guarantee. Test Bluetooth separately.
2. Play for at least 45 minutes on representative iOS/Android phones, locked and
   app-switched, including long quiet periods followed by speech. Record missed
   words, interruptions, extra gestures and phone/browser versions.
3. Test brief Wi-Fi loss, longer outages, audio-focus interruptions, explicit
   pause/resume and Janus/source restarts. This listener reports connection failure
   and allows manual reconnect; it does not promise recovery while JavaScript is
   suspended. Janus session keepalives also need background-device verification.
4. Repeat at expected audience size. A shared-feed load test does not validate
   the CPU cost or correctness of 100 distinct personal mixes.
5. Keep Icecast running independently throughout rehearsal. Disconnect one
   listener before switching to the other page to avoid hearing both feeds.

WebRTC prioritizes timely delivery and can lose/conceal audio during network
trouble. Lower latency does not guarantee complete speech or synchronized output
across phones. Neither connection status nor RTP frame duration proves audible
latency. Use the existing synchronized-file mode for its separate foreground
picture-sync use case.

## Checks

```sh
python3 -m unittest discover -s services/audio-janus/tests
node --check services/audio-janus/web/listener.js
# From this service directory, after configuring .env:
docker compose --profile test-tone config --quiet
```

After startup, exercise signaling and access checks with:

```sh
JANUS_LISTENER_PIN=your-pin python3 scripts/smoke.py http://localhost:8400
```

This checks an Opus offer, rejects a wrong PIN and rejects mount creation without
the management key; it does not listen to or measure audio.

Container build/start, browser negotiation and physical-phone acceptance must be
reported separately from these static/unit checks.

References: [Janus Streaming](https://janus.conf.meetecho.com/docs/streaming),
[Janus signaling](https://janus.conf.meetecho.com/docs/rest),
[Playback reference implementation](https://github.com/Public-Shorts/playback).
