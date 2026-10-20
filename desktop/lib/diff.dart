/// A port of the web client's unified-diff reader: line numbers on both sides,
/// markers kept so the renderer can colour them.
class DiffLine {
  const DiffLine(this.kind, this.text, this.before, this.after);
  final String kind; // 'add' | 'del' | 'same' | 'hunk'
  final String text;
  final int? before;
  final int? after;
}

final _hunk = RegExp(r'^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@');

List<DiffLine> readDiff(String? patch) {
  final out = <DiffLine>[];
  var before = 0;
  var after = 0;

  for (final line in (patch ?? '').split('\n')) {
    final hunk = _hunk.firstMatch(line);
    if (hunk != null) {
      before = int.parse(hunk.group(1)!);
      after = int.parse(hunk.group(2)!);
      out.add(DiffLine('hunk', line, null, null));
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) {
      out.add(DiffLine('add', line.substring(1), null, after++));
    } else if (line.startsWith('-')) {
      out.add(DiffLine('del', line.substring(1), before++, null));
    } else if (line.startsWith(' ') || line.isEmpty) {
      out.add(DiffLine(
          'same', line.isEmpty ? '' : line.substring(1), before++, after++));
    }
  }
  return out;
}
