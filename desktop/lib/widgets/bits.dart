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
  bool _down = false;

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

    // A dead control must not keep claiming to be the live one, so the glow
    // goes with the press when the button is off.
    final shadow = off
        ? null
        : switch (widget.tone) {
            Tone.primary => accentGlow(accent, lifted: _over),
            Tone.quiet => e1,
            // A shadow under a transparent pill reads as a smudge, not height.
            Tone.danger => null,
          };

    final child = Opacity(
      opacity: off ? 0.4 : 1,
      child: AnimatedContainer(
        duration: smooth,
        curve: ease,
        height: widget.dense ? 28 : 32,
        padding: EdgeInsets.symmetric(horizontal: widget.dense ? 11 : 13),
        transform: Matrix4.translationValues(
          0,
          _down ? 1 : (_over && !off ? -1 : 0),
          0,
        ),
        decoration: BoxDecoration(
          color: bg,
          border: raised(border),
          borderRadius: BorderRadius.circular(widget.dense ? 14 : 16),
          boxShadow: _down ? null : shadow,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (widget.busy)
              SizedBox(
                width: 12,
                height: 12,
                child: Working(size: 12, dot: 6, colour: fg),
              )
            else if (widget.icon != null)
              Icon(widget.icon, size: 14, color: fg),
            if (widget.busy || widget.icon != null) const SizedBox(width: 6),
            Text(
              widget.label,
              style: t(12.5, color: fg, weight: FontWeight.w500),
            ),
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
        child: GestureDetector(
          onTap: off ? null : widget.onPressed,
          onTapDown: off ? null : (_) => setState(() => _down = true),
          onTapUp: off ? null : (_) => setState(() => _down = false),
          onTapCancel: off ? null : () => setState(() => _down = false),
          child: child,
        ),
      ),
    );
  }
}

/// A FlowButton for work that takes long enough to notice.
///
/// `git worktree remove` is seconds on a large checkout, and with nothing
/// holding a busy state the window just sat there and then jumped. FlowButton
/// already draws a spinner for `busy`; what was missing was anyone setting it.
class AsyncButton extends StatefulWidget {
  const AsyncButton({
    super.key,
    required this.label,
    required this.run,
    this.icon,
    this.tone = Tone.quiet,
    this.tooltip,
    this.dense = false,
  });

  final String label;
  final Future<void> Function() run;
  final IconData? icon;
  final Tone tone;
  final String? tooltip;
  final bool dense;

  @override
  State<AsyncButton> createState() => _AsyncButtonState();
}

class _AsyncButtonState extends State<AsyncButton> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) => FlowButton(
    label: widget.label,
    icon: widget.icon,
    tone: widget.tone,
    tooltip: widget.tooltip,
    dense: widget.dense,
    busy: _busy,
    onPressed: _busy
        ? null
        : () async {
            setState(() => _busy = true);
            try {
              await widget.run();
            } finally {
              // The press can outlive the row it was on: dropping a
              // worktree reloads the board under it.
              if (mounted) setState(() => _busy = false);
            }
          },
  );
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
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    final body = AnimatedContainer(
      duration: smooth,
      curve: ease,
      height: 30,
      padding: const EdgeInsets.symmetric(horizontal: 11),
      transform: Matrix4.translationValues(0, _down ? 1 : 0, 0),
      decoration: BoxDecoration(
        color: widget.selected
            ? accent.withValues(alpha: 0.14)
            : (_over ? Tern.selected : Tern.raised),
        border: raised(
          widget.selected ? accent.withValues(alpha: 0.65) : Tern.lineStrong,
        ),
        borderRadius: BorderRadius.circular(15),
        boxShadow: _down
            ? null
            : widget.selected
            ? [
                BoxShadow(
                  color: accent.withValues(alpha: 0.30),
                  blurRadius: 16,
                  spreadRadius: -6,
                ),
              ]
            : e1,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.icon != null) ...[
            Icon(
              widget.icon,
              size: 13,
              color: widget.selected ? accent : Tern.muted,
            ),
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
        child: GestureDetector(
          onTap: widget.onTap,
          onTapDown: (_) => setState(() => _down = true),
          onTapUp: (_) => setState(() => _down = false),
          onTapCancel: () => setState(() => _down = false),
          child: body,
        ),
      ),
    );
  }
}

/// A live pulse: a solid core with rings leaving it.
///
/// Reads as working without the generic spin, and keeps a dot's footprint so
/// nothing around it shifts when a run starts.
class Working extends StatefulWidget {
  const Working({super.key, this.size = 13, this.dot = 8, this.colour});

  /// The box it occupies. Rings are drawn past it on purpose: CustomPaint does
  /// not clip, so the travel costs no layout.
  final double size;

