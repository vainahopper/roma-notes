import Foundation
import Capacitor

/// Native Capacitor plugin for iCloud Documents sync + live web asset updates.
/// Pages are stored as JSON files in the iCloud ubiquity container.
/// Web asset bundles are delivered via iCloud as raw files (no zipping needed).
@objc(RomaCloudSyncPlugin)
public class RomaCloudSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RomaCloudSyncPlugin"
    public let jsName = "RomaCloudSync"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "diagnose", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushPage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pullAllPages", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deletePage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkWebUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "applyWebUpdate", returnType: CAPPluginReturnPromise),
    ]

    private let containerID = "iCloud.com.codevainas.romanotes"
    private let pagesFolder = "pages"
    private let bundleFolder = "web-bundle"
    private let versionKey = "roma_web_bundle_version"

    // Cached container URL — resolved once, reused forever.
    private var _cachedContainerURL: URL? = nil
    private var _containerResolved = false
    // Serial queue for thread-safe container resolution
    private let containerQueue = DispatchQueue(label: "com.codevainas.romanotes.container")

    // Concurrency guards: prevent multiple simultaneous check/apply calls
    // from racing on iCloud file operations.
    private let updateLock = NSLock()
    private var _checkInProgress = false
    private var _applyInProgress = false

    // ─── iCloud container helpers ────────────────────────────────────────────

    /// Get the iCloud container URL. Thread-safe, cached after first resolution.
    /// Returns nil if iCloud is not available or times out.
    private func getContainerURL(timeout: TimeInterval = 15) -> URL? {
        // Fast path: already resolved
        if _containerResolved { return _cachedContainerURL }

        NSLog("[RomaSync] getContainerURL: resolving…")
        var result: URL? = nil
        let sem = DispatchSemaphore(value: 0)
        DispatchQueue.global(qos: .userInitiated).async {
            result = FileManager.default.url(forUbiquityContainerIdentifier: self.containerID)
            sem.signal()
        }
        let waited = sem.wait(timeout: .now() + timeout)
        if waited == .timedOut {
            NSLog("[RomaSync] getContainerURL: TIMED OUT after %.0fs — will retry next call", timeout)
            return nil
        }
        NSLog("[RomaSync] getContainerURL: resolved = \(String(describing: result))")
        // Only cache a successful result. If iCloud isn't ready yet (result == nil),
        // leave _containerResolved = false so the next call retries instead of
        // immediately returning nil forever.
        if result != nil {
            _cachedContainerURL = result
            _containerResolved = true
        }
        return result
    }

    private func getDocsURL() -> URL? {
        guard let containerURL = getContainerURL() else { return nil }
        let docs = containerURL.appendingPathComponent("Documents")
        if !FileManager.default.fileExists(atPath: docs.path) {
            try? FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
        }
        return docs
    }

    private func getPagesURL() -> URL? {
        guard let docs = getDocsURL() else { return nil }
        let pagesURL = docs.appendingPathComponent(pagesFolder)
        if !FileManager.default.fileExists(atPath: pagesURL.path) {
            try? FileManager.default.createDirectory(at: pagesURL, withIntermediateDirectories: true)
        }
        return pagesURL
    }

    private func getBundleURL() -> URL? {
        guard let docs = getDocsURL() else { return nil }
        return docs.appendingPathComponent(bundleFolder)
    }

    /// Returns the bundle URL to use for update operations.
    /// In DEBUG builds, falls back to a local TestWebBundle when iCloud is unavailable.
    /// Place `dist/` at `AppSupport/TestWebBundle` to test the update flow in the simulator.
    private func getEffectiveBundleURL() -> URL? {
        if let url = getBundleURL() { return url }
        #if DEBUG
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let testBundle = support.appendingPathComponent("TestWebBundle")
        if FileManager.default.fileExists(atPath: testBundle.path) {
            NSLog("[RomaSync] getEffectiveBundleURL: DEBUG — using local TestWebBundle at %@", testBundle.path)
            return testBundle
        }
        #endif
        return nil
    }

    private func getLocalBundlePath() -> URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return support.appendingPathComponent("WebBundle")
    }

    // ─── iCloud availability ─────────────────────────────────────────────────

    @objc func isAvailable(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            let token = FileManager.default.ubiquityIdentityToken
            let available = token != nil
            NSLog("[RomaSync] isAvailable: %@", available ? "YES" : "NO")
            call.resolve(["available": available])
        }
    }

    // ─── Diagnostic: lightweight iCloud check (NO directory listing) ─────────

    @objc func diagnose(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            var info: [String: Any] = [:]

            // Step 1: iCloud identity token
            let token = FileManager.default.ubiquityIdentityToken
            info["hasToken"] = token != nil
            NSLog("[RomaSync] diagnose: token = %@", token != nil ? "present" : "nil")

            if token == nil {
                info["error"] = "No iCloud account. Sign into iCloud in Settings."
                call.resolve(info)
                return
            }

            // Step 2: Container URL
            let containerURL = self.getContainerURL(timeout: 10)
            info["hasContainer"] = containerURL != nil
            info["containerPath"] = containerURL?.path ?? "nil"
            NSLog("[RomaSync] diagnose: container = %@", containerURL?.path ?? "nil")

            if containerURL == nil {
                info["error"] = "iCloud container unavailable. Check iCloud Drive is ON in Settings."
                call.resolve(info)
                return
            }

            // Step 3: Check pages folder exists (NO listing — that's expensive)
            let docsURL = containerURL!.appendingPathComponent("Documents").appendingPathComponent(self.pagesFolder)
            let pagesExist = FileManager.default.fileExists(atPath: docsURL.path)
            info["pagesFolderExists"] = pagesExist
            NSLog("[RomaSync] diagnose: pagesFolder exists = %@", pagesExist ? "YES" : "NO")

            if !pagesExist {
                try? FileManager.default.createDirectory(at: docsURL, withIntermediateDirectories: true)
                info["pagesFolderCreated"] = true
            }

            info["ok"] = true
            call.resolve(info)
        }
    }

    // ─── Page sync ───────────────────────────────────────────────────────────

    @objc func pushPage(_ call: CAPPluginCall) {
        guard let pageJson = call.getString("json"),
              let pageId = call.getString("id") else {
            call.reject("Missing 'id' or 'json' parameter")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            guard let pagesURL = self.getPagesURL() else {
                NSLog("[RomaSync] pushPage: iCloud not available for page %@", pageId)
                call.reject("iCloud not available")
                return
            }
            let fileURL = pagesURL.appendingPathComponent("\(pageId).json")
            do {
                try pageJson.write(to: fileURL, atomically: true, encoding: .utf8)
                NSLog("[RomaSync] pushPage: wrote %@ (%d bytes)", pageId, pageJson.count)
                call.resolve(["success": true])
            } catch {
                NSLog("[RomaSync] pushPage: FAILED %@ — %@", pageId, error.localizedDescription)
                call.reject("Failed to write page: \(error.localizedDescription)")
            }
        }
    }

    @objc func pullAllPages(_ call: CAPPluginCall) {
        NSLog("[RomaSync] pullAllPages: using NSMetadataQuery")

        DispatchQueue.global(qos: .userInitiated).async {
            guard self.getContainerURL() != nil else {
                NSLog("[RomaSync] pullAllPages: iCloud not available")
                call.resolve(["pages": [], "placeholders": 0, "error": "iCloud not available"])
                return
            }

            let sem = DispatchSemaphore(value: 0)
            var resultPages: [String] = []
            var pendingCount = 0
            let pagesFolderSegment = "/\(self.pagesFolder)/"

            // NSMetadataQuery MUST start from a thread with a run loop → use main.
            // CRITICAL: the notification handler on main must be FAST (no file I/O).
            // File I/O for 2697 files on the main thread would freeze the entire UI.
            DispatchQueue.main.async {
                let query = NSMetadataQuery()
                query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
                query.predicate = NSPredicate(format: "%K LIKE '*.json'", NSMetadataItemFSNameKey)

                var observer: NSObjectProtocol?
                observer = NotificationCenter.default.addObserver(
                    forName: .NSMetadataQueryDidFinishGathering,
                    object: query,
                    queue: .main   // Handler on main — but MUST be quick (no file I/O)
                ) { [weak query] _ in
                    guard let query = query else { sem.signal(); return }
                    query.disableUpdates()
                    NSLog("[RomaSync] pullAllPages: gathered %d items", query.resultCount)

                    // ── PHASE 1 (main thread): collect metadata only — NO file I/O ──
                    var readyPaths: [String] = []   // files reported as on-device by iCloud
                    var downloadPaths: [String] = [] // files only in cloud

                    for case let item as NSMetadataItem in query.results {
                        guard let path = item.value(forAttribute: NSMetadataItemPathKey) as? String,
                              path.contains(pagesFolderSegment),
                              path.hasSuffix(".json") else { continue }

                        // Trust NSMetadataQuery status — do NOT call isReadableFile here
                        // (that would block the main thread for potentially thousands of files)
                        let status = item.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String
                        let isOnDevice = (status == NSMetadataUbiquitousItemDownloadingStatusCurrent)
                            || (status == NSMetadataUbiquitousItemDownloadingStatusDownloaded)

                        if isOnDevice {
                            readyPaths.append(path)
                        } else {
                            pendingCount += 1
                            downloadPaths.append(path)
                        }
                    }

                    query.stop()
                    if let obs = observer {
                        NotificationCenter.default.removeObserver(obs)
                        observer = nil
                    }

                    // ── PHASE 2 (background): trigger downloads + read files ──
                    // Moved entirely off main thread so UI stays responsive.
                    DispatchQueue.global(qos: .userInitiated).async {
                        for path in downloadPaths {
                            try? FileManager.default.startDownloadingUbiquitousItem(at: URL(fileURLWithPath: path))
                        }
                        for path in readyPaths {
                            if let content = try? String(contentsOf: URL(fileURLWithPath: path), encoding: .utf8) {
                                resultPages.append(content)
                            }
                        }
                        NSLog("[RomaSync] pullAllPages: %d readable, %d pending (triggered %d downloads)",
                              resultPages.count, pendingCount, downloadPaths.count)
                        sem.signal()
                    }
                }

                let started = query.start()
                NSLog("[RomaSync] pullAllPages: query.start() = %@", started ? "YES" : "NO")
                if !started {
                    sem.signal()
                }
            }

            // Wait on background thread — main thread is free to handle UI events
            let waited = sem.wait(timeout: .now() + 30)
            if waited == .timedOut {
                NSLog("[RomaSync] pullAllPages: timed out (30s)")
                call.resolve(["pages": [], "placeholders": 0, "error": "iCloud query timed out — try again"])
                return
            }

            call.resolve(["pages": resultPages, "placeholders": pendingCount])
        }
    }

    @objc func deletePage(_ call: CAPPluginCall) {
        guard let pageId = call.getString("id") else {
            call.reject("Missing 'id' parameter")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            guard let pagesURL = self.getPagesURL() else {
                call.resolve(["success": true])
                return
            }
            let fileURL = pagesURL.appendingPathComponent("\(pageId).json")
            try? FileManager.default.removeItem(at: fileURL)
            call.resolve(["success": true])
        }
    }

    // ─── Live web asset updates via iCloud ───────────────────────────────────

    @objc func checkWebUpdate(_ call: CAPPluginCall) {
        // Prevent concurrent calls from racing on version.json eviction/download.
        updateLock.lock()
        if _checkInProgress || _applyInProgress {
            updateLock.unlock()
            NSLog("[RomaSync] checkWebUpdate: already in progress, skipping")
            call.resolve(["available": false, "reason": "check already in progress"])
            return
        }
        _checkInProgress = true
        updateLock.unlock()

        DispatchQueue.global(qos: .userInitiated).async {
            defer {
                self.updateLock.lock()
                self._checkInProgress = false
                self.updateLock.unlock()
            }
            guard let bundleURL = self.getEffectiveBundleURL() else {
                NSLog("[RomaSync] checkWebUpdate: no bundle source (iCloud unavailable, no TestWebBundle)")
                call.resolve(["available": false, "reason": "no bundle source"])
                return
            }
            let isLocalFallback = self.getBundleURL() == nil

            // ── Step 1: Trigger download of parent docs dir, then bundle dir.
            // If web-bundle/ itself is still a placeholder (.web-bundle.icloud), trying to
            // access files inside it will silently fail — the parent must materialize first.
            if !isLocalFallback {
                if let docsURL = self.getDocsURL() {
                    try? FileManager.default.startDownloadingUbiquitousItem(at: docsURL)
                }
                try? FileManager.default.startDownloadingUbiquitousItem(at: bundleURL)
            }

            // ── Step 2: Wait for the bundle directory itself to exist (up to 30s).
            // Without this wait, startDownloadingUbiquitousItem on version.json fails
            // silently because the parent path doesn't exist on the local filesystem yet.
            if !isLocalFallback {
                var dirWaited = 0
                while !FileManager.default.fileExists(atPath: bundleURL.path) && dirWaited < 30 {
                    Thread.sleep(forTimeInterval: 1.0)
                    dirWaited += 1
                    // Re-trigger every 10s in case the first request was dropped
                    if dirWaited % 10 == 0 {
                        if let docsURL = self.getDocsURL() {
                            try? FileManager.default.startDownloadingUbiquitousItem(at: docsURL)
                        }
                        try? FileManager.default.startDownloadingUbiquitousItem(at: bundleURL)
                    }
                }
                if dirWaited > 0 {
                    NSLog("[RomaSync] checkWebUpdate: waited %ds for web-bundle directory", dirWaited)
                }
                guard FileManager.default.fileExists(atPath: bundleURL.path) else {
                    NSLog("[RomaSync] checkWebUpdate: web-bundle dir not available after 30s — iCloud not synced yet")
                    call.resolve(["available": false, "reason": "web-bundle dir not synced from iCloud"])
                    return
                }
            }

            let manifestURL = bundleURL.appendingPathComponent("version.json")
            let currentVersion = UserDefaults.standard.string(forKey: self.versionKey) ?? "0.0.0"

            // ── Step 3: Fast path — read CACHED version.json (no eviction, instant detection).
            if FileManager.default.isReadableFile(atPath: manifestURL.path),
               let cachedData = try? Data(contentsOf: manifestURL),
               let cachedManifest = try? JSONSerialization.jsonObject(with: cachedData) as? [String: Any],
               let cachedVersion = cachedManifest["version"] as? String {
                let isNewer = self.compareVersions(cachedVersion, currentVersion) > 0
                if isNewer {
                    NSLog("[RomaSync] checkWebUpdate (fast path): remote=%@, current=%@, available=YES",
                          cachedVersion, currentVersion)
                    call.resolve([
                        "available": true,
                        "version": cachedVersion,
                        "currentVersion": currentVersion,
                    ])
                    return
                }
                // Cached version is same/older — fall through to evict and re-download.
            }

            // ── Step 4: Slow path — evict stale cache, re-download version.json.
            if !isLocalFallback {
                try? FileManager.default.evictUbiquitousItem(at: manifestURL)
                try? FileManager.default.startDownloadingUbiquitousItem(at: manifestURL)
            }

            var waited = 0
            while !FileManager.default.isReadableFile(atPath: manifestURL.path) && waited < 60 {
                Thread.sleep(forTimeInterval: 1.0)
                waited += 1
                // Re-trigger download every 15s in case the first request was dropped
                if waited % 15 == 0 {
                    try? FileManager.default.startDownloadingUbiquitousItem(at: manifestURL)
                }
            }
            if waited > 0 {
                NSLog("[RomaSync] checkWebUpdate: waited %ds for version.json", waited)
            }

            guard FileManager.default.isReadableFile(atPath: manifestURL.path) else {
                NSLog("[RomaSync] checkWebUpdate: version.json not available after 60s wait")
                call.resolve(["available": false, "reason": "version.json not available after 60s"])
                return
            }

            guard let data = try? Data(contentsOf: manifestURL),
                  let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let remoteVersion = manifest["version"] as? String else {
                NSLog("[RomaSync] checkWebUpdate: invalid version.json")
                call.resolve(["available": false, "reason": "invalid version.json"])
                return
            }

            let isNewer = self.compareVersions(remoteVersion, currentVersion) > 0
            NSLog("[RomaSync] checkWebUpdate: remote=%@, current=%@, available=%@",
                  remoteVersion, currentVersion, isNewer ? "YES" : "NO")

            call.resolve([
                "available": isNewer,
                "version": remoteVersion,
                "currentVersion": currentVersion,
            ])
        }
    }

    @objc func applyWebUpdate(_ call: CAPPluginCall) {
        // Prevent concurrent apply calls from racing on the local WebBundle copy.
        updateLock.lock()
        if _applyInProgress {
            updateLock.unlock()
            NSLog("[RomaSync] applyWebUpdate: already in progress, skipping")
            call.resolve(["success": false, "reason": "apply already in progress"])
            return
        }
        _applyInProgress = true
        updateLock.unlock()

        DispatchQueue.global(qos: .userInitiated).async {
            defer {
                self.updateLock.lock()
                self._applyInProgress = false
                self.updateLock.unlock()
            }
            guard let bundleURL = self.getEffectiveBundleURL() else {
                call.reject("iCloud not available")
                return
            }

            // ── Step 1: Ensure version.json is readable ───────────────────────
            let manifestURL = bundleURL.appendingPathComponent("version.json")
            if !FileManager.default.isReadableFile(atPath: manifestURL.path) {
                try? FileManager.default.startDownloadingUbiquitousItem(at: manifestURL)
                var waited = 0
                while !FileManager.default.isReadableFile(atPath: manifestURL.path) && waited < 15 {
                    Thread.sleep(forTimeInterval: 1.0)
                    waited += 1
                }
            }

            guard let data = try? Data(contentsOf: manifestURL),
                  let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let version = manifest["version"] as? String else {
                call.reject("Invalid version manifest")
                return
            }

            // ── Step 2: Build the list of files to download ───────────────────
            // version.json now includes a "files" array listing exactly which files
            // belong to this build. We download ONLY those files, ignoring any stale
            // leftover placeholders from old builds (accumulated by previous cp -R deploys).
            // Falls back to a full directory scan if the manifest has no "files" key
            // (e.g. bundles deployed by an older version of deploy-ios-update.sh).
            let fileList: [String]? = manifest["files"] as? [String]

            if let fileList = fileList {
                NSLog("[RomaSync] applyWebUpdate: v%@ — manifest has %d files", version, fileList.count)
            } else {
                NSLog("[RomaSync] applyWebUpdate: v%@ — no manifest, scanning directory", version)
            }

            // ── Step 3: Trigger downloads for required files ──────────────────
            func triggerManifestDownloads() {
                guard let fileList = fileList else { return }
                for file in fileList {
                    let fileURL = bundleURL.appendingPathComponent(file)
                    try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL)
                    // Also ensure any parent subdirectory is triggered
                    let parentURL = fileURL.deletingLastPathComponent()
                    if parentURL.path != bundleURL.path {
                        try? FileManager.default.startDownloadingUbiquitousItem(at: parentURL)
                    }
                }
            }

            func triggerDirectoryDownloads(at dirURL: URL) {
                guard let items = try? FileManager.default.contentsOfDirectory(
                    at: dirURL, includingPropertiesForKeys: [.isDirectoryKey], options: []
                ) else { return }
                for item in items {
                    let name = item.lastPathComponent
                    if name.hasPrefix(".") && name.hasSuffix(".icloud") {
                        let realName = String(name.dropFirst().dropLast(".icloud".count))
                        let realURL = dirURL.appendingPathComponent(realName)
                        try? FileManager.default.startDownloadingUbiquitousItem(at: realURL)
                    } else {
                        var isDir: ObjCBool = false
                        if FileManager.default.fileExists(atPath: item.path, isDirectory: &isDir) {
                            if isDir.boolValue {
                                triggerDirectoryDownloads(at: item)
                            } else if !FileManager.default.isReadableFile(atPath: item.path) {
                                try? FileManager.default.startDownloadingUbiquitousItem(at: item)
                            }
                        }
                    }
                }
            }

            if fileList != nil {
                triggerManifestDownloads()
            } else {
                triggerDirectoryDownloads(at: bundleURL)
            }

            // ── Step 4: Wait for required files to be locally available ────────
            // Manifest path: check only the ~10–15 files that actually belong to
            // this build — avoids blocking on leftover stale placeholders.
            // Fallback path: check the entire directory tree (old behaviour).
            func manifestFilesReady() -> Bool {
                guard let fileList = fileList else { return false }
                for file in fileList {
                    let fileURL = bundleURL.appendingPathComponent(file)
                    if !FileManager.default.isReadableFile(atPath: fileURL.path) {
                        NSLog("[RomaSync] applyWebUpdate: waiting for %@", file)
                        return false
                    }
                }
                return true
            }

            func allDirectoryFilesReady(at dirURL: URL) -> Bool {
                guard let items = try? FileManager.default.contentsOfDirectory(
                    at: dirURL, includingPropertiesForKeys: [.isDirectoryKey], options: []
                ) else { return false }
                for item in items {
                    let name = item.lastPathComponent
                    if name.hasPrefix(".") && name.hasSuffix(".icloud") { return false }
                    var isDir: ObjCBool = false
                    if FileManager.default.fileExists(atPath: item.path, isDirectory: &isDir) {
                        if isDir.boolValue {
                            if !allDirectoryFilesReady(at: item) { return false }
                        } else if !FileManager.default.isReadableFile(atPath: item.path) {
                            return false
                        }
                    }
                }
                return true
            }

            var attempts = 0
            while attempts < 90 {
                let ready = fileList != nil ? manifestFilesReady() : allDirectoryFilesReady(at: bundleURL)
                if ready { break }
                if attempts % 15 == 5 {
                    NSLog("[RomaSync] applyWebUpdate: re-triggering downloads at %ds", attempts)
                    if fileList != nil { triggerManifestDownloads() } else { triggerDirectoryDownloads(at: bundleURL) }
                }
                Thread.sleep(forTimeInterval: 1.0)
                attempts += 1
            }

            let allReady = fileList != nil ? manifestFilesReady() : allDirectoryFilesReady(at: bundleURL)
            if !allReady {
                call.reject("Bundle files still downloading after 90s — try again later")
                return
            }
            NSLog("[RomaSync] applyWebUpdate: all files ready after %ds", attempts)

            // ── Step 5: Copy bundle to local storage and activate ─────────────
            // When a manifest is present, copy only the listed files (plus version.json)
            // so the local WebBundle never contains stale files from old builds.
            // Without a manifest, copy the entire directory (old behaviour).
            let localBundle = self.getLocalBundlePath()
            do {
                if FileManager.default.fileExists(atPath: localBundle.path) {
                    try FileManager.default.removeItem(at: localBundle)
                }

                if let fileList = fileList {
                    // Manifest-based copy: only copy files listed in version.json
                    try FileManager.default.createDirectory(at: localBundle, withIntermediateDirectories: true)
                    for file in fileList {
                        let src = bundleURL.appendingPathComponent(file)
                        let dst = localBundle.appendingPathComponent(file)
                        let dstDir = dst.deletingLastPathComponent()
                        if !FileManager.default.fileExists(atPath: dstDir.path) {
                            try FileManager.default.createDirectory(at: dstDir, withIntermediateDirectories: true)
                        }
                        try FileManager.default.copyItem(at: src, to: dst)
                    }
                    // Always copy version.json into the local bundle
                    let versionDst = localBundle.appendingPathComponent("version.json")
                    try FileManager.default.copyItem(at: manifestURL, to: versionDst)
                } else {
                    // Fallback: copy entire directory (no manifest present)
                    try FileManager.default.copyItem(at: bundleURL, to: localBundle)
                }

                UserDefaults.standard.set(version, forKey: self.versionKey)
                NSLog("[RomaSync] applyWebUpdate: applied v%@ ✓", version)

                DispatchQueue.main.async {
                    if let bridge = self.bridge {
                        bridge.setServerBasePath(localBundle.path)
                    }
                }
                call.resolve(["success": true, "version": version])
            } catch {
                NSLog("[RomaSync] applyWebUpdate: copy FAILED — %@", error.localizedDescription)
                call.reject("Failed to apply update: \(error.localizedDescription)")
            }
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private func compareVersions(_ a: String, _ b: String) -> Int {
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
