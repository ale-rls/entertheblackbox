# Independent mixer; same cue/bed/music semantics as services/audio.
# PCM goes directly to Opus/RTP; no Icecast or HTTP ingestion.
settings.init.allow_root := true
settings.log.stdout := true
settings.server.telnet := true
settings.server.telnet.bind_addr := "0.0.0.0"
settings.server.telnet.port := 1234

beds_root = environment.get("BEDS_DIR", default="/beds")

# Slots match the independent bridge's PLAYERS setting.
count = int_of_string(environment.get("PLAYERS", default="30"))
player_ids = list.init(count, fun (i) -> "#{i + 1}")

# One shared loop is mixed into every stream, including newly joined phones.
music_volume = ref(0.)
music_uri = ref("")
music = playlist.list(id="background_music", mode="normal", [])
def music_play(uri) =
  if uri != music_uri() then
    music.reload(empty_queue=true, [uri])
    music.skip()
    music_uri := uri
  end
  "OK"
end
def music_stop(_) =
  music_volume := 0.
  music_uri := ""
  music.reload(empty_queue=true, [])
  music.skip()
  "OK"
end
def music_gain(value) =
  music_volume := float_of_string(value)
  "OK"
end
server.register(namespace="music", "play", music_play)
server.register(namespace="music", "stop", music_stop)
server.register(namespace="music", "volume", music_gain)
music = mksafe(music)

def mkplayer(pid) =
  interrupt_q = request.queue(id="int_#{pid}")
  narration_q = request.queue(id="nar_#{pid}")

  # Clear pending and currently playing narration without stopping the bed.
  def reset_narration(_) =
    interrupt_q.set_queue([])
    narration_q.set_queue([])
    interrupt_q.skip()
    narration_q.skip()
    "OK"
  end
  server.register(namespace="player_#{pid}", description="Clear narration", "reset", reset_narration)

  # Per-player bed. The bridge retargets it with:
  #   bed_{id}.uri <dir>  then  bed_{id}.reload
  bed = playlist(
    id="bed_#{pid}",
    mode="normal",
    reload_mode="watch",
    "#{beds_root}/default"
  )

  # A reused slot must not inherit its previous participant's ambient bed.
  def set_bed(uri) =
    bed.reload(empty_queue=true, uri=uri)
    bed.skip()
    "OK"
  end
  server.register(namespace="player_#{pid}", "bed", set_bed)
  server.register(namespace="player_#{pid}", "reset_bed", fun (_) -> set_bed("#{beds_root}/default"))

  # track_sensitive=false: a push to a higher-priority queue takes over
  # immediately (mid-track), which is exactly the interrupt semantic; the
  # bed is filler, so cutting it is always fine.
  s = fallback(
    id="mix_#{pid}",
    track_sensitive=false,
    [interrupt_q, narration_q, bed]
  )

  # If the bed dir is missing/empty, mksafe pads with silence rather than
  # letting the mount die. The default bed is intentionally silent.
  s = mksafe(s)
  # Normalize weights to retain headroom when music and narration overlap.
  s = add(weights=[{ 1. }, { music_volume() }], [s, music])

  port = 6000 + 2 * int_of_string(pid)
  output.external(
    %wav(samplerate=48000, channels=2, samplesize=16, header=false),
    id="out_#{pid}", flush=true,
    "ffmpeg -nostdin -hide_banner -loglevel error -f s16le -ar 48000 -ac 2 -i pipe:0 -c:a libopus -b:a 64k -frame_duration 20 -payload_type 111 -f rtp 'rtp://janus:#{port}?pkt_size=1200'",
    s
  )
end

list.iter(mkplayer, player_ids)

log("blackbox-janus: #{list.length(player_ids)} player streams up")
