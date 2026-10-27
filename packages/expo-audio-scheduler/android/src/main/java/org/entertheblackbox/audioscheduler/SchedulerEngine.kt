package org.entertheblackbox.audioscheduler

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes as PlatformAudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import kotlin.math.abs
import kotlin.math.max

data class LayerSpec(
  val uri: String,
  val loop: Boolean,
  val volume: Float,
  val startAt: Double?,
  val endAt: Double?,
  val resyncThresholdMs: Double
)

data class LayerTiming(
  val id: String,
  val state: String,
  val positionMs: Double?,
  val targetMs: Double?,
  val driftMs: Double?,
  val error: String?
)

data class Snapshot(val paused: Boolean, val layers: List<LayerTiming>)

/**
 * App clock (e.g. corrected server time) advanced on elapsedRealtime between `set` calls,
 * so scheduling stays correct while JavaScript timers are frozen.
 */
class SharedClock {
  private var base: Pair<Double, Double>? = null

  private fun realtimeMs() = SystemClock.elapsedRealtimeNanos() / 1_000_000.0

  @Synchronized
  fun set(nowMs: Double) {
    base = nowMs to realtimeMs()
  }

  @Synchronized
  fun now(): Double? = base?.let { (clockMs, realtimeAt) -> clockMs + (realtimeMs() - realtimeAt) }

  @Synchronized
  fun clear() {
    base = null
  }
}

private class LayerRuntime(val id: String, var spec: LayerSpec, val player: ExoPlayer) {
  var state = "loading"
  var error: String? = null
  var prepared = false
  var startRunnable: Runnable? = null
  var endRunnable: Runnable? = null
  /** elapsedRealtime of the last start or seek, so resync doesn't fight a start still in flight. */
  var lastScheduledMs = Long.MIN_VALUE / 2
  val isAnchored get() = spec.startAt != null
}

/**
 * Owns every layer player plus the shared audio focus, noisy-route handling and wake lock.
 * Individual players never request focus themselves, so layers can't interrupt each other.
 * All methods except `snapshot()` and `clock` run on the main looper; native Handler
 * callbacks keep firing while the screen is locked, unlike React Native JS timers.
 */
class SchedulerEngine private constructor(private val context: Context) {
  interface Listener {
    fun onPausedChange(paused: Boolean, reason: String)
    fun onLayerError(id: String, message: String)
  }

  companion object {
    private const val MAINTAIN_INTERVAL_MS = 250L
    private const val RESYNC_GRACE_MS = 1000L

    @Volatile
    private var instance: SchedulerEngine? = null

    fun get(context: Context): SchedulerEngine =
      instance ?: synchronized(this) { instance ?: SchedulerEngine(context.applicationContext).also { instance = it } }

    fun peek(): SchedulerEngine? = instance
  }

  val clock = SharedClock()
  var listener: Listener? = null
  var sessionRefresh: (() -> Unit)? = null

  var title = ""
    private set
  var artist: String? = null
    private set
  var paused = false
    private set
  val hasLayers get() = layers.isNotEmpty()

  private val handler = Handler(Looper.getMainLooper())
  private val layers = LinkedHashMap<String, LayerRuntime>()
  private var configured = false
  private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var focusRequest: AudioFocusRequest? = null
  private val wakeLock: PowerManager.WakeLock =
    (context.getSystemService(Context.POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AudioScheduler::playback")
      .apply { setReferenceCounted(false) }

  @Volatile
  private var latest = Snapshot(false, emptyList())

  fun snapshot(): Snapshot = latest

  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    handler.post {
      // Calls and other apps pause the show; resuming is an explicit action.
      if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
        pause("interruption")
      }
    }
  }

