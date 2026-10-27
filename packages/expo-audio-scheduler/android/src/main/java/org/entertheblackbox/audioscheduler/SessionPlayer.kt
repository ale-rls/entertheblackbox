package org.entertheblackbox.audioscheduler

import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * What the lock screen and notification see: one item that is playing while the
 * scheduler is running. Play/pause from the system maps to scheduler resume/pause.
 */
@OptIn(UnstableApi::class)
class SessionPlayer(private val engine: SchedulerEngine) : SimpleBasePlayer(Looper.getMainLooper()) {
  override fun getState(): State {
    val item = MediaItemData.Builder("show")
      .setMediaItem(MediaItem.Builder().setMediaId("show").build())
      .setMediaMetadata(MediaMetadata.Builder().setTitle(engine.title).setArtist(engine.artist).build())
      .build()
    return State.Builder()
      .setAvailableCommands(Player.Commands.Builder().addAll(
        Player.COMMAND_PLAY_PAUSE, Player.COMMAND_GET_CURRENT_MEDIA_ITEM, Player.COMMAND_GET_METADATA).build())
      .setPlayWhenReady(!engine.paused, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
      .setPlaybackState(if (engine.hasLayers) Player.STATE_READY else Player.STATE_IDLE)
      .setPlaylist(listOf(item))
      .build()
  }

  override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
    if (playWhenReady) engine.resume("remote") else engine.pause("remote")
    return Futures.immediateVoidFuture()
  }

  fun refresh() = invalidateState()
}
