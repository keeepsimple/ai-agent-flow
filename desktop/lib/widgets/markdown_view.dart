import 'dart:io';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../markdown.dart';
import '../theme.dart';

/// Links out of the tool belong in the browser, not in here.
Future<void> openExternal(String url) async {
  final (cmd, args) = switch (Platform.operatingSystem) {
    'macos' => ('open', [url]),
    'windows' => ('cmd', ['/c', 'start', '', url]),
    _ => ('xdg-open', [url]),
  };
  try {
    await Process.run(cmd, args);
  } catch (_) {
    // Nothing useful to say: the link is still on screen to copy.
  }
}

/// Renders the blocks the splitter produced. No HTML anywhere: agent output
/// cannot carry markup into this window.
class MarkdownView extends StatelessWidget {
  const MarkdownView(this.source, {super.key, this.colour = Tern.ink2, this.size = 12.5});

  final String? source;
  final Color colour;
  final double size;

  @override
  Widget build(BuildContext context) {
    final parts = blocks(source);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < parts.length; i++)
          Padding(
            padding: EdgeInsets.only(top: i == 0 ? 0 : 8),
            child: _block(context, parts[i]),
          ),
      ],
    );
  }

  Widget _block(BuildContext context, Block block) => switch (block) {
        Heading h => Padding(
            padding: const EdgeInsets.only(top: 6, bottom: 2),
            child: _rich(context, h.text,
                style: t(h.level <= 2 ? size + 2 : size + 0.5,
                    color: Tern.ink, weight: FontWeight.w600)),
          ),
        Para p => _rich(context, p.text),
        Quote q => Container(
            padding: const EdgeInsets.only(left: 10),
            decoration: const BoxDecoration(
              border: Border(left: BorderSide(color: Tern.lineStrong, width: 2)),
            ),
            child: _rich(context, q.text, style: t(size, color: Tern.muted)),
          ),
        Bullets b => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final item in b.items)
                Padding(
                  padding: const EdgeInsets.only(bottom: 3),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(right: 8, left: 2),
                        child: Text('·', style: t(size, color: Tern.faint)),
                      ),
                      Expanded(child: _rich(context, item)),
                    ],
                  ),
                ),
            ],
          ),
        Code c => Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Tern.raised,
              border: Border.all(color: Tern.line),
              borderRadius: BorderRadius.circular(8),
            ),
            child: SelectableText(c.text, style: t(11.5, color: Tern.ink3, code: true)),
          ),
        TableBlock tb => _table(context, tb),
      };

  Widget _table(BuildContext context, TableBlock tb) => Container(
        decoration: BoxDecoration(
          border: Border.all(color: Tern.line),
          borderRadius: BorderRadius.circular(8),
        ),
        clipBehavior: Clip.antiAlias,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            headingRowHeight: 32,
            dataRowMinHeight: 30,
            dataRowMaxHeight: 52,
            horizontalMargin: 10,
            columnSpacing: 18,
            headingRowColor: WidgetStateProperty.all(Tern.raised),
            columns: [
              for (final cell in tb.head)
                DataColumn(
                  label: Text(cell, style: t(11.5, color: Tern.ink, weight: FontWeight.w500)),
                ),
            ],
            rows: [
              for (final row in tb.rows)
                DataRow(
                  cells: [
                    for (var i = 0; i < tb.head.length; i++)
                      DataCell(_rich(context, i < row.length ? row[i] : '', size: 11.5)),
                  ],
                ),
            ],
          ),
        ),
      );

  /// Inline marks: code, bold, italic, and links that actually open.
  Widget _rich(BuildContext context, String line, {TextStyle? style, double? size}) {
    final accent = Theme.of(context).colorScheme.primary;
    final base = style ?? t(size ?? this.size, color: colour, height: 1.55);
    final spans = <InlineSpan>[];

    for (final part in splitInline(line)) {
      final link = linkFrom(part);
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
        spans.add(TextSpan(
          text: part.substring(1, part.length - 1),
          style: base.copyWith(fontFamily: mono, color: accent, fontSize: base.fontSize! - 0.5),
        ));
      } else if (link != null) {
        spans.add(TextSpan(
          text: link.text,
          style: base.copyWith(color: accent, decoration: TextDecoration.underline),
          recognizer: TapGestureRecognizer()..onTap = () => openExternal(link.href),
        ));
        if (link.trail.isNotEmpty) spans.add(TextSpan(text: link.trail, style: base));
      } else if (part.startsWith('**') && part.endsWith('**') && part.length > 3) {
        spans.add(TextSpan(
          text: part.substring(2, part.length - 2),
          style: base.copyWith(color: Tern.ink, fontWeight: FontWeight.w600),
        ));
      } else if (part.startsWith('*') && part.endsWith('*') && part.length > 1) {
        spans.add(TextSpan(
          text: part.substring(1, part.length - 1),
          style: base.copyWith(fontStyle: FontStyle.italic),
        ));
      } else {
        spans.add(TextSpan(text: part, style: base));
      }
    }
    return SelectableText.rich(TextSpan(children: spans));
  }
}
