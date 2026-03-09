import Capacitor

/// Custom CAPBridgeViewController subclass.
/// `capacitorDidLoad()` is called after the bridge is fully initialised —
/// the correct time to register plugins and configure the server path.
class ViewController: CAPBridgeViewController {

    /// Minimum web-bundle version this native binary accepts.
    /// Bump this whenever native changes require fresh web assets (i.e. every
    /// time we do a native rebuild). If the cached WebBundle is older than this
    /// it is deleted and the app loads the assets bundled inside the .ipa instead.
    private static let minBundleVersion = "1.7.79"

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(RomaCloudSyncPlugin())

        // If a live-update web bundle was previously applied, load from it —
        // BUT only if its version is >= minBundleVersion. Stale bundles from
        // an older install are deleted so the fresh in-app assets are used.
        // This MUST run here (not in AppDelegate): bridge is nil earlier.
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let cachedBundle = support.appendingPathComponent("WebBundle")
        if FileManager.default.fileExists(atPath: cachedBundle.path) {
            if bundleVersionIsAcceptable(cachedBundle) {
                bridge?.setServerBasePath(cachedBundle.path)
            } else {
                // Stale bundle — wipe it so the in-app assets are served instead.
                // Also reset the stored version so the update checker doesn't think
                // this stale version is already applied and skip future updates.
                try? FileManager.default.removeItem(at: cachedBundle)
                UserDefaults.standard.removeObject(forKey: "roma_web_bundle_version")
            }
        }

        // Hide the native iOS keyboard accessory bar (^ v ✓).
        // Our custom MobileKeyboardToolbar replaces it entirely.
        bridge?.webView?.inputAssistantItem.leadingBarButtonGroups = []
        bridge?.webView?.inputAssistantItem.trailingBarButtonGroups = []

        // Prevent iOS from auto-adjusting the scroll view's contentInset when
        // the keyboard appears/disappears. Without this, dismissing the keyboard
        // creates a blank gap at the top of the screen.
        bridge?.webView?.scrollView.contentInsetAdjustmentBehavior = .never
    }

    /// Returns true if the cached bundle's version.json reports a version
    /// >= minBundleVersion AND the bundle contains index.html.
    private func bundleVersionIsAcceptable(_ bundleURL: URL) -> Bool {
        guard FileManager.default.fileExists(atPath: bundleURL.appendingPathComponent("index.html").path) else {
            return false
        }
        let versionFile = bundleURL.appendingPathComponent("version.json")
        guard let data = try? Data(contentsOf: versionFile),
              let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let version = manifest["version"] as? String else {
            // No version.json — treat as stale
            return false
        }
        return compareVersionStrings(version, ViewController.minBundleVersion) >= 0
    }

    private func compareVersionStrings(_ a: String, _ b: String) -> Int {
        let pa = a.split(separator: ".").compactMap { Int($0) }
        let pb = b.split(separator: ".").compactMap { Int($0) }
        let count = max(pa.count, pb.count)
        for i in 0..<count {
            let na = i < pa.count ? pa[i] : 0
            let nb = i < pb.count ? pb[i] : 0
            if na > nb { return 1 }
            if na < nb { return -1 }
        }
        return 0
    }
}
