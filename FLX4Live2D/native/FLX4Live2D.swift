import AppKit
import WebKit
import Foundation

/// Independent, two-dimensional desktop window for the original DDJ-FLX4
/// controller bridge. The existing 3D dashboard is left untouched.
final class FLX4AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: Process?
    private var firstPageLoad = true
    private let serverURL = URL(string: "http://127.0.0.1:18767/realistic.html")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        let browser = WKWebView(frame: .zero, configuration: config)
        browser.navigationDelegate = self
        browser.uiDelegate = self
        browser.setValue(false, forKey: "drawsBackground")
        browser.allowsBackForwardNavigationGestures = false
        webView = browser

        let viewport = NSRect(x: 0, y: 0, width: 1270, height: 795)
        window = NSWindow(contentRect: viewport,
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "FLX4 Live 2D — Fixed 3D / rekordbox + Existing Samplers"
        window.minSize = NSSize(width: 980, height: 660)
        window.center()
        window.contentView = browser
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        if let icon = Bundle.main.path(forResource: "FLX4Live2D", ofType: "icns"),
           let art = NSImage(contentsOfFile: icon) {
            NSApp.applicationIconImage = art
        }
        startLocalBackend()
        loadWhenAvailable(attempt: 0)
    }

    private func startLocalBackend() {
        guard let source = Bundle.main.resourceURL?.appendingPathComponent("FLX4Live2D/bridge.py"),
              FileManager.default.fileExists(atPath: source.path) else {
            showError("The FLX4 Live 2D backend is missing from this application.")
            return
        }

        // The existing rekordbox MIDI bridge is a sibling project. Only the
        // new 2D server is started here. Rekordbox's original runtime is
        // connected separately, after the user clicks Connect in the UI.
        let rekordboxRoot = ProcessInfo.processInfo.environment["REKORDBOX_MCP_ROOT"]
             ?? FileManager.default.currentDirectoryPath
        let venvPython = URL(fileURLWithPath: rekordboxRoot)
            .appendingPathComponent(".venv/bin/python").path
        guard FileManager.default.fileExists(atPath: venvPython) else {
            showError("Rekordbox Python environment not found at " + venvPython)
            return
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: venvPython)
        process.arguments = [source.path]
        process.currentDirectoryURL = source.deletingLastPathComponent()
        var env = ProcessInfo.processInfo.environment
        env["REKORDBOX_MCP_ROOT"] = rekordboxRoot
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        process.environment = env
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            server = process
        } catch {
            showError("Unable to start the local FLX4 bridge: " + error.localizedDescription)
        }
    }

    private func loadWhenAvailable(attempt: Int) {
        var request = URLRequest(url: serverURL, cachePolicy: .reloadIgnoringLocalCacheData)
        request.timeoutInterval = 0.8
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let response = response as? HTTPURLResponse, response.statusCode == 200 {
                    self.webView.load(URLRequest(url: self.serverURL))
                } else if attempt < 50 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                        self.loadWhenAvailable(attempt: attempt + 1)
                    }
                } else {
                    self.showError("The local interface at 127.0.0.1:18767 did not start. Check the installed bridge and Python environment.")
                }
            }
        }.resume()
    }

    private func showError(_ detail: String) {
        let alert = NSAlert()
        alert.messageText = "FLX4 Live 2D"
        alert.informativeText = detail
        alert.alertStyle = .warning
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // A newly created WKWebView can restore the last focused/scrollable
        // input's viewport; show the actual FLX4 face first on app launch.
        guard firstPageLoad else { return }
        firstPageLoad = false
        let reset = "history.scrollRestoration='manual';window.scrollTo(0,0);document.documentElement.scrollTop=0;document.body.scrollTop=0;"
        webView.evaluateJavaScript(reset, completionHandler: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak webView] in
            webView?.evaluateJavaScript(reset, completionHandler: nil)
        }
    }

    // Safari-style native Open panel for importing drum WAV/AIFF/MP3/FLAC
    // files into the Web Audio sampler without uploading them anywhere.
    func webView(_ webView: WKWebView,
                 runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let openPanel = NSOpenPanel()
        openPanel.canChooseFiles = true
        openPanel.canChooseDirectories = false
        openPanel.allowsMultipleSelection = parameters.allowsMultipleSelection
        openPanel.begin { result in
            completionHandler(result == .OK ? openPanel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url,
           let host = url.host,
           host != "127.0.0.1" && host != "localhost" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Only terminate a bridge process created by THIS window; never stop
        // Rekordbox itself, an already-running 3D bridge or another 2D window.
        if let process = server, process.isRunning {
            process.terminate()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = FLX4AppDelegate()
app.delegate = delegate
app.run()
