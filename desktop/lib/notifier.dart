import 'package:flutter/services.dart';

/// Desktop notifications, raised by the app rather than by its server.
///
/// The server can run a shell notifier, but that notification belongs to
/// whatever ran it, so clicking it opens that. This one is the app's own.
class Notifier {
  Notifier({required this.onOpened}) {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'opened' && call.arguments is String) {
        onOpened(call.arguments as String);
      }
    });
  }

  static const _channel = MethodChannel('agentflow/notify');

  /// What to do when one is clicked: open the task it was about.
  final void Function(String taskId) onOpened;

  bool supported = true;

  Future<void> show({
    required String title,
    required String body,
    String? taskId,
    bool urgent = false,
  }) async {
    if (!supported) return;
    try {
      await _channel.invokeMethod('show', {
        'title': title,
        'body': body,
        'taskId': taskId,
        'urgent': urgent,
      });
    } on MissingPluginException {
      // Running somewhere without the macOS side: let the server do it.
      supported = false;
    } catch (_) {
      supported = false;
    }
  }
}
