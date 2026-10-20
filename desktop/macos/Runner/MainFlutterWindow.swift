import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
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
    self.isMovableByWindowBackground = true
    self.appearance = NSAppearance(named: .darkAqua)
    self.backgroundColor = NSColor(red: 0.043, green: 0.047, blue: 0.055, alpha: 1) // --color-page

    RegisterGeneratedPlugins(registry: flutterViewController)

    super.awakeFromNib()
  }
}
