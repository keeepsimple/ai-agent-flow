import 'package:flutter/material.dart';

import '../diff.dart';
import '../theme.dart';

/// The diff, with both line numbers, the way the artboard shows it.
class DiffView extends StatelessWidget {
  const DiffView(this.patch, {super.key});
  final String? patch;

  @override
  Widget build(BuildContext context) {
    final lines = readDiff(patch);
    if (lines.isEmpty) {
      return Center(child: Text('No changes here yet.', style: t(12, color: Tern.muted)));
    }
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: ConstrainedBox(
        constraints: BoxConstraints(minWidth: MediaQuery.of(context).size.width - 40),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [for (final line in lines) _row(line)],
        ),
      ),
    );
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
          Text(marker, style: t(11.5, color: Tern.faint, code: true)),
          const SizedBox(width: 6),
          Expanded(
            child: Text(line.text, style: t(11.5, color: fg, code: true, height: 1.5)),
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
