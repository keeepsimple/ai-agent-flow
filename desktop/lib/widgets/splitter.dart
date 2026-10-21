import 'package:flutter/material.dart';

import '../theme.dart';

/// The grab handle between two panes.
///
/// A one-pixel line is the right thing to look at and the wrong thing to aim
/// at, so the line stays thin and the target around it is wide.
class Splitter extends StatefulWidget {
  const Splitter({super.key, required this.onDrag, this.onReset});

  /// Positive is to the right, in logical pixels.
  final void Function(double delta) onDrag;

  /// Double-click, for putting it back where it started.
  final VoidCallback? onReset;

  @override
  State<Splitter> createState() => _SplitterState();
}

class _SplitterState extends State<Splitter> {
  bool _over = false;
  bool _dragging = false;

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    final lit = _over || _dragging;

    return MouseRegion(
      cursor: SystemMouseCursors.resizeLeftRight,
      onEnter: (_) => setState(() => _over = true),
      onExit: (_) => setState(() => _over = false),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onDoubleTap: widget.onReset,
        onHorizontalDragStart: (_) => setState(() => _dragging = true),
        onHorizontalDragEnd: (_) => setState(() => _dragging = false),
        onHorizontalDragCancel: () => setState(() => _dragging = false),
        onHorizontalDragUpdate: (details) => widget.onDrag(details.delta.dx),
        child: SizedBox(
          width: 9,
          child: Center(
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 120),
              width: lit ? 2 : 1,
              color: lit ? accent.withValues(alpha: 0.7) : Tern.line,
            ),
          ),
        ),
      ),
    );
  }
}