  /// The solid core, which must match the resting dot it replaces or a glance
  /// reads a running task as quieter than a finished one.
  final double dot;
  final Color? colour;

  @override
  State<Working> createState() => _WorkingState();
}

class _WorkingState extends State<Working> with SingleTickerProviderStateMixin {
  late final AnimationController _loop = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1700),
  )..repeat();

  @override
  void dispose() {
    _loop.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colour = widget.colour ?? Theme.of(context).colorScheme.primary;
    final box = SizedBox(width: widget.size, height: widget.size);

    // Someone who asked the system for less movement still has to be able to
    // see that this is running, so the core stays and only the rings go.
    if (MediaQuery.disableAnimationsOf(context)) {
      return CustomPaint(
        painter: _Pulse(0, colour, widget.dot, rings: false),
        child: box,
      );
    }
    return AnimatedBuilder(
      animation: _loop,
      builder: (_, child) =>
          CustomPaint(painter: _Pulse(_loop.value, colour, widget.dot), child: child),
      child: box,
    );
  }
}

class _Pulse extends CustomPainter {
  _Pulse(this.t, this.colour, this.dot, {this.rings = true});
  final double t;
  final Color colour;
  final double dot;
  final bool rings;

  @override
  void paint(Canvas canvas, Size size) {
    final centre = size.center(Offset.zero);
    final core = dot / 2;
    final reach = size.width * 0.85;

    if (rings) {
      // Half a cycle apart, so one is always on its way out.
      for (final phase in [t, (t + 0.5) % 1]) {
        final out = Curves.easeOut.transform(phase);
        canvas.drawCircle(
          centre,
          core + (reach - core) * out,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.4
            ..color = colour.withValues(alpha: (1 - out) * 0.75),
        );
      }
    }
    canvas.drawCircle(centre, core, Paint()..color = colour);
  }

  @override
  bool shouldRepaint(_Pulse old) =>
      old.t != t || old.colour != colour || old.dot != dot || old.rings != rings;
}

/// The status dot, pulsing only while something is actually running.
class StatusDot extends StatefulWidget {
  const StatusDot(this.status, {super.key, this.size = 8});
  final String status;
  final double size;

  @override
  State<StatusDot> createState() => _StatusDotState();
}

class _StatusDotState extends State<StatusDot>
    with SingleTickerProviderStateMixin {
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
    'awaiting_approval' || 'awaiting_answer' || 'interrupted' => Tern.warn,
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

    // Actually working: a spinner, not a tint. The accent is the colour of
    // every live control in the app, so a dot wearing it said little, and
    // saying it in colour alone says nothing to an eye that cannot separate
    // these two darks. Queued keeps the dot: it is waiting, not working.
    if (widget.status == 'running') {
      return Working(size: widget.size + 5, dot: widget.size, colour: colour);
    }
    if (widget.status != 'queued') return dot;
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
    this.elevation = 1,
  });

  final Widget child;
  final EdgeInsets padding;
  final Color colour;
  final Color border;
  final double radius;

  /// 0 flat, 1 resting, 2 floating. Every panel lifts by default: the flat
  /// version is what made the app read as one grey field.
  final int elevation;

  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    decoration: BoxDecoration(
      color: elevation == 0 ? colour : null,
      gradient: elevation == 0 ? null : litFill(colour),
      border: elevation == 0 ? Border.all(color: border) : raised(border),
      borderRadius: BorderRadius.circular(radius),
      boxShadow: switch (elevation) {
        0 => null,
        1 => e1,
        _ => e2,
      },
    ),
    child: child,
  );
}

/// The product's own logo. It has no transparency, so it is clipped to a
/// rounded tile rather than floated on the bar as a black square.
class Mark extends StatelessWidget {
  const Mark({super.key, this.size = 22});
  final double size;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(size * 0.27),
    child: Image.asset(
      'assets/logo.png',
      width: size,
      height: size,
      filterQuality: FilterQuality.medium,
    ),
  );
}

/// The phase label the server uses, spelled for people.
const phaseLabels = {
  'spec': 'Spec',
  'plan': 'Plan',
  'implement': 'Implement',
  'review': 'Self review',
  'write': 'Writing',
};

String statusWords(Task2 task) => switch (task.status) {
  'awaiting_approval' =>
    'Your call: ${phaseLabels[task.awaiting] ?? task.awaiting}',
  'awaiting_answer' => 'Waiting on your answer',
  'running' => phaseLabels[task.phase] ?? 'Running',
  'queued' => 'Queued',
  'done' => 'Done',
  'failed' => 'Failed',
  'interrupted' => 'Interrupted',
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
