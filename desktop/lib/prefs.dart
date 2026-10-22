import 'dart:convert';
import 'dart:io';

import 'server.dart';

/// What the window remembers that AppKit does not: which workspace was open,
/// and whether the sidebar was put away. Kept beside the tasks rather than in
/// user defaults, so it travels with the data it is about.
class Prefs {
  Prefs._(this._file, this._values);

  /// For tests and for anything that must not touch what the person set:
  /// reads defaults, writes nowhere.
  Prefs.memory()
      : _file = null,
        _values = {};

  final File? _file;
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
  bool get changesOpen => _values['changesOpen'] as bool? ?? true;
  double get changesWidth => (_values['changesWidth'] as num?)?.toDouble() ?? 520;

  /// Interrupted tasks are picked up when the app launches, unless this is off.
  bool get autoResume => _values['autoResume'] as bool? ?? true;

  /// The conversations left open, oldest first. Remembered so quitting is not
  /// the same as closing every one of them: twelve tasks took twelve trips to
  /// the board to get back.
  List<String> get tabs =>
      ((_values['tabs'] as List?) ?? const []).cast<String>();

  void set({
    bool? sidebarOpen,
    String? workspace,
    bool clearWorkspace = false,
    bool? changesOpen,
    double? changesWidth,
    bool? autoResume,
    List<String>? tabs,
  }) {
    if (tabs != null) _values['tabs'] = tabs;
    if (autoResume != null) _values['autoResume'] = autoResume;
    if (sidebarOpen != null) _values['sidebarOpen'] = sidebarOpen;
    if (changesOpen != null) _values['changesOpen'] = changesOpen;
    if (changesWidth != null) _values['changesWidth'] = changesWidth;
    if (clearWorkspace) {
      _values.remove('workspace');
    } else if (workspace != null) {
      _values['workspace'] = workspace;
    }
    final file = _file;
    if (file == null) return;
    try {
      file.parent.createSync(recursive: true);
      file.writeAsStringSync(jsonEncode(_values));
    } catch (_) {
      // Remembering is a convenience; failing to is not worth a banner.
    }
  }
}
