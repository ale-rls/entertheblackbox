package org.entertheblackbox.audioscheduler

import android.os.Handler
import android.os.Looper
import androidx.core.os.bundleOf
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class LayerConfig(
  @Field val uri: String = "",
  @Field val loop: Boolean = false,
  @Field val volume: Double = 1.0,
  @Field val startAt: Double? = null,
  @Field val endAt: Double? = null,
  @Field val resyncThresholdMs: Double = 250.0
) : Record

class NowPlayingConfig(
  @Field val title: String = "",
  @Field val artist: String? = null
) : Record

class AudioSchedulerModule : Module() {
  private val engine: SchedulerEngine
    get() = SchedulerEngine.get(appContext.reactContext ?: throw Exceptions.ReactContextLost())

  override fun definition() = ModuleDefinition {
    Name("AudioScheduler")

    Events("onPausedChange", "onLayerError")

    OnCreate {
      engine.listener = object : SchedulerEngine.Listener {
        override fun onPausedChange(paused: Boolean, reason: String) {
          sendEvent("onPausedChange", bundleOf("paused" to paused, "reason" to reason))
        }

        override fun onLayerError(id: String, message: String) {
          sendEvent("onLayerError", bundleOf("id" to id, "message" to message))
        }
      }
    }

    OnDestroy {
      Handler(Looper.getMainLooper()).post {
        SchedulerEngine.peek()?.let {
          it.listener = null
          it.reset()
        }
      }
    }

    AsyncFunction("configure") { nowPlaying: NowPlayingConfig ->
      engine.configure(nowPlaying.title, nowPlaying.artist)
    }.runOnQueue(Queues.MAIN)

    // Sync and lock-protected: called often from JS, never touches players.
    Function("setClock") { nowMs: Double ->
      engine.clock.set(nowMs)
    }

    AsyncFunction("setLayer") { id: String, config: LayerConfig ->
      engine.setLayer(id, LayerSpec(config.uri, config.loop, config.volume.toFloat(),
        config.startAt, config.endAt, config.resyncThresholdMs))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("clearLayer") { id: String ->
      engine.clearLayer(id)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("pause") {
      engine.pause("api")
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("resume") {
      engine.resume("api")
    }.runOnQueue(Queues.MAIN)

    Function("isPaused") {
      engine.snapshot().paused
    }

    Function("getTiming") {
      engine.snapshot().layers.map {
        mapOf("id" to it.id, "state" to it.state, "positionMs" to it.positionMs,
          "targetMs" to it.targetMs, "driftMs" to it.driftMs, "error" to it.error)
      }
    }

    AsyncFunction("reset") {
      engine.reset()
    }.runOnQueue(Queues.MAIN)
  }
}
