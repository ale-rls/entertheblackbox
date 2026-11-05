package org.entertheblackbox.audioscheduler

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ShowScreenModule : Module() {
  private var activeActivity: Activity? = null
  private var keptAwake = false
  private var pinRequested = false

  private fun restore() {
    activeActivity?.let { activity ->
      if (!keptAwake) activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      if (pinRequested) activity.stopLockTask()
    }
    activeActivity = null
    pinRequested = false
  }

  override fun definition() = ModuleDefinition {
    Name("ShowScreen")
    AsyncFunction("setActive") { active: Boolean ->
      if (active && activeActivity == null) {
        val activity = appContext.currentActivity ?: error("Open the app to enter show mode")
        keptAwake = activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON != 0
        activeActivity = activity
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      } else if (!active) {
        restore()
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("pin") {
      val activity = activeActivity ?: error("Enter show mode first")
      activity.startLockTask()
      pinRequested = true
    }.runOnQueue(Queues.MAIN)
    OnDestroy {
      Handler(Looper.getMainLooper()).post { restore() }
    }
  }
}
