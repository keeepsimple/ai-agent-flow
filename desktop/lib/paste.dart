import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter/services.dart';

import 'api.dart';
import 'pick.dart';

/// Cmd-V, for whatever is on the clipboard.
///
/// Flutter's own clipboard is text only, so an image has to be fetched the way
/// the OS will give it. Binding the key for the image alone swallowed it, and
/// pasting text did nothing; both prompt boxes go through here so they cannot
/// drift apart again.
Future<void> pasteInto({
  required TextEditingController controller,
  required Api api,
  required void Function(String path) onAttached,
  required void Function(Object error) onError,

  /// Only so a test does not have to put a real image on a real clipboard.
  Future<File?> Function()? readImage,
}) async {
  try {
    final file = await (readImage ?? Pick.clipboardImage)();
    if (file != null) {
      final saved = await api.upload(file.uri.pathSegments.last, await file.readAsBytes());
      onAttached(saved['path'] as String);
      return;
    }
  } catch (err) {
    onError(err);
    return;
  }

  final text = (await Clipboard.getData(Clipboard.kTextPlain))?.text;
  if (text == null || text.isEmpty) return;

  final value = controller.value;
  final at = value.selection.isValid
      ? value.selection
      : TextSelection.collapsed(offset: value.text.length);
  controller.value = value.replaced(at, text).copyWith(
        selection: TextSelection.collapsed(offset: at.start + text.length),
      );
}

/// Attach a file chosen from a dialog, for the paperclip.
Future<void> attachInto({
  required Api api,
  required void Function(String path) onAttached,
  required void Function(Object error) onError,
}) async {
  final path = await Pick.file();
  if (path == null) return;
  try {
    final file = File(path);
    final saved = await api.upload(file.uri.pathSegments.last, await file.readAsBytes());
    onAttached(saved['path'] as String);
  } catch (err) {
    onError(err);
  }
}