  private val noisyReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) handler.post { pause("route") }
    }
  }

  private val maintainRunnable = object : Runnable {
    override fun run() {
      maintain()
      handler.postDelayed(this, MAINTAIN_INTERVAL_MS)
    }
  }

  // Session

  fun configure(title: String, artist: String?) {
    this.title = title
    this.artist = artist
    if (!configured) {
      configured = true
      requestFocus()
      ContextCompat.registerReceiver(context, noisyReceiver,
        IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED)
      context.startService(Intent(context, SchedulerService::class.java))
      handler.post(maintainRunnable)
    }
    updateWakeLock()
    notifySession()
  }

  private fun requestFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(PlatformAudioAttributes.Builder()
          .setUsage(PlatformAudioAttributes.USAGE_MEDIA)
          .setContentType(PlatformAudioAttributes.CONTENT_TYPE_MUSIC)
          .build())
        .setOnAudioFocusChangeListener(focusListener, handler)
        .build()
        .also { focusRequest = it }
      audioManager.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
    }
  }

  private fun abandonFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(focusListener)
    }
  }

  private fun updateWakeLock() {
    // Holds the CPU awake so scheduled starts fire on time even between audible layers.
    if (configured && !paused && layers.isNotEmpty()) {
      if (!wakeLock.isHeld) wakeLock.acquire()
    } else if (wakeLock.isHeld) {
      wakeLock.release()
    }
  }

  private fun notifySession() {
    sessionRefresh?.let { handler.post(it) }
  }

  // Layers

  fun setLayer(id: String, spec: LayerSpec) {
    val existing = layers[id]
    if (existing != null && existing.spec.uri == spec.uri && existing.spec.loop == spec.loop) {
      // Same sound: retime without restarting audible playback.
      existing.spec = spec
      existing.player.volume = spec.volume
      if (existing.state == "playing" && existing.isAnchored && !paused) applyEnd(existing) else schedule(existing)
      refreshSnapshot()
      return
    }
    layers.remove(id)?.let { release(it) }
    val player = ExoPlayer.Builder(context)
      .setAudioAttributes(AudioAttributes.Builder()
        .setUsage(C.USAGE_MEDIA)
        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
        .build(), false)
      .setHandleAudioBecomingNoisy(false)
      .setWakeMode(C.WAKE_MODE_LOCAL)
      .build()
    val layer = LayerRuntime(id, spec, player)
    layers[id] = layer
    player.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(playbackState: Int) {
        if (layers[id] !== layer) return
        if (playbackState == Player.STATE_READY && !layer.prepared) {
          layer.prepared = true
          if (layer.state == "loading") schedule(layer)
        }
        if (playbackState == Player.STATE_ENDED && layer.state == "playing") layer.state = "ended"
        refreshSnapshot()
      }

      override fun onPlayerError(error: PlaybackException) {
        if (layers[id] === layer) fail(layer, error.message ?: "Could not play ${spec.uri}")
      }
    })
    player.setMediaItem(MediaItem.fromUri(spec.uri))
    player.repeatMode = if (spec.loop) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
    player.volume = spec.volume
    player.playWhenReady = false
    player.prepare()
    schedule(layer)
    updateWakeLock()
    notifySession()
    refreshSnapshot()
  }

  fun clearLayer(id: String) {
    layers.remove(id)?.let { release(it) }
    updateWakeLock()
    notifySession()
    refreshSnapshot()
  }

  private fun release(layer: LayerRuntime) {
    cancelTimers(layer)
    layer.player.release()
  }

  private fun fail(layer: LayerRuntime, message: String) {
    cancelTimers(layer)
    layer.state = "error"
    layer.error = message
    layer.player.pause()
    listener?.onLayerError(layer.id, message)
    refreshSnapshot()
  }

  private fun cancelTimers(layer: LayerRuntime) {
    layer.startRunnable?.let { handler.removeCallbacks(it) }
    layer.endRunnable?.let { handler.removeCallbacks(it) }
    layer.startRunnable = null
    layer.endRunnable = null
  }

  private fun applyEnd(layer: LayerRuntime) {
    layer.endRunnable?.let { handler.removeCallbacks(it) }
    layer.endRunnable = null
    val end = layer.spec.endAt ?: return
    val now = clock.now() ?: return
    val runnable = Runnable {
      if (layers[layer.id] !== layer) return@Runnable
      layer.player.pause()
      layer.state = "ended"
      refreshSnapshot()
    }
    layer.endRunnable = runnable
    handler.postDelayed(runnable, max(0.0, end - now).toLong())
  }

  /** Starts or arms a layer for the current clock. Safe to call repeatedly. */
  private fun schedule(layer: LayerRuntime) {
    if (layer.state == "error") return
    cancelTimers(layer)
    val player = layer.player
    if (paused) {
      player.pause()
      layer.state = "paused"
      return
    }
    val start = layer.spec.startAt
    if (start == null) {
      player.play()
      layer.state = "playing"
      return
    }
    if (!layer.prepared) {
      layer.state = "loading"
      return
    }
    val now = clock.now()
    if (now == null) {
      layer.state = "waiting"
      return
    }
    val end = layer.spec.endAt
    if (end != null && now >= end) {
      player.pause()
      layer.state = "ended"
      return
    }
    if (now < start) {
      player.pause()
      if (player.currentPosition != 0L) player.seekTo(0)
      layer.state = "waiting"
      val runnable = Runnable {
        if (layers[layer.id] !== layer || paused) return@Runnable
        layer.startRunnable = null
        startAt(layer, start)
      }
      layer.startRunnable = runnable
      handler.postDelayed(runnable, (start - now).toLong())
    } else {
      val position = (now - start).toLong()
      if (player.duration != C.TIME_UNSET && position >= player.duration) {
        player.pause()
        layer.state = "ended"
        return
      }
      startAt(layer, start)
    }
    applyEnd(layer)
  }

  private fun startAt(layer: LayerRuntime, start: Double) {
    val now = clock.now() ?: return
    val target = max(0.0, now - start).toLong()
    if (abs(layer.player.currentPosition - target) > layer.spec.resyncThresholdMs / 2) layer.player.seekTo(target)
    layer.player.play()
    layer.state = "playing"
    layer.lastScheduledMs = SystemClock.elapsedRealtime()
    refreshSnapshot()
  }

  // Transport

  fun pause(reason: String) {
    if (paused) return
    paused = true
    for (layer in layers.values) {
      if (layer.state == "error") continue
      cancelTimers(layer)
      layer.player.pause()
      if (layer.state != "ended") layer.state = "paused"
    }
    updateWakeLock()
    notifySession()
    refreshSnapshot()
    listener?.onPausedChange(true, reason)
  }

  fun resume(reason: String) {
    if (!paused) return
    paused = false
    requestFocus()
    for (layer in layers.values) {
      if (layer.state == "ended") layer.state = "paused"
      schedule(layer)
    }
    updateWakeLock()
    notifySession()
    refreshSnapshot()
    listener?.onPausedChange(false, reason)
  }

  fun reset() {
    for (layer in layers.values) release(layer)
    layers.clear()
    paused = false
    clock.clear()
    if (configured) {
      configured = false
      handler.removeCallbacks(maintainRunnable)
      abandonFocus()
      try {
        context.unregisterReceiver(noisyReceiver)
      } catch (_: IllegalArgumentException) {
        // Not registered.
      }
      context.stopService(Intent(context, SchedulerService::class.java))
    }
    updateWakeLock()
    notifySession()
    refreshSnapshot()
  }

  // Maintenance

  /** Housekeeping only: starts and stops are already posted by `schedule`. */
  private fun maintain() {
    val now = clock.now()
    for (layer in layers.values) {
      val start = layer.spec.startAt ?: continue
      if (paused || now == null) continue
      // Armed before the clock was first set.
      if (layer.state == "waiting" && layer.prepared && layer.startRunnable == null) schedule(layer)
      if (layer.state != "playing" || !layer.player.isPlaying) continue
      val drift = layer.player.currentPosition - (now - start)
      if (abs(drift) > layer.spec.resyncThresholdMs &&
        SystemClock.elapsedRealtime() - layer.lastScheduledMs > RESYNC_GRACE_MS) {
        layer.player.seekTo(max(0.0, now - start).toLong())
        layer.lastScheduledMs = SystemClock.elapsedRealtime()
      }
    }
    refreshSnapshot()
  }

  private fun refreshSnapshot() {
    val now = clock.now()
    latest = Snapshot(paused, layers.values.sortedBy { it.id }.map { layer ->
      val position = if (layer.prepared) layer.player.currentPosition.toDouble() else null
      val start = layer.spec.startAt
      val end = layer.spec.endAt
      val target = if (start != null && now != null && now >= start && (end == null || now < end)) now - start else null
      val drift = if (position != null && target != null) position - target else null
      LayerTiming(layer.id, layer.state, position, target, drift, layer.error)
    })
  }
}
