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
/// to a single round button when minimized. Decided by size with a margin
/// (hysteresis), not by the direction of the last change: a one-frame dip in
/// width (seen when a tab page first opens) must not read as minimized.
///   minimized  once the platter is under 75% of the bar's width (expanded it
///              is ~90%, e.g. 360 of 402pt; crossing 75% is early in the
///              shrink, so JS moves with the dock);
///   expanded   once it is wider than 1.5x its height (early in the growth;
///              the minimized platter is a circle, width == height).
public class TabBarStateModule: Module {
  private var link: CADisplayLink?
  private var known = false
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
    known = false
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
    // The platter: UIKit's `_UITabBarPlatterView` when present, else the
    // bar's widest visible direct subview (on-screen geometry, so
    // mid-animation frames count).
    let visible = bar.subviews.filter { !$0.isHidden && $0.alpha > 0.01 }
    let view = visible.first { String(describing: type(of: $0)).contains("Platter") }
      ?? visible.max { $0.bounds.width < $1.bounds.width }
    guard let view else { return }
    let layer = view.layer.presentation() ?? view.layer
    let platter = layer.convert(layer.bounds, to: window.layer)
    guard platter.width > 0, platter.height > 0 else { return }

    if !known {
      minimized = platter.width < platter.height * 1.5
      known = true
    } else if !minimized, platter.width < bar.bounds.width * 0.75 {
      minimized = true
    } else if minimized, platter.width > platter.height * 1.5 {
      minimized = false
    }

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
