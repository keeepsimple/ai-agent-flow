import 'dart:convert';
import 'dart:io';

import 'server.dart';

/// What the window remembers that AppKit does not: which workspace was open,
/// and whether the sidebar was put away. Kept beside the tasks rather than in
/// user defaults, so it travels with the data it is about.
class Prefs {
  Prefs._(this._file, this._values);

  final File _file;
  final Map<String, dynamic> _values;

  static Prefs load() {
    final file = File('${FlowServer.dataDir()}/ui.json');
    try {
      return Prefs._(file, jsonDecode(file.readAsStringSync()) as Map<String, dynamic>);
    } catch (_) {
      // No file yet, or one written by a newer version that this cannot read.
      return Prefs._(file, {});
    }
  }

  bool get sidebarOpen => _values['sidebarOpen'] as bool? ?? true;
  String? get workspace => _values['workspace'] as String?;

  void set({bool? sidebarOpen, String? workspace, bool clearWorkspace = false}) {
    if (sidebarOpen != null) _values['sidebarOpen'] = sidebarOpen;
    if (clearWorkspace) {
      _values.remove('workspace');
    } else if (workspace != null) {
      _values['workspace'] = workspace;
    }
    try {
      _file.parent.createSync(recursive: true);
      _file.writeAsStringSync(jsonEncode(_values));
    } catch (_) {
      // Remembering is a convenience; failing to is not worth a banner.
    }
  }
}
