import Cocoa
import FlutterMacOS
import UserNotifications

class MainFlutterWindow: NSWindow {
  /// Flutter draws this window's title bar, so it has to be told when there
  /// stops being one. In full screen there are no traffic lights to leave
  /// room for, and the toolbar AppKit keeps reserving overlays the header
  /// rather than sitting beside it.
  private var channel: FlutterMethodChannel?
  private var notifications: FlutterMethodChannel?

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

    notifications = FlutterMethodChannel(
      name: "agentflow/notify",
      binaryMessenger: flutterViewController.engine.binaryMessenger)
    Notifier.shared.start(on: notifications!)

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


/// Desktop notifications raised by the app itself.
///
/// The server can raise one through the shell, but that notification belongs
/// to whatever ran it — terminal-notifier, or Script Editor — so clicking it
/// opens that, not this. One posted here belongs to Agent Flow: it carries
/// the app's own icon, and clicking it brings the window forward and opens
/// the task it was about.
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
  static let shared = Notifier()

  private var channel: FlutterMethodChannel?

  func start(on channel: FlutterMethodChannel) {
    self.channel = channel
    let centre = UNUserNotificationCenter.current()
    centre.delegate = self
    centre.requestAuthorization(options: [.alert, .sound]) { _, _ in }

    channel.setMethodCallHandler { [weak self] call, reply in
      guard call.method == "show", let args = call.arguments as? [String: Any] else {
        return reply(FlutterMethodNotImplemented)
      }
      self?.show(
        title: args["title"] as? String ?? "Agent Flow",
        body: args["body"] as? String ?? "",
        taskId: args["taskId"] as? String,
        urgent: args["urgent"] as? Bool ?? false)
      reply(nil)
    }
  }

  private func show(title: String, body: String, taskId: String?, urgent: Bool) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = urgent ? .defaultCritical : .default
    if let taskId { content.userInfo = ["taskId": taskId] }

    // One per task, replaced rather than stacked: a long run would otherwise
    // leave a column of its own history in Notification Centre.
    UNUserNotificationCenter.current().add(
      UNNotificationRequest(
        identifier: taskId ?? UUID().uuidString, content: content, trigger: nil))
  }

  /// Without this the banner is suppressed whenever the app is in front,
  /// which is most of the time someone is watching a run.
  func userNotificationCenter(
    _ centre: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    done([.banner, .sound])
  }

  func userNotificationCenter(
    _ centre: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler done: @escaping () -> Void
  ) {
    NSApp.activate(ignoringOtherApps: true)
    NSApp.windows.first?.makeKeyAndOrderFront(nil)
    if let taskId = response.notification.request.content.userInfo["taskId"] as? String {
      channel?.invokeMethod("opened", arguments: taskId)
    }
    done()
  }
}
