import 'dart:io';

/// Native dialogs and the clipboard, without a plugin: every desktop already
/// ships something that can do this from a command line.
class Pick {
  /// A file to attach. Null when the dialog was cancelled.
  static Future<String?> file() async {
    if (Platform.isMacOS) {
      final out = await Process.run('osascript', [
        '-e',
        'POSIX path of (choose file with prompt "Attach a file")',
      ]);
      return _path(out);
    }
    if (Platform.isWindows) {
      final out = await Process.run('powershell', [
        '-NoProfile',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms;'
            r'$d = New-Object System.Windows.Forms.OpenFileDialog;'
            r'if ($d.ShowDialog() -eq "OK") { $d.FileName }',
      ]);
      return _path(out);
    }
    final out = await Process.run('zenity', ['--file-selection']);
    return _path(out);
  }

  /// A screenshot sitting on the clipboard, written out as a PNG. Null when
  /// the clipboard holds something else, which is the common case.
  static Future<File?> clipboardImage() async {
    final target =
        File('${Directory.systemTemp.path}/flow-paste-${DateTime.now().millisecondsSinceEpoch}.png');

    if (Platform.isMacOS) {
      final script = '''
        set target to POSIX file "${target.path}"
        try
          set png to (the clipboard as «class PNGf»)
        on error
          return "none"
        end try
        set handle to open for access target with write permission
        write png to handle
        close access handle
        return "ok"
      ''';
      final out = await Process.run('osascript', ['-e', script]);
      if ((out.stdout as String).trim() != 'ok') return null;
      return target.existsSync() && target.lengthSync() > 0 ? target : null;
    }

    if (Platform.isWindows) {
      final out = await Process.run('powershell', [
        '-NoProfile',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms;'
            r'$img = [System.Windows.Forms.Clipboard]::GetImage();'
            'if (\$img) { \$img.Save("${target.path}"); "ok" } else { "none" }',
      ]);
      if ((out.stdout as String).trim() != 'ok') return null;
      return target.existsSync() ? target : null;
    }

    return null;
  }

  static String? _path(ProcessResult out) {
    final text = (out.stdout as String).trim();
    if (out.exitCode != 0 || text.isEmpty) return null;
    return text;
  }
}
