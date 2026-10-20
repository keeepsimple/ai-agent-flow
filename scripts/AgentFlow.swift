// The app itself: one window, one web view, and the server running underneath
// as a child. Replaces opening a browser tab.
//
// The server is the same one `npm start` runs. This only starts it, waits for
// the port, shows it, and makes sure it dies when the window does.
import Cocoa
import WebKit

let port = ProcessInfo.processInfo.environment["FLOW_PORT"] ?? "7777"
let home = URL(string: "http://127.0.0.1:\(port)")!
let origin = "127.0.0.1"

/// Resources/ next to this binary: Contents/MacOS/.. /Resources
func resource(_ name: String) -> String {
  let macos = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
  return macos.deletingLastPathComponent().appendingPathComponent("Resources/\(name)").path
}

final class Server {
  private var process: Process?

  /// Already running means a web-mode server is up; use it rather than
  /// fighting it for the port.
  func start() -> Bool {
    if reachable() { return true }

    let node = resource("node")
    let entry = resource("app/server/index.js")
    guard FileManager.default.fileExists(atPath: node) else { return false }

    var env = ProcessInfo.processInfo.environment
    // A GUI app inherits almost no PATH, and the agent needs git and claude.
    let path = env["PATH"] ?? "/usr/bin:/bin"
    env["PATH"] = "\(NSHomeDirectory())/.local/bin:/opt/homebrew/bin:/usr/local/bin:\(path)"
    if env["FLOW_DATA"] == nil {
      env["FLOW_DATA"] = "\(NSHomeDirectory())/Library/Application Support/Agent Flow"
    }
    if env["FLOW_REPO_ROOT"] == nil { env["FLOW_REPO_ROOT"] = NSHomeDirectory() }
    try? FileManager.default.createDirectory(
      atPath: env["FLOW_DATA"]!, withIntermediateDirectories: true)

    let task = Process()
    task.executableURL = URL(fileURLWithPath: node)
    task.arguments = [entry]
    task.environment = env
    do { try task.run() } catch { return false }
    process = task
    return true
  }

  func reachable() -> Bool {
    guard let url = URL(string: "http://127.0.0.1:\(port)/api/state") else { return false }
    var request = URLRequest(url: url)
    request.timeoutInterval = 1
    var up = false
    let done = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: request) { _, response, _ in
      up = (response as? HTTPURLResponse)?.statusCode == 200
      done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + 2)
    return up
  }

  /// The server kills its own agents when it goes, which is why this has to
  /// happen rather than being left to the OS reaping a parent.
  func stop() {
    process?.terminate()
    process?.waitUntilExit()
  }
}

final class Delegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
  let server = Server()
  var window: NSWindow!
  var web: WKWebView!

  func applicationDidFinishLaunching(_ note: Notification) {
    menu()

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1340, height: 860),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered, defer: false)
    window.title = "Agent Flow"
    window.titlebarAppearsTransparent = true
    window.backgroundColor = NSColor(red: 0.043, green: 0.047, blue: 0.055, alpha: 1) // --color-page
    window.setFrameAutosaveName("AgentFlowWindow")
    window.center()

    let config = WKWebViewConfiguration()
    web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.setValue(false, forKey: "drawsBackground")
    window.contentView = web
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)

    DispatchQueue.global().async { [weak self] in
      guard let self else { return }
      let started = self.server.start()
      // Starting is not serving: node has to come up and bind first.
      var ready = false
      for _ in 0..<60 where started {
        if self.server.reachable() { ready = true; break }
        Thread.sleep(forTimeInterval: 0.25)
      }
      DispatchQueue.main.async {
        if ready {
          self.web.load(URLRequest(url: home))
        } else {
          self.fail(started
            ? "The server started but never answered on port \(port)."
            : "Could not start the server. The app is missing its copy of Node.")
        }
      }
    }
  }

  func applicationWillTerminate(_ note: Notification) { server.stop() }

  func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

  /// A link out of the tool — a merge request, a pipeline — belongs in the
  /// browser. Only the tool's own pages are shown in here.
  func webView(
    _ view: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if let url = action.request.url, url.host != nil, url.host != origin {
      NSWorkspace.shared.open(url)
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  /// A blank window says nothing on its own; these do.
  func webView(_ v: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) {
    FileHandle.standardError.write("load failed (provisional): \(e)\n".data(using: .utf8)!)
  }

  func webView(_ v: WKWebView, didFail n: WKNavigation!, withError e: Error) {
    FileHandle.standardError.write("load failed: \(e)\n".data(using: .utf8)!)
  }

  /// target="_blank" has no second window to open into here.
  func webView(
    _ view: WKWebView, createWebViewWith config: WKWebViewConfiguration,
    for action: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = action.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  private func fail(_ message: String) {
    let html = """
      <body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0c0e;
                   color:#9097a3;font:14px -apple-system,sans-serif;text-align:center">
        <div><p style="color:#edeef0">\(message)</p>
        <p>Run it from a terminal to see why.</p></div>
      </body>
      """
    web.loadHTMLString(html, baseURL: nil)
  }

  /// Without a menu there is no Cmd-Q, and no Cmd-V inside the web view.
  private func menu() {
    let bar = NSMenu()

    let appItem = NSMenuItem()
    let app = NSMenu()
    app.addItem(withTitle: "Hide Agent Flow", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    app.addItem(NSMenuItem.separator())
    app.addItem(withTitle: "Quit Agent Flow", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = app
    bar.addItem(appItem)

    let editItem = NSMenuItem()
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(NSMenuItem.separator())
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit
    bar.addItem(editItem)

    let viewItem = NSMenuItem()
    let view = NSMenu(title: "View")
    view.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
    view.addItem(
      withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)),
      keyEquivalent: "f")
    viewItem.submenu = view
    bar.addItem(viewItem)

    NSApp.mainMenu = bar
  }

  @objc private func reload() { web.reload() }
}

let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
