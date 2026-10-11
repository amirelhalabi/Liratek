import ExpoModulesCore
import UIKit

/// CADisplayLink needs an NSObject target; the module itself is not one.
private final class Ticker: NSObject {
  let fn: () -> Void
  init(_ fn: @escaping () -> Void) { self.fn = fn }
  @objc func tick() { fn() }
}

/// Reports whether the system tab bar is minimized (iOS 26
/// `tabBarMinimizeBehavior`), which UIKit does not expose. Each frame while JS
/// listens, it reads the tab bar's glass platter: it shrinks from the full bar
/// to a single round button when minimized. A shrinking platter reports
/// minimized at once, a growing one expanded, so JS moves with the dock rather
/// than after it.
public class TabBarStateModule: Module {
  private var link: CADisplayLink?
  private var lastWidth: CGFloat = 0
  private var minimized = false
  private var settledCenter: Double = 0
  private var sentMinimized: Bool?
  private var sentCenter: Double = 0

  public func definition() -> ModuleDefinition {
    Name("TabBarState")
    Events("onChange")
    OnStartObserving { DispatchQueue.main.async { self.start() } }
    OnStopObserving { DispatchQueue.main.async { self.stop() } }
  }

  private func start() {
    guard link == nil else { return }
    sentMinimized = nil
    let l = CADisplayLink(target: Ticker { [weak self] in self?.tick() }, selector: #selector(Ticker.tick))
    l.add(to: .main, forMode: .common)
    link = l
  }

  private func stop() {
    link?.invalidate()
    link = nil
  }

  private func findTabBarController(_ vc: UIViewController?) -> UITabBarController? {
    guard let vc else { return nil }
    if let t = vc as? UITabBarController { return t }
    for c in vc.children { if let t = findTabBarController(c) { return t } }
    return findTabBarController(vc.presentedViewController)
  }

  private func tick() {
    let window = UIApplication.shared.connectedScenes
      .compactMap { ($0 as? UIWindowScene)?.windows.first { $0.isKeyWindow } }.first
    guard let window, let bar = findTabBarController(window.rootViewController)?.tabBar, !bar.isHidden else { return }
    // The platter: the bar's widest visible direct subview (on-screen geometry,
    // so mid-animation frames count).
    let platter = bar.subviews
      .filter { !$0.isHidden && $0.alpha > 0.01 }
      .map { v -> CGRect in
        let p = v.layer.presentation() ?? v.layer
        return p.convert(p.bounds, to: window.layer)
      }
      .max { $0.width < $1.width }
    guard let platter, platter.width > 0 else { return }

    if lastWidth == 0 {
      minimized = platter.width < bar.bounds.width / 2
    } else if platter.width < lastWidth - 0.5 {
      minimized = true
    } else if platter.width > lastWidth + 0.5 {
      minimized = false
    }
    lastWidth = platter.width

    // Once the minimized platter settles into its round button, note how far
    // its centre sits above the screen's bottom edge (differs per device).
    if minimized, abs(platter.width - platter.height) < 1 {
      settledCenter = Double(window.bounds.height - platter.midY).rounded()
    }
    if minimized != sentMinimized || settledCenter != sentCenter {
      sentMinimized = minimized
      sentCenter = settledCenter
      sendEvent("onChange", ["minimized": minimized, "centerFromBottom": settledCenter])
    }
  }
}
