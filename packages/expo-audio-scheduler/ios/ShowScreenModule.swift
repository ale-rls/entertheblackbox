import ExpoModulesCore
import UIKit

public class ShowScreenModule: Module {
  private var previousIdleDisabled: Bool?

  public func definition() -> ModuleDefinition {
    Name("ShowScreen")
    AsyncFunction("setActive") { (active: Bool) in
      if active {
        if self.previousIdleDisabled == nil {
          self.previousIdleDisabled = UIApplication.shared.isIdleTimerDisabled
        }
        UIApplication.shared.isIdleTimerDisabled = true
      } else if let previous = self.previousIdleDisabled {
        UIApplication.shared.isIdleTimerDisabled = previous
        self.previousIdleDisabled = nil
      }
    }.runOnQueue(.main)
    OnDestroy {
      let previous = self.previousIdleDisabled
      DispatchQueue.main.async {
        if let previous { UIApplication.shared.isIdleTimerDisabled = previous }
      }
    }
  }
}
