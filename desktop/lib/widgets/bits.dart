import 'package:flutter/material.dart';

import '../theme.dart';

enum Tone { quiet, primary, danger }

/// The artboard's button: a pill, not a rectangle.
class FlowButton extends StatefulWidget {
  const FlowButton({
    super.key,
    required this.label,
    this.onPressed,
    this.tone = Tone.quiet,
    this.icon,
    this.busy = false,
    this.tooltip,
    this.dense = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final Tone tone;
  final IconData? icon;
  final bool busy;
  final String? tooltip;

  /// For the top bar, where anything taller than the traffic lights' own band
  /// cannot sit level with them without running off the top of the window.
  final bool dense;

  @override
  State<FlowButton> createState() => _FlowButtonState();
}

class _FlowButtonState extends State<FlowButton> {
  bool _over = false;

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    final off = widget.onPressed == null || widget.busy;

    late Color bg, fg, border;
    switch (widget.tone) {
      case Tone.primary:
        bg = accent;
        fg = Tern.onAccent;
        border = accent;
      case Tone.danger:
        bg = _over ? const Color(0x22FF8080) : Colors.transparent;
        fg = Tern.bad;
        border = const Color(0x66FF8080);
      case Tone.quiet:
        bg = _over ? Tern.selected : Tern.raised;
        fg = Tern.ink2;
        border = Tern.lineStrong;
    }

    final child = Opacity(
      opacity: off ? 0.4 : 1,
      child: Container(
        height: widget.dense ? 28 : 32,
        padding: EdgeInsets.symmetric(horizontal: widget.dense ? 11 : 13),
        decoration: BoxDecoration(
          color: bg,
          border: Border.all(color: border),
          borderRadius: BorderRadius.circular(widget.dense ? 14 : 16),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (widget.busy)
              SizedBox(
                width: 12,
                height: 12,
                child: CircularProgressIndicator(strokeWidth: 1.6, color: fg),
              )
            else if (widget.icon != null)
              Icon(widget.icon, size: 14, color: fg),
            if (widget.busy || widget.icon != null) const SizedBox(width: 6),
            Text(widget.label, style: t(12.5, color: fg, weight: FontWeight.w500)),
          ],
        ),
      ),
    );

    return Tooltip(
      message: widget.tooltip ?? '',
      waitDuration: const Duration(milliseconds: 600),
      child: MouseRegion(
        cursor: off ? SystemMouseCursors.basic : SystemMouseCursors.click,
        onEnter: (_) => setState(() => _over = true),
        onExit: (_) => setState(() => _over = false),
        child: GestureDetector(onTap: off ? null : widget.onPressed, child: child),
      ),
    );
  }
}

/// A small selectable pill, used for repos, models, run shapes.
class Chip2 extends StatefulWidget {
  const Chip2({
    super.key,
    required this.label,
    this.selected = false,
    this.onTap,
    this.icon,
    this.tooltip,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;
  final IconData? icon;
  final String? tooltip;

  @override
  State<Chip2> createState() => _Chip2State();
}

class _Chip2State extends State<Chip2> {
  bool _over = false;

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    final body = AnimatedContainer(
      duration: const Duration(milliseconds: 120),
      height: 30,
      padding: const EdgeInsets.symmetric(horizontal: 11),
      decoration: BoxDecoration(
        color: widget.selected
            ? accent.withValues(alpha: 0.14)
            : (_over ? Tern.selected : Tern.raised),
        border: Border.all(
          color: widget.selected ? accent.withValues(alpha: 0.65) : Tern.lineStrong,
        ),
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.icon != null) ...[
            Icon(widget.icon, size: 13, color: widget.selected ? accent : Tern.muted),
            const SizedBox(width: 5),
          ],
          Text(
            widget.label,
            style: t(12, color: widget.selected ? accent : Tern.ink3),
          ),
        ],
      ),
    );

    return Tooltip(
      message: widget.tooltip ?? '',
      waitDuration: const Duration(milliseconds: 600),
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        onEnter: (_) => setState(() => _over = true),
        onExit: (_) => setState(() => _over = false),
        child: GestureDetector(onTap: widget.onTap, child: body),
      ),
    );
  }
}

/// The status dot, pulsing only while something is actually running.
class StatusDot extends StatefulWidget {
  const StatusDot(this.status, {super.key, this.size = 8});
  final String status;
  final double size;

  @override
  State<StatusDot> createState() => _StatusDotState();
}

class _StatusDotState extends State<StatusDot> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  static Color colourFor(String status, Color accent) => switch (status) {
        'running' || 'queued' => accent,
        'awaiting_approval' || 'awaiting_answer' => Tern.warn,
        'done' => Tern.ok,
        'failed' => Tern.bad,
        _ => Tern.faint,
      };

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    final colour = colourFor(widget.status, accent);
    final dot = Container(
      width: widget.size,
      height: widget.size,
      decoration: BoxDecoration(color: colour, shape: BoxShape.circle),
    );
    if (widget.status != 'running' && widget.status != 'queued') return dot;
    return AnimatedBuilder(
      animation: _pulse,
      builder: (_, child) => Container(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: colour.withValues(alpha: 0.35 * (1 - _pulse.value)),
              blurRadius: 0,
              spreadRadius: 3 * _pulse.value,
            ),
          ],
        ),
        child: child,
      ),
      child: dot,
    );
  }
}

/// A bordered surface. Every panel in the artboards is this.
class Panel extends StatelessWidget {
  const Panel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(14),
    this.colour = Tern.panel,
    this.border = Tern.line,
    this.radius = 12,
  });

  final Widget child;
  final EdgeInsets padding;
  final Color colour;
  final Color border;
  final double radius;

  @override
  Widget build(BuildContext context) => Container(
        padding: padding,
        decoration: BoxDecoration(
          color: colour,
          border: Border.all(color: border),
          borderRadius: BorderRadius.circular(radius),
        ),
        child: child,
      );
}

/// The mark from the artboards: the accent square with the code brackets.
class Mark extends StatelessWidget {
  const Mark({super.key, this.size = 22});
  final double size;

  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.primary,
          borderRadius: BorderRadius.circular(size * 0.27),
        ),
        alignment: Alignment.center,
        child: Icon(Icons.code, size: size * 0.62, color: Tern.onAccent),
      );
}

/// The phase label the server uses, spelled for people.
const phaseLabels = {
  'spec': 'Spec',
  'plan': 'Plan',
  'implement': 'Implement',
  'review': 'Self review',
};

String statusWords(Task2 task) => switch (task.status) {
      'awaiting_approval' => 'Your call: ${phaseLabels[task.awaiting] ?? task.awaiting}',
      'awaiting_answer' => 'Waiting on your answer',
      'running' => phaseLabels[task.phase] ?? 'Running',
      'queued' => 'Queued',
      'done' => 'Done',
      'failed' => 'Failed',
      'cancelled' => 'Cancelled',
      _ => task.status,
    };

/// Minimal shape so bits.dart does not have to import the API layer.
class Task2 {
  const Task2(this.status, this.phase, this.awaiting);
  final String status;
  final String? phase;
  final String? awaiting;
}
