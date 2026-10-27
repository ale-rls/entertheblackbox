package org.entertheblackbox.audioscheduler

import android.app.PendingIntent
import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

@OptIn(UnstableApi::class)
class SchedulerService : MediaSessionService() {
  private var session: MediaSession? = null
  private var player: SessionPlayer? = null

  override fun onCreate() {
    super.onCreate()
    val engine = SchedulerEngine.get(this)
    val sessionPlayer = SessionPlayer(engine)
    player = sessionPlayer
    engine.sessionRefresh = { sessionPlayer.refresh() }
    val builder = MediaSession.Builder(this, sessionPlayer)
    packageManager.getLaunchIntentForPackage(packageName)?.let {
      builder.setSessionActivity(PendingIntent.getActivity(this, 0, it,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    session = builder.build().also { addSession(it) }
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiping the app away ends the show audio.
    SchedulerEngine.peek()?.reset()
    stopSelf()
  }

  override fun onDestroy() {
    SchedulerEngine.peek()?.sessionRefresh = null
    session?.release()
    player?.release()
    session = null
    player = null
    super.onDestroy()
  }
}
