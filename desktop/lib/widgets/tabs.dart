import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';
import 'bits.dart';

/// Which tab to land on when one is closed: whatever slid into its place, the
/// last one if it was the end of the row, or the board when none is left.
///
/// Closing one of twelve was not a request to put all of them away, which is
/// what going back to the board every time amounts to.
String? afterClosing(List<String> tabs, String closed) {
  final at = tabs.indexOf(closed);
  final left = [...tabs]..remove(closed);
  if (left.isEmpty || at < 0) return null;
  return left[at.clamp(0, left.length - 1)];
}

/// The conversations left open, one chip each.
///
/// A tab is a shortcut, not a second copy of the screen: switching rebuilds
/// the workspace from the store rather than keeping twelve conversations
/// alive in memory. What it buys is the trip to the board you no longer make.
class TabStrip extends StatelessWidget {
  const TabStrip({
    super.key,
    required this.tabs,
    required this.tasks,
    required this.selected,
    required this.onPick,
    required this.onClose,
    required this.onBoard,
  });

  final List<String> tabs;
  final List<Task> tasks;
  final String? selected;
  final void Function(String id) onPick;
  final void Function(String id) onClose;

  /// Nothing selected is the board, which is a tab of its own at the far left.
  final VoidCallback onBoard;

  @override
  Widget build(BuildContext context) {
    if (tabs.isEmpty) return const SizedBox.shrink();
    return Container(
      height: 36,
      decoration: const BoxDecoration(
        color: Tern.page,
        border: Border(bottom: BorderSide(color: Tern.line)),
      ),
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        children: [
          _Tab(
            label: 'Board',
            icon: Icons.grid_view_outlined,
            selected: selected == null,
            onTap: onBoard,
          ),
          for (final id in tabs)
            _Tab(
              key: ValueKey(id),
              label: tasks.where((t) => t.id == id).firstOrNull?.title ?? id,
              status: tasks.where((t) => t.id == id).firstOrNull?.status,
              selected: id == selected,
              onTap: () => onPick(id),
              onClose: () => onClose(id),
            ),
        ],
      ),
    );
  }
}

class _Tab extends StatefulWidget {
  const _Tab({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.status,
    this.icon,
    this.onClose,
  });

  final String label;
  final String? status;
  final bool selected;
  final IconData? icon;
  final VoidCallback onTap;
  final VoidCallback? onClose;

  @override
  State<_Tab> createState() => _TabState();
}

class _TabState extends State<_Tab> {
  bool _over = false;

  @override
  Widget build(BuildContext context) {
    // The close button appears under the pointer rather than sitting on every
    // tab: a row of twelve crosses reads as a row of crosses, not of work.
    final closable = widget.onClose != null && (_over || widget.selected);
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _over = true),
      onExit: (_) => setState(() => _over = false),
      child: GestureDetector(
        onTap: widget.onTap,
        // The middle button closes a tab everywhere else; it closes one here.
        onTertiaryTapUp: (_) => widget.onClose?.call(),
        child: AnimatedContainer(
          duration: smooth,
          curve: ease,
          constraints: const BoxConstraints(maxWidth: 190),
          padding: EdgeInsets.only(left: 10, right: closable ? 3 : 10),
          margin: const EdgeInsets.only(right: 3),
          decoration: BoxDecoration(
            color: widget.selected
                ? Tern.selected
                : (_over ? Tern.raised : Colors.transparent),
            border: widget.selected
                ? raised(Tern.lineStrong)
                : Border.all(color: Colors.transparent),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            if (widget.icon != null) ...[
              Icon(widget.icon,
                  size: 12,
                  color: widget.selected ? Tern.ink : Tern.muted),
              const SizedBox(width: 6),
            ] else if (widget.status != null) ...[
              StatusDot(widget.status!),
              const SizedBox(width: 7),
            ],
            Flexible(
              child: Text(
                widget.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: t(11.5,
                    color: widget.selected ? Tern.ink : Tern.muted,
                    weight: widget.selected ? FontWeight.w500 : FontWeight.w400),
              ),
            ),
            if (closable)
              Tooltip(
                message: 'Close this tab. The task keeps running.',
                child: MouseRegion(
                  cursor: SystemMouseCursors.click,
                  child: GestureDetector(
                    onTap: widget.onClose,
                    child: const Padding(
                      padding: EdgeInsets.all(5),
                      child: Icon(Icons.close, size: 12, color: Tern.muted),
                    ),
                  ),
                ),
              ),
          ]),
        ),
      ),
    );
  }
}
