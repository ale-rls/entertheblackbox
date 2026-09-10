# blackbox-icecast — one personal stream per player (SPEC §4.1).
#
# Per player id:
#   int_{id}   request.queue  — interrupt: cuts whatever is playing
#   nar_{id}   request.queue  — narration: plays after the current item
#   bed_{id}   playlist       — looping ambient bed (keeps the stream
#                               audibly alive between narration items)
#   out_{id}   output.icecast — mount /p/{id}.mp3
#
# The fallback chain means a mount NEVER dries up: Icecast never drops
# listeners for a dead source, and the phone's <audio> element never goes
# idle — which is what keeps locked phones receiving (SPEC §2).
#
# Controlled by the bridge over telnet (port 1234, container-internal).

settings.init.allow_root := true
settings.log.stdout := true
settings.server.telnet := true
settings.server.telnet.bind_addr := "0.0.0.0"
settings.server.telnet.port := 1234

icecast_host = environment.get("ICECAST_HOST", default="icecast")
icecast_port = int_of_string(environment.get("ICECAST_PORT", default="8000"))
icecast_pass = environment.get("ICECAST_SOURCE_PASSWORD", default="hackme")
beds_root = environment.get("BEDS_DIR", default="/beds")

# Player provisioning: PLAYER_IDS="alpha,beta,7" wins if set; otherwise
# PLAYERS=<count> provisions ids "1".."<count>". Mirrored in bridge/config.py.
ids_env = environment.get("PLAYER_IDS", default="")
count_env = environment.get("PLAYERS", default="100")
player_ids =
  if ids_env == "" then
    list.init(int_of_string(count_env), fun (i) -> "#{i + 1}")
  else
    list.map(string.trim, string.split(separator=",", ids_env))
  end

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

  # track_sensitive=false: a push to a higher-priority queue takes over
  # immediately (mid-track), which is exactly the interrupt semantic; the
  # bed is filler, so cutting it is always fine.
  s = fallback(
    id="mix_#{pid}",
    track_sensitive=false,
    [interrupt_q, narration_q, bed]
  )

  # If the bed dir is missing/empty, mksafe pads with silence rather than
  # letting the mount die. Silence is a failure state, not a feature —
  # beds must exist (SPEC §6).
  s = mksafe(s)

  output.icecast(
    %mp3(bitrate=128, samplerate=44100, stereo=false),
    id="out_#{pid}",
    host=icecast_host,
    port=icecast_port,
    password=icecast_pass,
    mount="/p/#{pid}.mp3",
    name="blackbox player #{pid}",
    description="personal narrative stream",
    public=false,
    s
  )
end

list.iter(mkplayer, player_ids)

log("blackbox-icecast: #{list.length(player_ids)} player streams up")
