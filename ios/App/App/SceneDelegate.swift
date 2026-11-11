import UIKit
import Capacitor

/// UIScene lifecycle. Apps built with the iOS 27 SDK must adopt scenes or UIKit
/// traps at launch (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
/// The window and Main.storyboard (→ ViewController) come from the scene
/// configuration in Info.plist; URL opens are forwarded to Capacitor exactly as
/// AppDelegate did before scenes.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // Cold launch via URL / universal link
        if let context = connectionOptions.urlContexts.first {
            forward(url: context.url, options: context.options)
        }
        if let activity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity) { _ in }
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            forward(url: context.url, options: context.options)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity) { _ in }
    }

    private func forward(url: URL, options: UIScene.OpenURLOptions) {
        var appOptions: [UIApplication.OpenURLOptionsKey: Any] = [:]
        if let source = options.sourceApplication { appOptions[.sourceApplication] = source }
        if let annotation = options.annotation { appOptions[.annotation] = annotation }
        appOptions[.openInPlace] = options.openInPlace
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: appOptions)
    }
}
