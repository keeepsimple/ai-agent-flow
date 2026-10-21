import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

const _digits = [
  LogicalKeyboardKey.digit1,
  LogicalKeyboardKey.digit2,
  LogicalKeyboardKey.digit3,
  LogicalKeyboardKey.digit4,
  LogicalKeyboardKey.digit5,
  LogicalKeyboardKey.digit6,
  LogicalKeyboardKey.digit7,
  LogicalKeyboardKey.digit8,
  LogicalKeyboardKey.digit9,
];

/// Cmd-1 to Cmd-9 for the workspaces, Cmd-0 for all of them, Cmd-\ for the
/// sidebar. Control as well as Command, so the same build works on Windows.
///
/// Whatever holds these has to have focus inside it, or the key never travels
/// through it: a shortcut is only seen on its way up from the focused widget.
Map<ShortcutActivator, VoidCallback> workspaceShortcuts({
  required int workspaces,
  required void Function(int index) onWorkspace,
  required VoidCallback onEverything,
  required VoidCallback onToggleSidebar,
}) =>
    {
      for (var i = 0; i < _digits.length; i++) ...{
        SingleActivator(_digits[i], meta: true): () {
          if (i < workspaces) onWorkspace(i);
        },
        SingleActivator(_digits[i], control: true): () {
          if (i < workspaces) onWorkspace(i);
        },
      },
      const SingleActivator(LogicalKeyboardKey.digit0, meta: true): onEverything,
      const SingleActivator(LogicalKeyboardKey.digit0, control: true): onEverything,
      const SingleActivator(LogicalKeyboardKey.backslash, meta: true): onToggleSidebar,
      const SingleActivator(LogicalKeyboardKey.backslash, control: true): onToggleSidebar,
    };
