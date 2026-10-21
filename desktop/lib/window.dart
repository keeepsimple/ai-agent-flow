import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Whether the window is in full screen, which only the platform knows.
///
/// It matters because this app draws its own title bar: in full screen there
/// are no traffic lights to leave room for, and the row has to stop pretending
/// there are.
class WindowState extends ChangeNotifier {
  WindowState() {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'fullScreen') {
        fullScreen = call.arguments == true;
        notifyListeners();
      }
    });
    _ask();
  }

  static const _channel = MethodChannel('agentflow/window');
  bool fullScreen = false;

  /// A window restored into full screen never sends the notification, because
  /// it never entered one.
  Future<void> _ask() async {
    try {
      fullScreen = await _channel.invokeMethod<bool>('fullScreen') ?? false;
      notifyListeners();
    } on MissingPluginException {
      // Running somewhere without the macOS side of this; not full screen.
    } catch (_) {
      // Same.
    }
  }
}
