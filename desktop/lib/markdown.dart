/// A port of the web client's markdown splitter, kept deliberately literal so
/// the two stay comparable. Just enough for what an agent writes: headings,
/// fenced code, lists, quotes, tables.
sealed class Block {
  const Block();
}

class Para extends Block {
  const Para(this.text);
  final String text;
}

class Heading extends Block {
  const Heading(this.level, this.text);
  final int level;
  final String text;
}

class Bullets extends Block {
  const Bullets(this.items);
  final List<String> items;
}

class Code extends Block {
  const Code(this.text);
  final String text;
}

class Quote extends Block {
  const Quote(this.text);
  final String text;
}

class TableBlock extends Block {
  const TableBlock(this.head, this.rows);
  final List<String> head;
  final List<List<String>> rows;
}

final _fence = RegExp(r'^```');
final _row = RegExp(r'^\s*\|.*\|\s*$');
final _divider = RegExp(r'^\s*\|[\s:|-]+\|\s*$');
final _heading = RegExp(r'^(#{1,6})\s+(.*)$');
final _item = RegExp(r'^\s*(?:[-*]|\d+\.)\s+(.*)$');
final _indented = RegExp(r'^\s+\S');

List<String> _cells(String row) => row
    .trim()
    .replaceAll(RegExp(r'^\||\|$'), '')
    .split('|')
    .map((c) => c.trim())
    .toList();

List<Block> blocks(String? source) {
  final lines = (source ?? '').split('\n');
  final out = <Block>[];
  var paragraph = <String>[];
  List<String>? list;

  void endParagraph() {
    if (paragraph.isEmpty) return;
    out.add(Para(paragraph.join(' ')));
    paragraph = [];
  }

  void endBlock() {
    endParagraph();
    if (list == null) return;
    out.add(Bullets(list!));
    list = null;
  }

  for (var i = 0; i < lines.length; i++) {
    final line = lines[i];

    if (_fence.hasMatch(line)) {
      endBlock();
      final code = <String>[];
      for (i++; i < lines.length && !_fence.hasMatch(lines[i]); i++) {
        code.add(lines[i]);
      }
      out.add(Code(code.join('\n')));
      continue;
    }

    // | a | b | followed by |---|---| is a table, and only then.
    if (_row.hasMatch(line) &&
        _divider.hasMatch(i + 1 < lines.length ? lines[i + 1] : '')) {
      endBlock();
      final head = _cells(line);
      final rows = <List<String>>[];
      for (i += 2; i < lines.length && _row.hasMatch(lines[i]); i++) {
        rows.add(_cells(lines[i]));
      }
      i--; // the loop's own i++ takes the line after the table
      out.add(TableBlock(head, rows));
      continue;
    }

    final head = _heading.firstMatch(line);
    if (head != null) {
      endBlock();
      out.add(Heading(head.group(1)!.length, head.group(2)!));
      continue;
    }

    final item = _item.firstMatch(line);
    if (item != null) {
      endParagraph();
      list ??= [];
      list!.add(item.group(1)!);
      continue;
    }

    // An indented line under a list item continues that item.
    if (list != null && _indented.hasMatch(line)) {
      list![list!.length - 1] += ' ${line.trim()}';
      continue;
    }

    if (line.startsWith('>')) {
      endBlock();
      out.add(Quote(line.replaceFirst(RegExp(r'^>\s?'), '')));
      continue;
    }

    if (line.trim().isEmpty) {
      endBlock();
      continue;
    }

    if (list != null) endBlock();
    paragraph.add(line.trim());
  }
  endBlock();
  return out;
}

/// Inline marks, in the order they have to be tried. Code first, so a URL in
/// backticks stays code; the `[text](url)` form before the bare URL, which
/// would otherwise lift the URL out of the middle and leave the brackets.
final inlineMarks = RegExp(
  r'(`[^`]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>]+|\*\*[^*]+\*\*|\*[^*\n]+\*)',
);

class Link {
  const Link(this.href, this.text, this.trail);
  final String href;
  final String text;
  final String trail;
}

final _mdLink = RegExp(r'^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$');
final _trail = RegExp(r'[.,;:!?)\]]+$');

/// A bare URL swallows the sentence's punctuation; hand that back as text.
Link? linkFrom(String part) {
  final md = _mdLink.firstMatch(part);
  if (md != null) return Link(md.group(2)!, md.group(1)!, '');
  if (!part.startsWith('http://') && !part.startsWith('https://')) return null;
  final tail = _trail.firstMatch(part)?.group(0) ?? '';
  final href = part.substring(0, part.length - tail.length);
  return Link(href, href, tail);
}

/// Split a line into its marks, in order. Empty pieces dropped.
List<String> splitInline(String line) {
  final out = <String>[];
  var last = 0;
  for (final m in inlineMarks.allMatches(line)) {
    if (m.start > last) out.add(line.substring(last, m.start));
    out.add(m.group(0)!);
    last = m.end;
  }
  if (last < line.length) out.add(line.substring(last));
  return out.where((p) => p.isNotEmpty).toList();
}
