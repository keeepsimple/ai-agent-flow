import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../diff.dart';
import '../theme.dart';

/// The diff, with both line numbers, the way the artboard shows it.
///
/// Lazy down the page: a diff runs to thousands of lines and building them
/// all to show forty was the most expensive thing on screen. The width is
/// worked out from the longest line rather than from laying every line out,
/// which a monospaced font makes exact enough.
class DiffView extends StatelessWidget {
  const DiffView(this.patch, {super.key});

  final String? patch;

  static const _size = 11.5;
  static const _gutters = 10.0 + 38 + 38 + 7 + 6 + 10;

  @override
  Widget build(BuildContext context) {
    final lines = readDiff(patch);
    if (lines.isEmpty) {
      return Center(child: Text('No changes here yet.', style: t(12, color: Tern.muted)));
    }

    var longest = 0;
    for (final line in lines) {
      if (line.text.length > longest) longest = line.text.length;
    }
    final width = longest * _advance(context) + _gutters;

    return LayoutBuilder(
      builder: (context, box) => SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SizedBox(
          width: math.max(width, box.maxWidth),
          child: ListView.builder(
            padding: const EdgeInsets.symmetric(vertical: 8),
            itemCount: lines.length,
            itemBuilder: (context, i) => _row(lines[i]),
          ),
        ),
      ),
    );
  }

  /// One character's width in the mono face, measured once per diff.
  static double _advance(BuildContext context) {
    final painter = TextPainter(
      text: TextSpan(text: '0' * 40, style: t(_size, code: true)),
      textDirection: TextDirection.ltr,
    )..layout();
    return painter.width / 40;
  }

  Widget _row(DiffLine line) {
    final (bg, fg) = switch (line.kind) {
      'add' => (Tern.added, Tern.ink2),
      'del' => (Tern.removed, Tern.ink2),
      'hunk' => (Tern.raised, Tern.muted),
      _ => (Colors.transparent, Tern.ink3),
    };
    final marker = switch (line.kind) { 'add' => '+', 'del' => '-', _ => ' ' };

    return Container(
      color: bg,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _gutter(line.before),
          _gutter(line.after),
          Text(marker, style: t(_size, color: Tern.faint, code: true)),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              line.text,
              softWrap: false,
              overflow: TextOverflow.clip,
              style: t(_size, color: fg, code: true, height: 1.5),
            ),
          ),
        ],
      ),
    );
  }

  Widget _gutter(int? n) => SizedBox(
        width: 38,
        child: Text(
          n?.toString() ?? '',
          textAlign: TextAlign.right,
          style: t(11, color: Tern.dim, code: true, height: 1.5),
        ),
      );
}
