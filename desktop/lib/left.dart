/// What the self-review left behind, read from review.md's `## Left` section:
/// one `- [ ]` line each, tagged `fixable:` or `decision:`. An untagged line
/// is a decision: never sent to be fixed on its own.
class LeftItem {
  const LeftItem({required this.text, required this.kind, required this.done});
  final String text;
  final String kind; // fixable | decision
  final bool done;
}

List<LeftItem> leftOf(String? reviewMd) {
  if (reviewMd == null) return const [];
  final out = <LeftItem>[];
  var inLeft = false;
  for (final raw in reviewMd.split('\n')) {
    final line = raw.trimRight();
    if (line.startsWith('#')) {
      inLeft = RegExp(r'^#+\s*Left\b', caseSensitive: false).hasMatch(line);
      continue;
    }
    if (!inLeft) continue;
    final m = RegExp(r'^\s*[-*]\s*\[( |x|X)\]\s*(.*)$').firstMatch(line);
    if (m == null) continue;
    final done = m.group(1)!.toLowerCase() == 'x';
    var text = m.group(2)!.trim();
    var kind = 'decision';
    final tag = RegExp(r'^(fixable|decision):\s*', caseSensitive: false).firstMatch(text);
    if (tag != null) {
      kind = tag.group(1)!.toLowerCase();
      text = text.substring(tag.end).trim();
    }
    out.add(LeftItem(text: text, kind: kind, done: done));
  }
  return out;
}

/// The one follow-up that clears the fixable ones.
const fixLeftRequest =
    'Fix every item tagged fixable under ## Left in review.md, re-run the checks, and tick them off in review.md.';
