import ExpoModulesCore

struct LayerConfig: Record {
  @Field var uri: String = ""
  @Field var loop: Bool = false
  @Field var volume: Double = 1
  @Field var startAt: Double? = nil
  @Field var endAt: Double? = nil
  @Field var resyncThresholdMs: Double = 250
}

struct NowPlayingConfig: Record {
  @Field var title: String = ""
  @Field var artist: String? = nil
}

struct LayerTimingRecord: Record {
  @Field var id: String = ""
  @Field var state: String = "loading"
  @Field var positionMs: Double? = nil
  @Field var targetMs: Double? = nil
  @Field var driftMs: Double? = nil
  @Field var error: String? = nil
}

public class AudioSchedulerModule: Module {
  private let engine = SchedulerEngine()

  public func definition() -> ModuleDefinition {
    Name("AudioScheduler")

    Events("onPausedChange", "onLayerError")

    OnCreate {
      self.engine.onPausedChange = { [weak self] paused, reason in
        self?.sendEvent("onPausedChange", ["paused": paused, "reason": reason])
      }
      self.engine.onLayerError = { [weak self] id, message in
        self?.sendEvent("onLayerError", ["id": id, "message": message])
      }
    }

    OnDestroy {
      let engine = self.engine
      DispatchQueue.main.async { engine.reset() }
    }

    AsyncFunction("configure") { (nowPlaying: NowPlayingConfig) in
      try self.engine.configure(title: nowPlaying.title, artist: nowPlaying.artist)
    }.runOnQueue(.main)

    // Sync and lock-protected: called often from JS, never touches players.
    Function("setClock") { (nowMs: Double) in
      self.engine.clock.set(nowMs)
    }

    AsyncFunction("setLayer") { (id: String, config: LayerConfig) in
      guard let url = URL(string: config.uri), url.scheme != nil else {
        throw Exception(name: "InvalidUri", description: "Layer \(id) needs a file URI, got \(config.uri)")
      }
      self.engine.setLayer(id, LayerSpec(url: url, loop: config.loop, volume: Float(config.volume),
        startAt: config.startAt, endAt: config.endAt, resyncThresholdMs: config.resyncThresholdMs))
    }.runOnQueue(.main)

    AsyncFunction("clearLayer") { (id: String) in
      self.engine.clearLayer(id)
    }.runOnQueue(.main)

    AsyncFunction("pause") {
      self.engine.pause(reason: "api")
    }.runOnQueue(.main)

    AsyncFunction("resume") {
      self.engine.resume(reason: "api")
    }.runOnQueue(.main)

    Function("isPaused") {
      self.engine.snapshot().paused
    }

    Function("getTiming") { () -> [LayerTimingRecord] in
      self.engine.snapshot().layers.map { timing in
        var record = LayerTimingRecord()
        record.id = timing.id
        record.state = timing.state
        record.positionMs = timing.positionMs
        record.targetMs = timing.targetMs
        record.driftMs = timing.driftMs
        record.error = timing.error
        return record
      }
    }

    AsyncFunction("reset") {
      self.engine.reset()
    }.runOnQueue(.main)
  }
}
