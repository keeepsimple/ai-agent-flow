import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  /// Flutter draws this window's title bar, so it has to be told when there
  /// stops being one. In full screen there are no traffic lights to leave
  /// room for, and the toolbar AppKit keeps reserving overlays the header
  /// rather than sitting beside it.
  private var channel: FlutterMethodChannel?

  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    // The window is one dark surface. Without this the title bar stays light
    // grey above an almost-black app, which is the seam you cannot unsee.
    // Hiding the title and letting the content run under it means the header
    // has to leave room for the traffic lights; it does.
    self.styleMask.insert(.fullSizeContentView)
    self.titlebarAppearsTransparent = true
    self.titleVisibility = .hidden

    // An empty unified toolbar, purely for its geometry: it takes the title
    // bar from 32pt to 52pt and moves the traffic lights to the middle of it
    // (centres at 26, spanning x 19..79, measured rather than guessed). The
    // header can then be a normal centred row instead of a band pinned to the
    // top of the window with dead space under it.
    let toolbar = NSToolbar(identifier: "AgentFlowToolbar")
    self.toolbar = toolbar
    self.toolbarStyle = .unified
    self.isMovableByWindowBackground = true
    self.appearance = NSAppearance(named: .darkAqua)
    self.backgroundColor = NSColor(red: 0.043, green: 0.047, blue: 0.055, alpha: 1) // --color-page

    // Set after the frame, so a remembered one wins over the nib's. AppKit
    // keeps it in user defaults and restores it on the next launch.
    self.setFrameAutosaveName("AgentFlowWindow")

    channel = FlutterMethodChannel(
      name: "agentflow/window",
      binaryMessenger: flutterViewController.engine.binaryMessenger)
    channel?.setMethodCallHandler { [weak self] call, reply in
      // Asked for once on startup: a window restored into full screen would
      // otherwise lay itself out as if it were not.
      reply(call.method == "fullScreen" ? self?.isFullScreen() ?? false : FlutterMethodNotImplemented)
    }

    for (name, full) in [
      (NSWindow.didEnterFullScreenNotification, true),
      (NSWindow.didExitFullScreenNotification, false),
    ] {
      NotificationCenter.default.addObserver(
        forName: name, object: self, queue: .main
      ) { [weak self] _ in
        // The reserved toolbar strip is what leaves a dead band across the
        // top and hides the header under it.
        self?.toolbar?.isVisible = !full
        self?.channel?.invokeMethod("fullScreen", arguments: full)
      }
    }

    RegisterGeneratedPlugins(registry: flutterViewController)

    super.awakeFromNib()
  }

  private func isFullScreen() -> Bool { styleMask.contains(.fullScreen) }
}
