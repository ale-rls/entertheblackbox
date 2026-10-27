import AVFoundation
import MediaPlayer
import QuartzCore

struct LayerSpec {
  let url: URL
  let loop: Bool
  let volume: Float
  let startAt: Double?
  let endAt: Double?
  let resyncThresholdMs: Double
}

struct LayerTiming {
  let id: String
  let state: String
  let positionMs: Double?
  let targetMs: Double?
  let driftMs: Double?
  let error: String?
}

/// App clock (e.g. corrected server time) advanced on the host clock between `set` calls,
/// so scheduling stays correct while JavaScript is suspended.
final class SharedClock {
  private let lock = NSLock()
  private var base: (clockMs: Double, hostMs: Double)?

  static func hostNowMs() -> Double { CACurrentMediaTime() * 1000 }

  func set(_ nowMs: Double) {
    lock.lock(); defer { lock.unlock() }
    base = (nowMs, SharedClock.hostNowMs())
  }

  func now() -> Double? {
    lock.lock(); defer { lock.unlock() }
    guard let base else { return nil }
    return base.clockMs + (SharedClock.hostNowMs() - base.hostMs)
  }

  func clear() {
    lock.lock(); defer { lock.unlock() }
    base = nil
  }
}

private final class LayerRuntime {
  let id: String
  var spec: LayerSpec
  let item: AVPlayerItem
  let player: AVQueuePlayer
  var looper: AVPlayerLooper?
  var statusObservation: NSKeyValueObservation?
  var state = "loading"
  var error: String?
  /// Host time of the last scheduled start, so resync doesn't fight a start still in flight.
  var lastScheduledHostMs = -Double.infinity

  init(id: String, spec: LayerSpec) {
    self.id = id
    self.spec = spec
    item = AVPlayerItem(url: spec.url)
    player = AVQueuePlayer()
    // Required for setRate(_:time:atHostTime:); files are local, so stalling isn't a concern.
    player.automaticallyWaitsToMinimizeStalling = false
    player.volume = spec.volume
    if spec.loop {
      looper = AVPlayerLooper(player: player, templateItem: item)
    } else {
      player.insert(item, after: nil)
    }
  }

  var isAnchored: Bool { spec.startAt != nil }

  var currentItem: AVPlayerItem { player.currentItem ?? item }

  func release() {
    statusObservation?.invalidate()
    statusObservation = nil
    looper?.disableLooping()
    looper = nil
    player.pause()
    player.removeAllItems()
  }
}

/// All mutation happens on the main queue. `snapshot()` may be read from any thread.
final class SchedulerEngine {
  let clock = SharedClock()
  var onPausedChange: ((Bool, String) -> Void)?
  var onLayerError: ((String, String) -> Void)?

  private static let startLeadMs = 50.0
  private static let resyncGraceMs = 1000.0

  private var layers: [String: LayerRuntime] = [:]
  private var paused = false
  private var configured = false
  private var nowPlaying: [String: Any] = [:]
  private var timer: DispatchSourceTimer?
  private var observers: [NSObjectProtocol] = []
  private var commandTargets: [(MPRemoteCommand, Any)] = []

  private let snapshotLock = NSLock()
  private var latest: (paused: Bool, layers: [LayerTiming]) = (false, [])

  func snapshot() -> (paused: Bool, layers: [LayerTiming]) {
    snapshotLock.lock(); defer { snapshotLock.unlock() }
    return latest
  }

  // MARK: Session

  func configure(title: String, artist: String?) throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playback, mode: .default, options: [])
    try session.setActive(true)
    nowPlaying = [MPMediaItemPropertyTitle: title]
    if let artist { nowPlaying[MPMediaItemPropertyArtist] = artist }
    if !configured {
      configured = true
      observeSession()
      registerRemoteCommands()
      startTimer()
    }
    publishNowPlaying()
  }

  private func observeSession() {
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
      guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
      // Calls and alarms pause the show; resuming is an explicit action.
      self?.pause(reason: "interruption")
    })
    observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
      guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
            AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
      self?.pause(reason: "route")
    })
    observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self else { return }
      try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
      try? AVAudioSession.sharedInstance().setActive(true)
      self.pause(reason: "interruption")
    })
  }

  private func registerRemoteCommands() {
    let center = MPRemoteCommandCenter.shared()
    func add(_ command: MPRemoteCommand, _ action: @escaping () -> Void) {
      command.isEnabled = true
      let target = command.addTarget { _ in
        DispatchQueue.main.async(execute: action)
        return .success
      }
      commandTargets.append((command, target))
    }
    add(center.playCommand) { [weak self] in self?.resume(reason: "remote") }
    add(center.pauseCommand) { [weak self] in self?.pause(reason: "remote") }
    add(center.togglePlayPauseCommand) { [weak self] in
      guard let self else { return }
      if self.paused { self.resume(reason: "remote") } else { self.pause(reason: "remote") }
    }
    for command in [center.nextTrackCommand, center.previousTrackCommand, center.skipForwardCommand,
                    center.skipBackwardCommand, center.changePlaybackPositionCommand, center.seekForwardCommand,
                    center.seekBackwardCommand] as [MPRemoteCommand] {
      command.isEnabled = false
    }
  }

  private func publishNowPlaying() {
    guard configured else { return }
    var info = nowPlaying
    info[MPNowPlayingInfoPropertyPlaybackRate] = paused ? 0.0 : 1.0
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  // MARK: Layers

  func setLayer(_ id: String, _ spec: LayerSpec) {
    if let existing = layers[id], existing.spec.url == spec.url, existing.spec.loop == spec.loop {
      // Same sound: retime without restarting audible playback.
      existing.spec = spec
      existing.player.volume = spec.volume
      if existing.state == "playing" && existing.isAnchored && !paused {
        applyEnd(existing)
      } else {
        schedule(existing)
      }
      refreshSnapshot()
      return
    }
    layers.removeValue(forKey: id)?.release()
    let layer = LayerRuntime(id: id, spec: spec)
    layers[id] = layer
    layer.statusObservation = layer.item.observe(\.status, options: [.initial, .new]) { [weak self, weak layer] item, _ in
      DispatchQueue.main.async {
        guard let self, let layer, self.layers[layer.id] === layer else { return }
        switch item.status {
        case .readyToPlay: self.schedule(layer)
        case .failed: self.fail(layer, item.error?.localizedDescription ?? "Could not load \(layer.spec.url.lastPathComponent)")
        default: break
        }
      }
    }
    schedule(layer)
    refreshSnapshot()
  }

  func clearLayer(_ id: String) {
    layers.removeValue(forKey: id)?.release()
    refreshSnapshot()
  }

  private func fail(_ layer: LayerRuntime, _ message: String) {
    layer.state = "error"
    layer.error = message
    layer.player.pause()
    onLayerError?(layer.id, message)
    refreshSnapshot()
  }

  private func applyEnd(_ layer: LayerRuntime) {
    guard let start = layer.spec.startAt, let end = layer.spec.endAt else {
      layer.currentItem.forwardPlaybackEndTime = .invalid
      return
    }
    layer.currentItem.forwardPlaybackEndTime = CMTime(seconds: max(0, end - start) / 1000, preferredTimescale: 1000)
  }

  /// Starts or arms a layer for the current clock. Safe to call repeatedly.
  private func schedule(_ layer: LayerRuntime) {
    guard layer.state != "error" else { return }
    if paused {
      layer.player.pause()
      layer.state = "paused"
      return
    }
    guard let start = layer.spec.startAt else {
      layer.player.play()
      layer.state = "playing"
      return
    }
    guard layer.item.status == .readyToPlay else { layer.state = "loading"; return }
    guard let now = clock.now() else { layer.state = "waiting"; return }
    if let end = layer.spec.endAt, now >= end - SchedulerEngine.startLeadMs {
      layer.player.pause()
      layer.state = "ended"
      return
    }
    let delayMs = max(start - now, SchedulerEngine.startLeadMs)
    let itemSeconds = max(0, (now + delayMs - start) / 1000)
    let duration = layer.item.duration.seconds
    if duration.isFinite && itemSeconds >= duration {
      layer.player.pause()
      layer.state = "ended"
      return
    }
    applyEnd(layer)
    let hostStart = CMTimeAdd(CMClockGetTime(CMClockGetHostTimeClock()), CMTime(seconds: delayMs / 1000, preferredTimescale: 1_000_000_000))
    layer.player.setRate(1, time: CMTime(seconds: itemSeconds, preferredTimescale: 1000), atHostTime: hostStart)
    layer.lastScheduledHostMs = SharedClock.hostNowMs() + delayMs
    layer.state = start > now ? "waiting" : "playing"
  }

  // MARK: Transport

  func pause(reason: String) {
    guard !paused else { return }
    paused = true
    for layer in layers.values where layer.state != "error" {
      layer.player.pause()
      if layer.state != "ended" { layer.state = "paused" }
    }
    publishNowPlaying()
    refreshSnapshot()
    onPausedChange?(true, reason)
  }

  func resume(reason: String) {
    guard paused else { return }
    paused = false
    try? AVAudioSession.sharedInstance().setActive(true)
    for layer in layers.values { schedule(layer) }
    publishNowPlaying()
    refreshSnapshot()
    onPausedChange?(false, reason)
  }

  func reset() {
    for layer in layers.values { layer.release() }
    layers.removeAll()
    paused = false
    clock.clear()
    timer?.cancel()
    timer = nil
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers.removeAll()
    for (command, target) in commandTargets { command.removeTarget(target) }
    commandTargets.removeAll()
    if configured {
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
      try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
    configured = false
    refreshSnapshot()
  }

  // MARK: Maintenance

  private func startTimer() {
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now(), repeating: .milliseconds(250), leeway: .milliseconds(50))
    timer.setEventHandler { [weak self] in self?.maintain() }
    timer.resume()
    self.timer = timer
  }

  /// Housekeeping only: starts and stops are already handed to AVFoundation by `schedule`.
  private func maintain() {
    let now = clock.now()
    for layer in layers.values {
      // A looper plays copies of its template item, so check the queued one for load failures.
      if layer.state != "error", let item = layer.player.currentItem, item.status == .failed {
        fail(layer, item.error?.localizedDescription ?? "Could not load \(layer.spec.url.lastPathComponent)")
        continue
      }
      guard layer.isAnchored, !paused, let start = layer.spec.startAt else { continue }
      if layer.state == "waiting" && layer.item.status == .readyToPlay {
        if layer.lastScheduledHostMs == -Double.infinity { schedule(layer) }
        else if let now, now >= start { layer.state = "playing" }
      }
      guard layer.state == "playing", let now else { continue }
      let position = layer.player.currentTime().seconds * 1000
      let ended = (layer.spec.endAt.map { now >= $0 } ?? false) ||
        (layer.item.duration.seconds.isFinite && position >= layer.item.duration.seconds * 1000 - 1)
      if ended && layer.player.rate == 0 {
        layer.state = "ended"
        continue
      }
      let drift = position - (now - start)
      if layer.player.rate > 0 && abs(drift) > layer.spec.resyncThresholdMs &&
          SharedClock.hostNowMs() - layer.lastScheduledHostMs > SchedulerEngine.resyncGraceMs {
        schedule(layer)
      }
    }
    refreshSnapshot()
  }

  private func refreshSnapshot() {
    let now = clock.now()
    let timings = layers.values.sorted { $0.id < $1.id }.map { layer -> LayerTiming in
      let seconds = layer.player.currentTime().seconds
      let position = seconds.isFinite && layer.state != "loading" ? max(0, seconds * 1000) : nil
      var target: Double?
      if let start = layer.spec.startAt, let now, now >= start, layer.spec.endAt.map({ now < $0 }) ?? true {
        target = now - start
      }
      let drift = position.flatMap { p in target.map { p - $0 } }
      return LayerTiming(id: layer.id, state: layer.state, positionMs: position, targetMs: target, driftMs: drift, error: layer.error)
    }
    snapshotLock.lock()
    latest = (paused, timings)
    snapshotLock.unlock()
  }
}
